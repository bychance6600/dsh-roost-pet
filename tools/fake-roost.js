#!/usr/bin/env node
'use strict';

/**
 * 假 roost：不起 DSH，只按 docs/protocol.md 说话，用来单独验 body。
 *
 *   node tools/fake-roost.js            正常一轮：握手 → 两条 say → 动作 → 状态 → bye
 *   node tools/fake-roost.js --eof      说完就关 stdin，看 body 会不会自己退干净
 *   node tools/fake-roost.js --garbage  先灌几条坏消息，再发正常的一条，看它崩不崩
 *
 * 参数：--size=1.2  --position=bottom-left  --hold=4500（每条气泡看多久）
 *
 * 这是测试工具，不是 body 的一部分；它爱往 stdout 打多少字都行。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const LONG_TEXT =
  '这是假 roost 冒的第一句：句子长一点，折成好几行，看它会不会被窗口的上边缘裁掉。';
const SHORT_TEXT = '第二句，短。';

let failures = 0;
const startedAt = Date.now();

function stamp() {
  return `+${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
}

function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function openInbox(stream) {
  const items = [];
  const waiters = [];
  const rl = readline.createInterface({ input: stream });

  function pump() {
    while (waiters.length > 0 && items.length > 0) {
      waiters.shift().resolve(items.shift());
    }
  }

  rl.on('line', (line) => {
    // Electron 在 Windows 启动时会先往 stdout 甩一个空行；空行按协议忽略。
    if (line.trim() === '') return;
    items.push({ raw: line, msg: safeParse(line) });
    pump();
  });

  return {
    next(timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: (item) => {
            clearTimeout(timer);
            resolve(item);
          },
        };
        const timer = setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`等了 ${timeoutMs}ms 没等到 body 的消息`));
        }, timeoutMs);
        waiters.push(waiter);
        pump();
      });
    },
  };
}

async function main() {
  let binary;
  try {
    binary = require('electron');
  } catch {
    console.error('找不到 electron，先装依赖（见 README）。');
    process.exit(2);
  }
  if (typeof binary !== 'string') {
    console.error('require("electron") 没给出二进制路径，这不对劲。');
    process.exit(2);
  }

  const bodyArgs = [ROOT];
  for (const key of ['size', 'position', 'click-through', 'pet']) {
    const value = opt(key);
    if (value !== undefined) bodyArgs.push(`--${key}=${value}`);
  }

  // 在 DSH 的沙箱壳里跑测试时，子进程写不了 C:\Users\...（%APPDATA%），
  // 而 Chromium 一碰 userData 目录就崩；同时这边还带着 job 对象，
  // Chromium 的沙箱初始化不起来。真用户从自己的终端起 body 时没这两条，
  // 所以只在测试工具里补：现成的 profile 目录 + --no-sandbox。
  const profileDir = path.join(ROOT, '.tmp', 'e2e-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  bodyArgs.push('--no-sandbox', `--user-data-dir=${profileDir}`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const mode = has('eof') ? 'eof' : has('garbage') ? 'garbage' : 'normal';
  console.log(`\n假 roost（${mode}）→ ${binary} ${bodyArgs.slice(1).join(' ') || '(默认)'}\n`);

  const child = spawn(binary, bodyArgs, { stdio: ['pipe', 'pipe', 'pipe'], env });
  const inbox = openInbox(child.stdout);
  const seen = [];

  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) console.log(`${stamp()}   body| ${line}`);
    }
  });

  function send(msg) {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
    console.log(`${stamp()} → ${JSON.stringify(msg)}`);
  }

  async function nextMsg(timeoutMs = 3000) {
    for (;;) {
      const item = await inbox.next(timeoutMs);
      console.log(`${stamp()} ← ${item.raw}`);
      if (!item.msg) {
        check(false, 'body 吐出了一行非 JSON', item.raw.slice(0, 120));
        continue;
      }
      seen.push(item.msg);
      if (item.msg.t === 'log') {
        console.log(`        （body log：${item.msg.level} ${item.msg.msg}）`);
        continue;
      }
      return item.msg;
    }
  }

  function waitExit(timeoutMs) {
    if (child.exitCode !== null) return Promise.resolve(child.exitCode);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve(code === null ? signal : code);
      });
    });
  }

  try {
    // ---- 握手 -------------------------------------------------------------
    const hello = await nextMsg(3000);
    check(hello.t === 'hello', 'body 先开口，发的是 hello');
    check(hello.v === 1, 'hello.v = 1');
    check(
      typeof hello.body === 'string' && hello.body.startsWith('dsh-roost-pet/'),
      'hello.body 形如 dsh-roost-pet/x.y.z',
      String(hello.body),
    );
    check(typeof hello.pet === 'string' && hello.pet.length > 0, 'hello.pet 有值');

    send({ t: 'hello', v: 1, roost: 'fake-roost/0.1.0' });
    send({ t: 'state', state: 'thinking', why: '假 roost：在想今天的事' });

    if (mode === 'garbage') {
      // 坏行、未知类型、缺字段：body 应该丢掉并继续活。
      child.stdin.write('这不是 JSON\n');
      child.stdin.write('{"t":"shout","text":"谁在喊"}\n');
      child.stdin.write('{"t":"say","id":"half"}\n');
      console.log(`${stamp()} → （三行坏消息）`);
      await sleep(400);
      check(child.exitCode === null, '收到坏消息后还活着');
    }

    // ---- say --------------------------------------------------------------
    const sentAt = Date.now();
    send({ t: 'say', id: 's1', seq: 0, text: LONG_TEXT, final: false });
    const ack0 = await nextMsg(1500);
    check(ack0.t === 'ack' && ack0.id === 's1', '收到 say 立刻 ack（第一条）');
    check(Date.now() - sentAt < 500, `ack 在 500ms 内（实际 ${Date.now() - sentAt}ms）`);

    await sleep(600);
    send({ t: 'say', id: 's1', seq: 1, text: SHORT_TEXT, final: true });
    const ack1 = await nextMsg(1500);
    check(ack1.t === 'ack' && ack1.id === 's1', '同一轮第二条也 ack');

    if (mode === 'normal') {
      send({ t: 'say', id: 's1', seq: 0, text: LONG_TEXT, final: false });
      const ackDup = await nextMsg(1500);
      check(ackDup.t === 'ack' && ackDup.id === 's1', '重复的 say 也 ack（去重的是显示，不是回执）');
    }

    send({ t: 'act', action: 'nod', why: '假 roost：点头' });
    send({ t: 'state', state: 'waiting', why: '假 roost：等回话' });

    // ---- 收尾 -------------------------------------------------------------
    if (mode === 'eof') {
      console.log(`${stamp()} × 关掉 stdin（不发 bye）`);
      child.stdin.end();
      const code = await waitExit(3000);
      check(code === 0, `stdin EOF 后 3 秒内退干净，退出码 0（实际 ${code}）`);
    } else {
      await sleep(Number.parseInt(opt('hold') ?? '4500', 10));
      send({ t: 'bye' });
      const bye = await nextMsg(1500).catch(() => null);
      check(bye !== null && bye.t === 'bye', '退出前回了 bye');
      const code = await waitExit(3000);
      check(code === 0, `收到 bye 后 3 秒内退干净，退出码 0（实际 ${code}）`);
    }

    const afterBye = seen.filter((m) => m.t !== 'hello' && m.t !== 'ack' && m.t !== 'log');
    if (mode !== 'eof') {
      check(
        afterBye.every((m) => m.t === 'bye'),
        '握手之后 body 只发过 ack / log / bye（没有多余的话）',
        afterBye.map((m) => m.t).join(','),
      );
    }
  } finally {
    if (child.exitCode === null) child.kill();
  }

  console.log('');
  if (failures === 0) {
    console.log(`全部通过（${mode}）`);
  } else {
    console.error(`${failures} 项没过（${mode}）`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n假 roost 自己出错了：${err.stack || err.message}`);
  process.exit(1);
});

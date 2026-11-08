'use strict';

/**
 * 协议测试。
 *
 * 除了编解码本身，最要紧的一条是「表和代码不许各写各的」：
 * 这里会把 docs/protocol.md 里的表格读出来，和 lib/protocol.js 里的
 * 字段集合、必填标记、枚举值逐项对账。谁先动手、另一边没跟，就红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../lib/protocol');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'protocol.md'), 'utf8');

// ---------------------------------------------------------------------------
// 从 markdown 里读表
// ---------------------------------------------------------------------------

function section(heading) {
  const start = DOC.indexOf(heading);
  assert.ok(start >= 0, `文档里找不到小节：${heading}`);
  const rest = DOC.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function tableRows(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    if (cells.every((c) => /^-{3,}$/.test(c))) continue; // 分隔行
    rows.push(cells);
  }
  return rows;
}

function parseFieldList(cell) {
  if (!cell || cell.startsWith('—')) return [];
  return cell
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // 文档里写成 `v:number`，整个"名字:类型"在一对反引号里
      // 带 ? 的是可选字段：`x?:number`。没带 ? 的按整条必填。
      const m = /^`([a-z][a-z0-9]*)(\?)?:([^`]+)`$/.exec(s);
      assert.ok(m, `字段写法不认识：${s}`);
      return { name: m[1], type: m[3], optional: Boolean(m[2]) };
    });
}

function docTable(heading) {
  const rows = tableRows(section(heading));
  assert.ok(rows.length > 1, `${heading} 下面没读到表`);
  const out = new Map();
  for (const cells of rows.slice(1)) {
    const name = cells[0].replace(/`/g, '');
    out.set(name, {
      fields: parseFieldList(cells[1]),
      required: cells[2] === '是',
    });
  }
  return out;
}

const DOC_TYPE = {
  number: 'number',
  string: 'string',
  bool: 'boolean',
  'int≥0': 'number',
  enum: 'string',
};

function assertTableMatchesDoc(docRows, codeTable, label) {
  assert.deepEqual(
    [...docRows.keys()].sort(),
    Object.keys(codeTable).sort(),
    `${label}：消息类型集合和文档不一致`,
  );

  for (const [type, row] of docRows) {
    const spec = codeTable[type];
    assert.ok(spec, `${label}：代码里没有 ${type}`);

    assert.deepEqual(
      row.fields.map((f) => f.name).sort(),
      Object.keys(spec.types).sort(),
      `${label}：${type} 的字段集合和文档不一致`,
    );

    const docRequired = row.required ? row.fields.filter((f) => !f.optional).map((f) => f.name) : [];
    assert.deepEqual(
      [...docRequired].sort(),
      [...spec.required].sort(),
      `${label}：${type} 的必填标记和文档不一致`,
    );

    for (const field of row.fields) {
      assert.equal(
        spec.types[field.name],
        DOC_TYPE[field.type],
        `${label}：${type}.${field.name} 的类型（文档写 ${field.type}）和代码不一致`,
      );
    }
  }
}

function docEnum(name) {
  // §3 里是列表项 "- `state` ∈ …"，§4 里是单独一行 "枚举：`level` ∈ …"
  const re = new RegExp(`^(?:- )?(?:枚举：)?\`${name}\` ∈ (.+)$`, 'm');
  const m = re.exec(DOC);
  assert.ok(m, `文档里找不到 ${name} 的枚举行`);
  return m[1]
    .split('|')
    .map((s) => s.trim().replace(/`/g, '').replace(/[。.]$/, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 表 ↔ 代码
// ---------------------------------------------------------------------------

test('roost → body 的表和文档逐字对得上', () => {
  assertTableMatchesDoc(docTable('## 3. roost → body'), P.R2B, 'roost→body');
});

test('body → roost 的表和文档逐字对得上', () => {
  assertTableMatchesDoc(docTable('## 4. body → roost'), P.B2R, 'body→roost');
});

test('枚举值和文档对得上，顺序也一样', () => {
  assert.deepEqual(docEnum('state'), [...P.STATES]);
  // action 不再是枚举：名字来自角色包，表里只写 string（2026-11-08 18:17 板子）。
  assert.ok(!DOC.includes('`action` ∈'), '动作不该再有枚举行');
  assert.deepEqual(docEnum('level'), [...P.LEVELS]);
});

test('五档状态就是这五个，没有"整理"', () => {
  assert.deepEqual([...P.STATES], ['thinking', 'acting', 'waiting', 'error', 'done']);
});

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

test('合法的 say 能过', () => {
  const msg = { t: 'say', id: 's1', seq: 0, text: '晚安', final: true };
  assert.equal(P.validate(msg, 'r2b').ok, true);
});

test('未知 t 被拒', () => {
  const r = P.validate({ t: 'shout' }, 'r2b');
  assert.equal(r.ok, false);
  assert.match(r.reason, /未知 t/);
});

test('缺必填字段被拒', () => {
  const r = P.validate({ t: 'say', id: 's1', seq: 0, text: 'x' }, 'r2b');
  assert.equal(r.ok, false);
  assert.match(r.reason, /final/);
});

test('字段类型不对被拒', () => {
  const r = P.validate({ t: 'say', id: 's1', seq: '0', text: 'x', final: false }, 'r2b');
  assert.equal(r.ok, false);
  assert.match(r.reason, /seq/);
});

test('seq 必须是 >= 0 的整数', () => {
  for (const seq of [-1, 1.5, NaN, '1']) {
    const r = P.validate({ t: 'say', id: 's1', seq, text: 'x', final: false }, 'r2b');
    assert.equal(r.ok, false, `seq=${seq} 应该被拒`);
  }
});

test('表外枚举值被拒', () => {
  const r = P.validate({ t: 'state', state: 'tidying', why: '' }, 'r2b');
  assert.equal(r.ok, false);
  assert.match(r.reason, /枚举/);
});

test('多余字段不碍事', () => {
  const r = P.validate({ t: 'bye', extra: 1 }, 'r2b');
  assert.equal(r.ok, true);
});

test('数组、null、非对象都进不来', () => {
  for (const bad of [null, [], 'hello', 42]) {
    assert.equal(P.validate(bad, 'r2b').ok, false);
  }
});

// ---------------------------------------------------------------------------
// 编码 / 解码
// ---------------------------------------------------------------------------

test('encode → parseLine 原样回来', () => {
  const msg = { t: 'ack', id: 's1' };
  const parsed = P.parseLine(P.encode(msg).trimEnd());
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.msg, msg);
});

test('一条消息超过 16KB 直接抛，不悄悄截断', () => {
  const huge = { t: 'log', level: 'info', msg: 'x'.repeat(P.LINE_LIMIT) };
  assert.throws(() => P.encode(huge), RangeError);
});

test('坏 JSON 不抛，只报错', () => {
  const r = P.parseLine('{oops');
  assert.equal(r.ok, false);
  assert.match(r.reason, /坏 JSON/);
});

// ---------------------------------------------------------------------------
// 行缓冲
// ---------------------------------------------------------------------------

test('半包先攒着，见到换行才吐', () => {
  const d = new P.LineDecoder();
  assert.deepEqual(d.push('{"t":"ac').lines, []);
  assert.deepEqual(d.push('k","id":"a"}\n').lines, ['{"t":"ack","id":"a"}']);
});

test('一个 chunk 里粘了好几条也切得开', () => {
  const d = new P.LineDecoder();
  const { lines } = d.push('{"a":1}\n{"b":2}\n{"c":3}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('\\r\\n 也认，空行跳过', () => {
  const d = new P.LineDecoder();
  const { lines } = d.push('{"a":1}\r\n\r\n{"b":2}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test('超长的一行丢掉，并报一个 problem', () => {
  const d = new P.LineDecoder({ limit: 16 });
  const { lines, problems } = d.push(`${'x'.repeat(20)}\n{"a":1}\n`);
  assert.deepEqual(lines, ['{"a":1}']);
  assert.equal(problems[0].kind, 'too-long');
});

test('半行攒到上限还没换行：丢掉整条，直到下一个换行', () => {
  const d = new P.LineDecoder({ maxBuffer: 8 });
  const first = d.push('aaaaaaaaaaaa');
  assert.equal(first.problems[0].kind, 'overflow');
  const second = d.push('bbbb\n{"ok":1}\n');
  assert.deepEqual(second.lines, ['{"ok":1}']);
});

test('flush 交出最后一截没有换行的内容', () => {
  const d = new P.LineDecoder();
  d.push('{"t":"bye"}');
  assert.deepEqual(d.flush().lines, ['{"t":"bye"}']);
});

test('act.action 是自由字符串：动作名由角色包定，不查白名单', () => {
  const ok = P.validate({ t: 'act', action: 'wave', why: '挥手' }, 'r2b');
  assert.equal(ok.ok, true, ok.reason);
  const 中文 = P.validate({ t: 'act', action: '超级旋转', why: '' }, 'r2b');
  assert.equal(中文.ok, true, 中文.reason);

  const empty = P.validate({ t: 'act', action: '  ', why: '' }, 'r2b');
  assert.equal(empty.ok, false);
  const long = P.validate({ t: 'act', action: 'x'.repeat(41), why: '' }, 'r2b');
  assert.equal(long.ok, false);
  assert.match(long.reason, /太长/);
});

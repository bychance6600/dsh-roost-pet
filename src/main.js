'use strict';

/**
 * dsh-roost-pet 的主进程。
 *
 * 职责只有四件：
 *   1. 开那只透明、置顶、默认不吃点击的小窗；
 *   2. 在 stdin/stdout 上跑 docs/protocol.md 的 v1 协议；
 *   3. 把 roost 给的 say 排成气泡，交给渲染层逐字显示；
 *   4. 该退的时候退干净。
 *
 * 这里不生成任何台词，也不解释 roost 的话。
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

const { LineDecoder, parseLine, validate, encode } = require('../lib/protocol');
const { BubbleQueue } = require('../lib/bubbles');
const { EXIT, exitCodeFor } = require('../lib/exit');
const { parseArgs } = require('../lib/args');
const { serializePidRecord, parsePidRecord } = require('../lib/pidfile');
const { inspectPack } = require('../lib/pack');
const { pathToFileURL } = require('node:url');

// 启动期就把 console.* 全接到 stderr：只要有一行 console.log 落到 stdout，
// roost 那一侧的协议流就坏了。§1.6 的空行跳过只是兜底——Electron 自己
// 启动时还会往 stdout 甩一个换行，那一个挡不住，但也不该再多出第二个。
for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
  console[level] = (...parts) => {
    try {
      process.stderr.write(`${parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ')}\n`);
    } catch {
      /* stderr 也没了就算了 */
    }
  };
}

const PKG = require('../package.json');
const BODY_ID = `${PKG.name}/${PKG.version}`;
const PROTOCOL_V = 1;

/** 1.0 倍下的窗口尺寸：上面 120 给气泡，下面 300 给身体。 */
const BASE = { width: 360, body: 300, bubble: 120 };
const MARGIN = 24;
const SAVE_DEBOUNCE_MS = 300;
const EXIT_DEADLINE_MS = 2500;

const args = parseArgs(process.argv.slice(1));

// userData 固定到仓库内的 .userdata/：受限环境里 %APPDATA% 可能建不出来
// （Chromium 遇到 EPERM 会直接崩，连 JS 都跑不到），别让启动依赖它。
// 必须在 app ready 之前设。
app.setPath('userData', path.join(__dirname, '..', '.userdata'));

let win = null;
let rendererReady = false;
let outbox = [];
let shuttingDown = false;
let stdoutOk = true;
let handshaken = false;
let lastState = null;
let saveTimer = null;
let stdinStop = null;

const decoder = new LineDecoder();
const bubbles = new BubbleQueue({
  onShow: (item) => toRenderer('pet:bubble', {
    id: item.id,
    seq: item.seq,
    text: item.text,
    holdMs: item.holdMs,
  }),
  onIdle: () => toRenderer('pet:bubble-hide'),
  log: (msg) => reportWarn(msg),
});

// ---------------------------------------------------------------------------
// 日志：一律 stderr。console.log 会直接冲坏 stdout 上的协议。
// ---------------------------------------------------------------------------

function log(level, msg) {
  try {
    process.stderr.write(`[${BODY_ID}] ${level} ${msg}\n`);
  } catch {
    /* stderr 也没了就算了 */
  }
}

/** 需要 roost 记一笔的异常：走 log 消息（握手之后才发）。 */
function reportWarn(msg) {
  log('warn', msg);
  sendToRoost({ t: 'log', level: 'warn', msg });
}

// ---------------------------------------------------------------------------
// 协议出口
// ---------------------------------------------------------------------------

function sendToRoost(msg) {
  if (!stdoutOk) return;
  if (msg.t !== 'hello' && !handshaken) {
    // §2.1：握手完成前只发 hello。
    log('warn', `握手前不发 ${msg.t}`);
    return;
  }
  try {
    process.stdout.write(encode(msg));
  } catch (err) {
    stdoutOk = false;
    log('error', `写 stdout 失败：${err.message}`);
    shutdown('stdout-error');
  }
}

function toRenderer(channel, payload) {
  if (win && rendererReady) {
    win.webContents.send(channel, payload);
  } else {
    outbox.push([channel, payload]);
  }
}

function flushOutbox() {
  if (!win || !rendererReady) return;
  const queued = outbox;
  outbox = [];
  for (const [channel, payload] of queued) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// 入站
// ---------------------------------------------------------------------------

function handleLine(line) {
  if (shuttingDown) return;
  const parsed = parseLine(line);
  if (!parsed.ok) {
    reportWarn(`丢了一行：${parsed.reason}`);
    return;
  }
  const checked = validate(parsed.msg, 'r2b');
  if (!checked.ok) {
    reportWarn(`丢了一条：${checked.reason}`);
    return;
  }

  const msg = checked.msg;
  switch (msg.t) {
    case 'hello': {
      if (msg.v !== PROTOCOL_V) {
        log('warn', `roost 报的协议版本是 ${msg.v}，按 v1 尽力处理`);
      }
      if (!handshaken) {
        handshaken = true;
        log('info', `握手完成：roost=${msg.roost}`);
        // 启动期就发现的坏包，握手后再按协议补一条 log（§9：不静默）。
        if (petPackProblem) sendToRoost({ t: 'log', level: 'warn', msg: petPackProblem });
      }
      return;
    }
    case 'say': {
      // §6.1：先校验（上面已做）→ 立刻 ack → 再入队。
      sendToRoost({ t: 'ack', id: msg.id });
      const status = bubbles.push({ id: msg.id, seq: msg.seq, text: msg.text });
      if (status === 'duplicate') log('debug', `重复的 say 已丢弃：${msg.id}#${msg.seq}`);
      return;
    }
    case 'state': {
      lastState = { state: msg.state, why: msg.why };
      toRenderer('pet:state', lastState);
      return;
    }
    case 'act': {
      // 第 1 步只记下，不动画；第 4 步接动作。
      toRenderer('pet:act', { action: msg.action, why: msg.why });
      return;
    }
    case 'bye': {
      shutdown('roost-bye');
      return;
    }
    default:
      return;
  }
}

/**
 * 读 stdin。
 *
 * 不能直接用 process.stdin：Windows 上 Electron 是 GUI 子系统进程，
 * 主进程里 process.stdin 是个没有底层句柄的空流（一挂上就 'end'），
 * 但 fd 0 本身是好的，fs.read 能读到父进程写的字节。
 * 所以这里自己按 fd 0 拉，顺便把半包交给 LineDecoder。
 */
function startReadingStdin() {
  const utf8 = new StringDecoder('utf8');
  const buf = Buffer.alloc(64 * 1024);
  let stopped = false;

  const feed = (chunk) => {
    const { lines, problems } = decoder.push(chunk);
    for (const p of problems) {
      reportWarn(`stdin 丢了一截：${p.kind}${p.bytes ? ` ${p.bytes}B` : ''}`);
    }
    for (const line of lines) handleLine(line);
  };

  const finish = (reason) => {
    if (stopped) return;
    stopped = true;
    const rest = utf8.end();
    if (rest) feed(rest);
    const tail = decoder.flush();
    for (const line of tail.lines) handleLine(line);
    shutdown(reason);
  };

  const pump = () => {
    if (stopped) return;
    fs.read(0, buf, 0, buf.length, null, (err, n) => {
      if (stopped) return;
      if (err) {
        if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
          setTimeout(pump, 10);
          return;
        }
        log('warn', `stdin 读不了：${err.code || err.message}`);
        finish('stdin-error');
        return;
      }
      if (n === 0) {
        finish('stdin-eof');
        return;
      }
      feed(utf8.write(buf.subarray(0, n)));
      pump();
    });
  };

  stdinStop = () => { stopped = true; };
  pump();

  process.stdout.on('error', () => {
    stdoutOk = false;
    shutdown('stdout-error');
  });
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function px(n) {
  return Math.round(n * args.size);
}

function geometry() {
  const width = px(BASE.width);
  const body = px(BASE.body);
  const bubble = px(BASE.bubble);
  return { width, body, bubble, minHeight: body + bubble };
}

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

// .userdata/body.pid：让 roost 能分清"另一只活 body"和"上一轮留下的锁"。
// 崩溃时这个文件不会被删——那正是它的用处。
function writePidRecord() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(
      userDataFile('body.pid'),
      serializePidRecord({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        version: BODY_ID,
      }),
      'utf8',
    );
  } catch (err) {
    log('warn', `body.pid 没写成：${err.message}`);
  }
}

function removePidRecord() {
  try {
    const raw = fs.readFileSync(userDataFile('body.pid'), 'utf8');
    const rec = parsePidRecord(raw);
    // 只删自己的：别把下一只还没写好的记录删了。
    if (rec && rec.pid === process.pid) fs.unlinkSync(userDataFile('body.pid'));
  } catch {
    /* 不在、坏了、删不掉，都不影响退出 */
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 单实例锁没抢到时，把锁的主人写清楚：roost 才知道是清理还是放弃。 */
function describeLockHolder() {
  try {
    const rec = parsePidRecord(fs.readFileSync(userDataFile('body.pid'), 'utf8'));
    if (!rec) return 'body.pid 存在但读不懂（旧版本写的？）';
    return `pid=${rec.pid} 启动于 ${rec.startedAt} 版本 ${rec.version || '未知'} 存活=${pidAlive(rec.pid) ? 'yes' : 'no'}`;
  } catch {
    return '没有 body.pid（上一只可能是旧版本，或没来得及写）';
  }
}

// ---------------------------------------------------------------------------
// 宠物包（§9）：<repo>/pets/<id>/pet.json，或 --pet-dir=<目录> 直接指。
// 没有包就画占位团子；包坏了报错但不崩。
// ---------------------------------------------------------------------------

let petPack = null;
let petPackProblem = '';

function packDir() {
  return args.petDir ? path.resolve(args.petDir) : path.join(__dirname, '..', 'pets', args.pet);
}

function loadPetPack() {
  const dir = packDir();

  if (args.petDir) {
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('不是目录');
    } catch (err) {
      // §12：宠物包根目录不可读 → 参数/配置错，退出码 4。
      log('error', `宠物包目录不可读：${dir}（${err.message}）`);
      return false;
    }
  }

  const res = inspectPack(dir);
  if (!res.ok) {
    petPackProblem = `宠物包没加载（${dir}）：${res.errors.join('；')}`;
    log('warn', petPackProblem);
    if (args.petDir) return false; // 显式指了却坏了：按配置错退
    return true; // 默认包缺失不算错：画占位
  }

  for (const w of res.warnings) log('warn', `宠物包：${w}`);
  petPack = res.pack;
  log('info', `宠物包已加载：${petPack.id}/${petPack.name}，组 ${Object.keys(petPack.animations).join(',')}`);
  return true;
}

/** 给 renderer 的包描述：路径换成 file://，渲染层不用知道盘上的目录结构。 */
function packForRenderer() {
  if (!petPack) return null;
  const url = (rel) => pathToFileURL(path.join(petPack.dir, rel)).href;
  const list = (arr) => arr.map(url);

  const animations = {};
  for (const [key, value] of Object.entries(petPack.animations)) {
    if (Array.isArray(value)) animations[key] = list(value);
    else {
      animations[key] = {};
      for (const [sub, files] of Object.entries(value)) animations[key][sub] = list(files);
    }
  }

  return { id: petPack.id, name: petPack.name, size: petPack.size, animations };
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(userDataFile('window.json'), 'utf8');
    const j = JSON.parse(raw);
    if (Number.isFinite(j.x) && Number.isFinite(j.y)) return { x: j.x, y: j.y };
  } catch {
    /* 没有、坏了，都按默认位置来 */
  }
  return null;
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userDataFile('window.json'), JSON.stringify({ x: b.x, y: b.y }), 'utf8');
  } catch (err) {
    log('warn', `window.json 没写成：${err.message}`);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveWindowState();
  }, SAVE_DEBOUNCE_MS);
}

function clampToWorkArea(x, y, width, height) {
  const d = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  });
  const a = d.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, a.x), Math.max(a.x, a.x + a.width - width))),
    y: Math.round(Math.min(Math.max(y, a.y), Math.max(a.y, a.y + a.height - height))),
  };
}

function defaultPosition(width, height) {
  const a = screen.getPrimaryDisplay().workArea;
  switch (args.position) {
    case 'bottom-left':
      return { x: a.x + MARGIN, y: a.y + a.height - height - MARGIN };
    case 'top-right':
      return { x: a.x + a.width - width - MARGIN, y: a.y + MARGIN };
    case 'top-left':
      return { x: a.x + MARGIN, y: a.y + MARGIN };
    case 'center':
      return {
        x: a.x + Math.round((a.width - width) / 2),
        y: a.y + Math.round((a.height - height) / 2),
      };
    case 'bottom-right':
    default:
      return { x: a.x + a.width - width - MARGIN, y: a.y + a.height - height - MARGIN };
  }
}

function createWindow() {
  const g = geometry();
  const saved = readWindowState();
  const pos = saved
    ? clampToWorkArea(saved.x, saved.y, g.width, g.minHeight)
    : defaultPosition(g.width, g.minHeight);

  win = new BrowserWindow({
    width: g.width,
    height: g.minHeight,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setSkipTaskbar(true);
  if (typeof win.setMenu === 'function') win.setMenu(null);

  // §13：Windows 上要 forward:true 才能继续收到 mousemove，才谈得上"指针在身体上时关穿透"。
  if (args.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => {
    // 不抢焦点：开机时别把她正在打字的窗口顶掉。
    win.showInactive();
  });

  win.on('move', scheduleSave);
  win.on('closed', () => {
    win = null;
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', `渲染进程没了：${details.reason}`);
    shutdown('renderer-gone');
  });

  return win;
}

/** 气泡放不下就往上长（§5.4），底边不动。 */
function resizeForBubble(wantedHeight) {
  if (!win || win.isDestroyed()) return;
  const g = geometry();
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const maxHeight = Math.max(g.minHeight, Math.floor(display.workArea.height * 0.8));
  const height = Math.round(Math.min(Math.max(wantedHeight, g.minHeight), maxHeight));
  if (height === bounds.height) return;

  let y = bounds.y + bounds.height - height;
  if (y < display.workArea.y) y = display.workArea.y;
  win.setBounds({ x: bounds.x, y, width: bounds.width, height });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function startIpc() {
  ipcMain.on('pet:ready', () => {
    rendererReady = true;
    const g = geometry();
    win.webContents.send('pet:init', {
      scale: args.size,
      bodyHeight: g.body,
      bubbleMin: g.bubble,
      clickThrough: args.clickThrough,
      pack: packForRenderer(),
    });
    flushOutbox();
    if (lastState) win.webContents.send('pet:state', lastState);
  });

  // 指针进了身体/输入条：关穿透；出去了：恢复穿透。
  ipcMain.on('pet:hit', (_event, inside) => {
    // §4.2：--click-through=0 只关掉"初始穿透"，命中切换照常工作。
    // 整窗吃点击只是调试窗口时的入口状态，不是一条会驻留的默认路径。
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!inside, { forward: true });
  });

  ipcMain.on('pet:bubble-height', (_event, height) => {
    const n = Number(height);
    if (Number.isFinite(n)) resizeForBubble(n);
  });

  // 渲染层放不出包里的文件：stderr 记一笔，握手后也按协议 log 一条（§9 不静默）。
  ipcMain.on('pet:issue', (_event, payload) => {
    const kind = payload && payload.kind ? String(payload.kind) : 'renderer-issue';
    const detail = payload && payload.detail ? String(payload.detail) : '';
    log('warn', `渲染层报问题：${kind}${detail ? `：${detail}` : ''}`);
    sendToRoost({ t: 'log', level: 'warn', msg: `body: ${kind}${detail ? `：${detail}` : ''}` });
  });
}

// ---------------------------------------------------------------------------
// 退出
// ---------------------------------------------------------------------------

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  const code = exitCodeFor(reason, { handshaken });
  log('info', `退出：${reason}（退出码 ${code}）`);

  if (stdinStop) stdinStop();
  saveWindowState();
  removePidRecord();
  bubbles.dispose();

  // 写 bye 用同步写：渲染进程崩了以后主线程的事件循环已经不转，异步回调和
  // setTimeout 都等不到（实测 finish 回调到了但 50ms 的定时器永远不触发）。
  // 同步写把字节直接交给 OS，再退出，退出码才看得见。
  const finish = () => {
    // Windows 上渲染进程崩溃后，主线程会卡在 Chromium 的收尾里：
    // process.exit() / app.exit() 调用后都会正常返回，但进程不退出（实测 8 秒仍活着，
    // 而且此后 setTimeout 全都不触发——看门狗也救不回来）。
    // 这条路径只有一个可靠出口：SIGKILL 走 TerminateProcess，立即退；
    // 渲染崩本来就该是退出码 1，和 exitCodeFor 的结果一致。
    if (process.platform === 'win32' && reason === 'renderer-gone') {
      try {
        process.kill(process.pid, 'SIGKILL');
        return;
      } catch (err) {
        log('warn', `SIGKILL 失败，退回 process.exit：${err.message}`);
      }
    }
    process.exit(code);
  };

  if (handshaken) {
    try {
      fs.writeSync(1, encode({ t: 'bye' }) + '\n');
    } catch (err) {
      log('warn', `bye 没写成：${err.message}`);
    }
  }
  // 握手没完成只许发 hello（§2.1），bye 都不发。
  finish();

  // 看门狗：万一 finish 之前就卡住，也必须在 2.5 秒内退。
  // 不能 .unref()——它正是用来兜住"已经没有别的东西在跑"的那种卡死。
  setTimeout(() => {
    log('warn', '退出超时，硬退');
    process.exit(code === EXIT.OK ? EXIT.CRASH : code);
  }, EXIT_DEADLINE_MS);
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

function boot() {
  // §4.2：不认的协议版本要写 stderr 并按退出码 2 退，不要硬跑。
  if (!args.protocolOk) {
    log('error', `不认的协议版本：--protocol=${args.protocol ?? '(非整数)'}，只认 1`);
    shutdown('protocol-error');
    return;
  }

  // §9：宠物包装不上就画占位；但 --pet-dir 显式指了坏目录，按配置错退 4。
  if (!loadPetPack()) {
    shutdown('config-error');
    return;
  }

  startReadingStdin();
  startIpc();

  app.whenReady().then(() => {
    // §2.1：3 秒内发 hello，握手前只发它。
    sendToRoost({ t: 'hello', v: PROTOCOL_V, body: BODY_ID, pet: args.pet });
    createWindow();
  });

  app.on('window-all-closed', () => shutdown('window-closed'));
  app.on('before-quit', () => saveWindowState());

  process.on('SIGINT', () => shutdown('signal'));
  process.on('SIGTERM', () => shutdown('signal'));

  if (args.clickThrough) log('info', '默认穿透，指针压到身体上才吃点击');
  log('info', `启动 ${BODY_ID}，尺寸 x${args.size}，位置 ${args.position}`);
}

// §7.4 单实例：第二只直接退，stderr 说清是谁拿着锁。
if (!app.requestSingleInstanceLock()) {
  log('warn', `已经有一只 body 在跑了（单实例锁没抢到），这只退出。${describeLockHolder()}`);
  app.exit(EXIT.SECOND_INSTANCE);
} else {
  writePidRecord();
  app.on('second-instance', () => log('info', '第二只被单实例锁挡回去了'));
  boot();
}

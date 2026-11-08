'use strict';

/**
 * 渲染层。它不知道协议，也不写字——只把主进程推过来的东西显示出来：
 * 气泡、五档姿态、宠物包画面、只读状态、指针命中上报。
 */

const api = window.pet;

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleZone = document.getElementById('bubble-zone');
// 不能叫 pet：contextBridge 把 window.pet 定义成不可配置的全局属性，
// 顶层 const pet 会直接报 Identifier 'pet' has already been declared。
const petEl = document.getElementById('pet');
const video = document.getElementById('pet-video');
const image = document.getElementById('pet-img');
const status = document.getElementById('status');
const statusState = document.getElementById('status-state');
const statusWhy = document.getElementById('status-why');

const STATE_LABEL = {
  thinking: '想',
  acting: '做',
  waiting: '等',
  error: '错',
  done: '完',
};

const STATES = new Set(Object.keys(STATE_LABEL));

// 一张图当一帧播多久；webm 交给 <video> 自己按片长走。
const FRAME_MS = 110;

let bodyHeight = 300;
let pack = null;
let quiet = false;
let sleeping = false;          // 现在是不是睡姿
let roostSleeping = false;     // roost 判不判睡（只认 act sleep/wake，不按时间猜）
let currentState = 'waiting';
let revertTimer = null;
let actTimer = null;
let pendingRevert = false;

// 播放令牌：每次停/换都 +1，旧序列发现令牌变了就自己退出。
let seqToken = 0;

// ---------------------------------------------------------------------------
// 窗口高度：气泡要多少就给多少，主进程负责往上长
// ---------------------------------------------------------------------------

function reportHeight() {
  const bubbleHeight = Math.ceil(bubbleZone.getBoundingClientRect().height);
  api.bubbleHeight(bubbleHeight + bodyHeight);
}

function reportHeightSoon() {
  // 两帧：一帧等样式和字体落下去，一帧等布局稳。
  requestAnimationFrame(() => requestAnimationFrame(reportHeight));
}

// ---------------------------------------------------------------------------
// 宠物包：按名字找一组画面，找不到就按 §9 的回退链退
// ---------------------------------------------------------------------------

function hasPack() {
  return Boolean(pack && pack.animations && Object.keys(pack.animations).length);
}

function resolveGroup(name) {
  const a = pack && pack.animations;
  if (!a) return null;

  // actions.nod → click → turn.left → breathing
  if (name.startsWith('actions.')) {
    const key = name.slice('actions.'.length);
    const specific = a.actions && a.actions[key];
    return specific || a.click || (a.turn && a.turn.left) || a.breathing || null;
  }

  if (name.startsWith('turn.')) {
    const side = a.turn && a.turn[name.slice('turn.'.length)];
    return side || a.breathing || null;
  }

  if (name === 'sleep.end') {
    return (a.sleep && a.sleep.end) || a.breathing || null;
  }

  // states.thinking → look → turn.left → breathing：没配档位也别静默不动。
  if (name.startsWith('states.')) {
    const key = name.slice('states.'.length);
    const specific = a.states && a.states[key];
    return specific || a.look || (a.turn && a.turn.left) || a.breathing || null;
  }

  return a[name] || a.breathing || null;
}

function reportIssue(kind, detail) {
  try {
    api.issue({ kind, detail });
  } catch {
    /* 报不出去也不能崩 */
  }
}

function playOne(url) {
  return new Promise((resolve, reject) => {
    if (/\.(webm|mp4|m4v|mov)([?#]|$)/i.test(url)) {
      image.hidden = true;
      video.hidden = false;
      video.loop = false;
      video.onended = () => resolve();
      video.onerror = () => reject(new Error(`视频放不出来：${url}`));
      video.src = url;
      const started = video.play();
      if (started && typeof started.catch === 'function') {
        started.catch((err) => {
          // 换 src 打断上一次 play 会抛 AbortError：那是我们自己换的，不算坏。
          if (err && err.name === 'AbortError') resolve();
          else reject(new Error(`视频起不来：${url}（${err && err.message}）`));
        });
      }
    } else {
      video.hidden = true;
      image.hidden = false;
      image.onload = () => setTimeout(resolve, FRAME_MS);
      image.onerror = () => reject(new Error(`图片放不出来：${url}`));
      image.src = url;
    }
  });
}

/** 一串画面按顺序播；loop 时播完回到第一张。token 变了就停。 */
async function runSequence(urls, { loop = false, token }) {
  if (!urls || !urls.length) return 'empty';
  let i = 0;

  while (true) {
    if (token !== seqToken) return 'cancelled';
    try {
      await playOne(urls[i]);
    } catch (err) {
      reportIssue('pack-playback', err.message);
      return 'failed';
    }
    if (token !== seqToken) return 'cancelled';

    i += 1;
    if (i >= urls.length) {
      if (!loop) return 'done';
      i = 0;
    }
  }
}

function stopPlayback() {
  seqToken += 1;
  video.pause();
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    /* 有些状态下调 load 会抛，忽略 */
  }
  video.hidden = true;
  image.hidden = true;
}

/** 播一串画面；播完回到呼吸。 */
function playUrlsOnce(urls, { thenIdle = true } = {}) {
  if (!urls || !urls.length) return false;

  stopPlayback();
  const token = ++seqToken;
  runSequence(urls, { token }).then((result) => {
    if (token !== seqToken) return;
    if (result === 'failed') {
      fallBackToPlaceholder();
      return;
    }
    if (thenIdle) startIdle();
  });
  return true;
}

function playUrlsLoop(urls) {
  if (!urls || !urls.length) return false;

  stopPlayback();
  const token = ++seqToken;
  runSequence(urls, { loop: true, token }).then((result) => {
    if (result === 'failed') fallBackToPlaceholder();
  });
  return true;
}

/** 播放一次某组画面；播完回到呼吸。 */
function playOnce(name, opts) {
  return playUrlsOnce(resolveGroup(name), opts);
}

function playLoop(name) {
  return playUrlsLoop(resolveGroup(name));
}

function startIdle() {
  if (sleeping) return;
  if (!hasPack()) return;
  playLoop('breathing');
}

function fallBackToPlaceholder() {
  pack = null;
  petEl.dataset.pack = '0';
  delete petEl.dataset.sleep;
  sleeping = false;
  stopPlayback();
}

// ---------------------------------------------------------------------------
// 底噪：呼吸是常态，张望/打盹/伸懒腰每隔几分钟换一次（§6，间隔 ≥3 分钟）
// ---------------------------------------------------------------------------

const AMBIENT_KINDS = ['look', 'doze', 'stretch'];
const AMBIENT_HOLD_MS = { look: 2800, doze: 20000, stretch: 1800 };

let ambientMin = 180000;
let ambientMax = 300000;
let ambientTimer = null;
let ambientEndTimer = null;

function ambientAllowed() {
  // 睡着、quiet、在说话（气泡）或有档位在身时都不切。
  return !quiet && !sleeping && (petEl.dataset.state || 'waiting') === 'waiting' && bubble.hidden;
}

function cancelAmbient() {
  clearTimeout(ambientTimer);
  clearTimeout(ambientEndTimer);
  ambientTimer = null;
  ambientEndTimer = null;
  delete petEl.dataset.ambient;
}

function scheduleAmbient() {
  clearTimeout(ambientTimer);
  ambientTimer = null;
  // 被挡住时不排：等 quiet 结束、醒来、气泡收起这些恢复点各自再排。
  if (!ambientAllowed()) return;
  const span = Math.max(0, ambientMax - ambientMin);
  ambientTimer = setTimeout(runAmbient, ambientMin + Math.random() * span);
}

function runAmbient() {
  ambientTimer = null;
  if (!ambientAllowed()) {
    scheduleAmbient();
    return;
  }

  const kind = AMBIENT_KINDS[Math.floor(Math.random() * AMBIENT_KINDS.length)];
  petEl.dataset.ambient = kind;

  if (hasPack()) {
    if (kind === 'doze') playLoop('doze');
    else playOnce(kind, { thenIdle: false });
  }

  ambientEndTimer = setTimeout(() => {
    delete petEl.dataset.ambient;
    if (!sleeping && !quiet && (petEl.dataset.state || 'waiting') === 'waiting') startIdle();
    scheduleAmbient();
  }, AMBIENT_HOLD_MS[kind]);
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

const ACT_MS = {
  nod: 420,
  shake: 420,
  bounce: 520,
  shy: 700,
  laugh: 1120,
  stretch: 900,
  wake: 600,
  quiet: 0,
  loud: 480,
};

function playAct(action) {
  if (action === 'sleep') {
    roostSleeping = true;
    enterSleep();
    return;
  }
  if (action === 'wake') {
    roostSleeping = false;
    leaveSleep();
  }
  if (action === 'quiet') {
    // §6：quiet 停底噪切换，不隐藏。
    quiet = true;
    cancelAmbient();
    if (!sleeping) startIdle();
    return;
  }
  if (action === 'loud') {
    quiet = false;
    scheduleAmbient();
  }

  // CSS 骨架先动起来，包里有这组画面的话再盖上去。
  delete petEl.dataset.act;
  void petEl.offsetWidth; // 让同名动画能重放
  petEl.dataset.act = action;

  if (ACT_MS[action]) {
    clearTimeout(actTimer);
    actTimer = setTimeout(() => {
      delete petEl.dataset.act;
    }, ACT_MS[action]);
  }

  const specific = pack && pack.animations && pack.animations.actions && pack.animations.actions[action];
  if (sleeping) return;
  if (specific) playOnce(`actions.${action}`);
}

function enterSleep() {
  if (sleeping) return;
  sleeping = true;
  cancelAmbient();
  petEl.dataset.sleep = '1';
  delete petEl.dataset.act;
  playSleepLoop();
}

/** 睡姿的循环画面（拖完落地、临时唤回睡姿时也走这里）。 */
function playSleepLoop() {
  if (!hasPack()) return;
  const s = pack.animations.sleep;
  if (!s) {
    playLoop('breathing');
    return;
  }

  stopPlayback();
  const token = ++seqToken;
  const start = s.start || [];
  const loop = s.loop || start;

  runSequence(start, { token })
    .then((result) => {
      if (token !== seqToken) return;
      if (result === 'failed') {
        fallBackToPlaceholder();
        return;
      }
      if (loop && loop.length) runSequence(loop, { loop: true, token });
    })
    .catch(() => {});
}

function leaveSleep() {
  if (!sleeping) return;
  sleeping = false;
  currentState = 'waiting';
  delete petEl.dataset.sleep;

  if (pendingRevert) {
    pendingRevert = false;
    showState('waiting', '');
  }

  const s = pack && pack.animations && pack.animations.sleep;
  if (hasPack() && s && s.end && s.end.length) playOnce('sleep.end');
  else startIdle();

  scheduleAmbient();
}

// ---------------------------------------------------------------------------
// 气泡
// ---------------------------------------------------------------------------

api.onBubble(({ text }) => {
  cancelAmbient();
  bubbleText.textContent = text;
  bubble.hidden = false;
  reportHeightSoon();
});

api.onBubbleHide(() => {
  if (bubble.hidden) return;
  bubble.hidden = true;
  reportHeightSoon();
  scheduleAmbient();
});

// ---------------------------------------------------------------------------
// 五档（只读显示）。done/error 只改姿态，2–5 秒后自己回 waiting。
// ---------------------------------------------------------------------------

function showState(state, why) {
  if (state !== 'waiting') cancelAmbient();
  petEl.dataset.state = state;
  status.hidden = false;
  status.dataset.state = state;
  statusState.textContent = STATE_LABEL[state] || state;
  statusWhy.textContent = why || '';
}

function scheduleRevert() {
  clearTimeout(revertTimer);
  revertTimer = setTimeout(
    () => {
      if (sleeping) {
        // 睡着了就先停在睡姿，醒来再回 waiting（§6：done/error 只改姿态）。
        pendingRevert = true;
        return;
      }
      showState('waiting', '');
    },
    2500 + Math.random() * 2500,
  );
}

/** 收起睡姿，但不动 roost 的醒睡判断：thinking/acting 到了就先睁眼。 */
function wakePose() {
  if (!sleeping) return;
  sleeping = false;
  pendingRevert = false;
  delete petEl.dataset.sleep;
  stopPlayback();
}

/** 按当前档位恢复循环画面：想/做播档位，其余呼吸。 */
function resumeStatePlayback() {
  if (sleeping) return;
  if (currentState === 'thinking' || currentState === 'acting') {
    if (playLoop(`states.${currentState}`)) return;
  }
  startIdle();
}

api.onState(({ state, why }) => {
  if (!STATES.has(state)) return;
  currentState = state;

  // 判据只用 roost 推来的 state/act：她在想/在做，就不该还摊着睡。
  if (state === 'thinking' || state === 'acting') wakePose();

  pendingRevert = false;
  showState(state, why);
  clearTimeout(revertTimer);

  if (state === 'done' || state === 'error') {
    scheduleRevert();
    resumeStatePlayback();
    return;
  }

  if (state === 'waiting') {
    // roost 仍判睡（最后一次 act 是 sleep）就收回睡姿；它说不睡才起底噪。
    if (roostSleeping) enterSleep();
    else if (!sleeping) {
      startIdle();
      scheduleAmbient();
    }
    return;
  }

  resumeStatePlayback();
});

api.onAct(({ action }) => playAct(action));

// ---------------------------------------------------------------------------
// 拖拽与单击：拖走时用主进程 setPosition，单击播 click 并报 poke
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 4; // 超过几个 CSS 像素才算拖，不算点
let dragSession = null;
let dragRestore = null; // 拖完回到哪：'sleep' | 'state' | 'idle'

function beginDrag(event) {
  dragSession = { startX: event.screenX, startY: event.screenY, moved: false };
  try {
    petEl.setPointerCapture(event.pointerId);
  } catch {
    /* 没有捕获也能拖 */
  }
  api.dragStart({ x: event.screenX, y: event.screenY });

  const urls = resolveGroup('drag');
  if (urls && urls.length) {
    dragRestore = sleeping
      ? 'sleep'
      : currentState === 'thinking' || currentState === 'acting'
        ? 'state'
        : 'idle';
    playLoop('drag');
  }
}

function endDrag(event, { cancelled = false } = {}) {
  const session = dragSession;
  if (!session) return;
  dragSession = null;
  try {
    petEl.releasePointerCapture(event.pointerId);
  } catch {
    /* 已经松开 */
  }
  api.dragEnd();

  if (session.moved) {
    if (dragRestore === 'sleep') playSleepLoop();
    else if (dragRestore === 'state') resumeStatePlayback();
    else startIdle();
    dragRestore = null;
    scheduleAmbient();
    return;
  }

  dragRestore = null;
  if (cancelled) return;

  // 单击：包里点一次（随机挑一段），没包就用 CSS 骨架轻跳一下。
  const clips = resolveGroup('click');
  if (clips && clips.length) {
    playUrlsOnce([clips[Math.floor(Math.random() * clips.length)]]);
  } else {
    playAct('bounce');
  }
  api.poke({ x: Math.round(event.clientX), y: Math.round(event.clientY) });
}

petEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  beginDrag(event);
});

petEl.addEventListener('pointermove', (event) => {
  if (!dragSession) return;
  if (
    !dragSession.moved &&
    Math.hypot(event.screenX - dragSession.startX, event.screenY - dragSession.startY) >
      DRAG_THRESHOLD
  ) {
    dragSession.moved = true;
  }
  if (dragSession.moved) api.dragMove({ x: event.screenX, y: event.screenY });
});

petEl.addEventListener('pointerup', (event) => endDrag(event));
petEl.addEventListener('pointercancel', (event) => endDrag(event, { cancelled: true }));

// ---------------------------------------------------------------------------
// 命中：指针在身体上才吃点击，其余时候穿透
// ---------------------------------------------------------------------------

let lastHit = null;

function insidePet(x, y) {
  const r = petEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function reportHit(inside) {
  if (inside === lastHit) return;
  lastHit = inside;
  api.hit(inside);
}

// Windows 上 click-through 窗口收不到指针消息时，主进程靠这个矩形轮询光标。
// 多显示器 / 高 DPI 下都是窗口内 CSS 像素，主进程自己加上窗口位置。
function reportHitBox() {
  const r = petEl.getBoundingClientRect();
  api.hitBox({
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  });
}

window.addEventListener('resize', () => {
  reportHitBox();
  reportHeightSoon();
});

window.addEventListener(
  'pointermove',
  (event) => reportHit(insidePet(event.clientX, event.clientY)),
  { passive: true },
);
window.addEventListener('pointerleave', () => reportHit(false));
window.addEventListener('blur', () => reportHit(false));

// 渲染层自己没接住的错，也报给主进程，别在控制台里沉默。
window.addEventListener('error', (event) => {
  reportIssue('renderer-error', String(event.message || 'unknown'));
});

// ---------------------------------------------------------------------------
// 起步
// ---------------------------------------------------------------------------

api.onInit(({ scale, bodyHeight: body, bubbleMin, ambientMinMs, ambientMaxMs, pack: packInfo }) => {
  document.documentElement.style.setProperty('--scale', String(scale));
  document.documentElement.style.setProperty('--body-h', `${body}px`);
  document.documentElement.style.setProperty('--bubble-min', `${bubbleMin}px`);
  bodyHeight = body;
  if (Number.isFinite(ambientMinMs) && ambientMinMs > 0) ambientMin = ambientMinMs;
  if (Number.isFinite(ambientMaxMs) && ambientMaxMs > 0) ambientMax = Math.max(ambientMin, ambientMaxMs);

  if (packInfo && packInfo.animations && Object.keys(packInfo.animations).length) {
    pack = packInfo;
    petEl.dataset.pack = '1';
    document.documentElement.style.setProperty('--pack-size', String(pack.size || 1));
    startIdle();
  }

  reportHeight();
  reportHitBox();
  scheduleAmbient();
});

api.ready();

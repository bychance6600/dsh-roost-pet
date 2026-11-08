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
let sleeping = false;
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
        started.catch(() => reject(new Error(`视频起不来：${url}`)));
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

/** 播放一次某组画面；播完回到呼吸。 */
function playOnce(name, { thenIdle = true } = {}) {
  const urls = resolveGroup(name);
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

function playLoop(name) {
  const urls = resolveGroup(name);
  if (!urls || !urls.length) return false;

  stopPlayback();
  const token = ++seqToken;
  runSequence(urls, { loop: true, token }).then((result) => {
    if (result === 'failed') fallBackToPlaceholder();
  });
  return true;
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
    enterSleep();
    return;
  }
  if (action === 'wake') {
    leaveSleep();
  }
  if (action === 'quiet') {
    // §6：quiet 停底噪切换，不隐藏。
    quiet = true;
    return;
  }
  if (action === 'loud') {
    quiet = false;
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
  petEl.dataset.sleep = '1';
  delete petEl.dataset.act;

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
  delete petEl.dataset.sleep;

  if (pendingRevert) {
    pendingRevert = false;
    showState('waiting', '');
  }

  const s = pack && pack.animations && pack.animations.sleep;
  if (hasPack() && s && s.end && s.end.length) playOnce('sleep.end');
  else startIdle();
}

// ---------------------------------------------------------------------------
// 气泡
// ---------------------------------------------------------------------------

api.onBubble(({ text }) => {
  bubbleText.textContent = text;
  bubble.hidden = false;
  reportHeightSoon();
});

api.onBubbleHide(() => {
  if (bubble.hidden) return;
  bubble.hidden = true;
  reportHeightSoon();
});

// ---------------------------------------------------------------------------
// 五档（只读显示）。done/error 只改姿态，2–5 秒后自己回 waiting。
// ---------------------------------------------------------------------------

function showState(state, why) {
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

api.onState(({ state, why }) => {
  if (!STATES.has(state)) return;
  pendingRevert = false;
  showState(state, why);
  clearTimeout(revertTimer);
  if (state === 'done' || state === 'error') scheduleRevert();
});

api.onAct(({ action }) => playAct(action));

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

api.onInit(({ scale, bodyHeight: body, bubbleMin, pack: packInfo }) => {
  document.documentElement.style.setProperty('--scale', String(scale));
  document.documentElement.style.setProperty('--body-h', `${body}px`);
  document.documentElement.style.setProperty('--bubble-min', `${bubbleMin}px`);
  bodyHeight = body;

  if (packInfo && packInfo.animations && Object.keys(packInfo.animations).length) {
    pack = packInfo;
    petEl.dataset.pack = '1';
    document.documentElement.style.setProperty('--pack-size', String(pack.size || 1));
    startIdle();
  }

  reportHeight();
});

api.ready();

'use strict';

/**
 * 渲染层。它不知道协议，也不写字——只把主进程推过来的东西显示出来。
 * 第 1 步只需要：气泡、占位身体、只读状态、指针命中上报。
 */

const api = window.pet;

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleZone = document.getElementById('bubble-zone');
// 不能叫 pet：contextBridge 把 window.pet 定义成不可配置的全局属性，
// 顶层 const pet 会直接报 Identifier 'pet' has already been declared。
const petEl = document.getElementById('pet');
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

let bodyHeight = 300;

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
// 只读状态
// ---------------------------------------------------------------------------

api.onState(({ state, why }) => {
  status.hidden = false;
  status.dataset.state = state;
  statusState.textContent = STATE_LABEL[state] || state;
  statusWhy.textContent = why || '';
});

// 第 1 步不演动作，只把消息记在 DOM 上，方便第 4 步接。
api.onAct(({ action }) => {
  document.body.dataset.lastAction = action;
});

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

// ---------------------------------------------------------------------------
// 起步
// ---------------------------------------------------------------------------

api.onInit(({ scale, bodyHeight: body, bubbleMin }) => {
  document.documentElement.style.setProperty('--scale', String(scale));
  document.documentElement.style.setProperty('--body-h', `${body}px`);
  document.documentElement.style.setProperty('--bubble-min', `${bubbleMin}px`);
  bodyHeight = body;
  reportHeight();
});

api.ready();

'use strict';

/**
 * 气泡排程测试。用假时钟，不真的等 2.5 秒。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { BubbleQueue, holdMsFor, MIN_HOLD_MS, MAX_HOLD_MS } = require('../lib/bubbles');

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();

  return {
    now: () => now,
    setTimer: (fn, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.at)) {
            nextId = id;
            next = timer;
          }
        }
        if (!next) break;
        timers.delete(nextId);
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

function harness(opts = {}) {
  const clock = fakeClock();
  const shown = [];
  const logs = [];
  let idles = 0;
  const queue = new BubbleQueue({
    onShow: (item) => shown.push(item),
    onIdle: () => {
      idles += 1;
    },
    log: (msg) => logs.push(msg),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...opts,
  });
  return { clock, queue, shown, logs, idles: () => idles };
}

// ---------------------------------------------------------------------------
// 时长
// ---------------------------------------------------------------------------

test('时长 = clamp(字数/12, 2.5s, 10s)', () => {
  assert.equal(holdMsFor(''), MIN_HOLD_MS);
  assert.equal(holdMsFor('晚安'), MIN_HOLD_MS);
  assert.equal(holdMsFor('字'.repeat(30)), 2500); // 30/12 < 2.5s
  assert.equal(holdMsFor('字'.repeat(120)), MAX_HOLD_MS); // 10s
  assert.equal(holdMsFor('字'.repeat(72)), 6000); // 6s
});

// ---------------------------------------------------------------------------
// 显示顺序
// ---------------------------------------------------------------------------

test('来了就显示，到点再换下一条', () => {
  const h = harness();
  h.queue.push({ id: 'a', seq: 0, text: '第一句' });
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].text, '第一句');

  h.queue.push({ id: 'b', seq: 0, text: '第二句' });
  assert.equal(h.shown.length, 1, '第一条还在显示，第二条排队');

  h.clock.advance(MIN_HOLD_MS);
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[1].text, '第二句');

  h.clock.advance(MIN_HOLD_MS);
  assert.equal(h.idles(), 1);
});

test('队列空着就绝不冒字', () => {
  const h = harness();
  h.clock.advance(60000);
  assert.equal(h.shown.length, 0);
});

test('同 id 同 seq 只显示一次，重复的被丢掉', () => {
  const h = harness();
  assert.equal(h.queue.push({ id: 's1', seq: 0, text: '一次' }), 'queued');
  assert.equal(h.queue.push({ id: 's1', seq: 0, text: '一次' }), 'duplicate');
  h.clock.advance(20000);
  assert.equal(h.shown.length, 1);
});

test('同 id 不同 seq 是同一轮的分条，都要显示且按 seq 升序', () => {
  const h = harness();
  h.queue.push({ id: 's1', seq: 0, text: '上' });
  h.queue.push({ id: 's1', seq: 1, text: '下' });
  h.clock.advance(MIN_HOLD_MS * 2);
  assert.deepEqual(h.shown.map((x) => x.text), ['上', '下']);
});

test('跨 id 按到达先后：后来的那条排到队尾，不插队', () => {
  const h = harness();
  h.queue.push({ id: 'a', seq: 0, text: 'a0' }); // 立刻显示
  h.queue.push({ id: 'b', seq: 0, text: 'b0' });
  h.queue.push({ id: 'a', seq: 1, text: 'a1' }); // b0 先到，a1 排它后面

  h.clock.advance(30000);
  assert.deepEqual(h.shown.map((x) => x.text), ['a0', 'b0', 'a1']);
});

test('同 id 排队的几条之间按 seq 插进去', () => {
  const h = harness();
  h.queue.push({ id: 'a', seq: 0, text: 'a0' }); // 显示中
  h.queue.push({ id: 'a', seq: 2, text: 'a2' });
  h.queue.push({ id: 'b', seq: 0, text: 'b0' });
  h.queue.push({ id: 'a', seq: 1, text: 'a1' }); // 插到 a2 前面

  h.clock.advance(30000);
  assert.deepEqual(h.shown.map((x) => x.text), ['a0', 'a1', 'a2', 'b0']);
});

test('乱序到达：seq 小的插到前面，已经显示过的不重排', () => {
  const h = harness();
  h.queue.push({ id: 'a', seq: 2, text: 'a2' }); // 先到，先显示
  h.queue.push({ id: 'a', seq: 0, text: 'a0' });
  h.clock.advance(30000);
  assert.deepEqual(h.shown.map((x) => x.text), ['a2', 'a0']);
});

// ---------------------------------------------------------------------------
// 背压
// ---------------------------------------------------------------------------

test('队列满 20 条：丢最新的，只告警一次', () => {
  const h = harness();
  h.queue.push({ id: 's0', seq: 0, text: '正在显示' });
  for (let i = 0; i < 30; i += 1) {
    h.queue.push({ id: `s${i + 1}`, seq: 0, text: `第 ${i} 条` });
  }
  assert.equal(h.queue.pending, 20);
  assert.equal(h.logs.length, 1, '同一类告警不刷屏');
  assert.match(h.logs[0], /队列满/);
});

test('丢掉的 say 也已经过了 dedupe：重发算 duplicate，不是新的一条', () => {
  const h = harness();
  h.queue.push({ id: 's0', seq: 0, text: 'x' });
  for (let i = 0; i < 25; i += 1) h.queue.push({ id: `n${i}`, seq: 0, text: 'y' });
  const dropped = 'n24';
  assert.equal(h.queue.push({ id: dropped, seq: 0, text: 'y' }), 'duplicate');
});

test('dispose 之后定时器不再叫', () => {
  const h = harness();
  h.queue.push({ id: 'a', seq: 0, text: 'x' });
  h.queue.dispose();
  h.clock.advance(60000);
  assert.equal(h.shown.length, 1);
});

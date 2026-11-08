'use strict';

/**
 * lib/physics.js 的单元测试：弹簧、初速估算、抛掷积分、挤压。
 * 都是纯函数，用假时间与固定轨迹即可，不需要真窗口。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  springStep,
  softClampSpeed,
  trimTrail,
  estimateReleaseVelocity,
  throwSubsteps,
  throwStep,
  squashDepth,
  MAX_THROW_SPEED,
  GRAVITY,
  RESTITUTION,
} = require('../lib/physics');

test('弹簧从静止出发，若干帧后靠近目标且不越过', () => {
  let v = 0;
  let x = 0;
  const target = 100;
  for (let i = 0; i < 60; i += 1) {
    v = springStep(v, x, target, 1 / 60);
    x += v / 60;
  }
  assert.ok(x > 90, `应该追到目标附近，实际 ${x}`);
  assert.ok(x <= target + 1, `过阻尼不该 overshoot，实际 ${x}`);
});

test('弹簧 dt 上限 1/30：给再大的 dt 也只走一步', () => {
  const a = springStep(0, 0, 100, 1 / 30);
  const b = springStep(0, 0, 100, 10);
  assert.equal(a, b);
});

test('软钳速单调、不超过上限', () => {
  let prev = -1;
  for (const s of [1, 100, 1000, 3600, 10000, 1e6]) {
    const v = softClampSpeed(s);
    assert.ok(v > prev, '应该单调');
    assert.ok(v <= MAX_THROW_SPEED, `不该超过上限，实际 ${v}`);
    prev = v;
  }
  assert.equal(softClampSpeed(0), 0);
  assert.equal(softClampSpeed(-5), 0);
});

test('trimTrail 只裁窗口外的旧点', () => {
  const trail = [
    { t: 0, x: 0, y: 0 },
    { t: 150, x: 1, y: 1 },
    { t: 250, x: 2, y: 2 },
  ];
  const out = trimTrail(trail, 300);
  assert.deepEqual(out, [{ t: 150, x: 1, y: 1 }, { t: 250, x: 2, y: 2 }]);
});

test('初速：向右快速甩 100ms，估出正方向且够快', () => {
  const trail = [];
  for (let i = 0; i <= 10; i += 1) trail.push({ t: 1000 + i * 10, x: i * 12, y: 0 });
  const v = estimateReleaseVelocity(trail, 1100);
  assert.ok(v, '应该估出速度');
  assert.ok(v.vx > 500, `vx 应该为正且够快，实际 ${v.vx}`);
  assert.ok(Math.abs(v.vy) < 1e-6);
});

test('初速：慢拖不过死区，返回 null', () => {
  const trail = [];
  for (let i = 0; i <= 10; i += 1) trail.push({ t: 1000 + i * 10, x: i * 0.2, y: 0 });
  assert.equal(estimateReleaseVelocity(trail, 1100), null);
});

test('初速：松手前停太久，不跨窗口拼接', () => {
  const trail = [
    { t: 1000, x: 0, y: 0 },
    { t: 1010, x: 30, y: 0 },
    { t: 1400, x: 30, y: 0 },
  ];
  assert.equal(estimateReleaseVelocity(trail, 1600), null);
});

test('初速：采样太少或时间跨度太短 → null', () => {
  assert.equal(estimateReleaseVelocity([], 1000), null);
  assert.equal(estimateReleaseVelocity([{ t: 1000, x: 0, y: 0 }], 1000), null);
  const same = [{ t: 1000, x: 0, y: 0 }, { t: 1005, x: 50, y: 0 }];
  assert.equal(estimateReleaseVelocity(same, 1005), null);
});

test('抛掷：一帧下落速度增加 gravity×dt', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const r = throwStep({ x: 100, y: 100, vx: 0, vy: 0 }, 1 / 60, bounds);
  assert.ok(Math.abs(r.vy - GRAVITY / 60) < 1e-6);
  assert.ok(r.y > 100);
});

test('抛掷：落地反弹按 0.35 衰减，横向被摩擦吃掉', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 300 };
  const r = throwStep({ x: 100, y: 299, vx: 600, vy: 900 }, 1 / 60, bounds);
  assert.equal(r.y, 300);
  assert.ok(r.landed);
  assert.ok(r.vy < 0, '撞地后应该向上弹');
  assert.ok(Math.abs(r.vy) <= r.impact * RESTITUTION + 1e-6);
  assert.ok(r.vx < 600, '横向应该被地面摩擦吃掉一些');
  assert.ok(r.impact >= 900, `impact 应该是撞前速度，实际 ${r.impact}`);
});

test('抛掷：左右边界反弹方向正确', () => {
  const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 1000 };
  const left = throwStep({ x: 1, y: 500, vx: -300, vy: 0 }, 1 / 60, bounds);
  assert.ok(left.vx >= 0, '撞左墙后应该向右');
  const right = throwStep({ x: 199, y: 500, vx: 300, vy: 0 }, 1 / 60, bounds);
  assert.ok(right.vx <= 0, '撞右墙后应该向左');
});

test('抛掷：贴地低速会落定（atRest）', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 300 };
  const r = throwStep({ x: 100, y: 300, vx: 3, vy: 0.5 }, 1 / 60, bounds);
  assert.ok(r.atRest);
  assert.equal(r.vx, 0);
  assert.equal(r.vy, 0);
});

test('细分步数：慢速 1 步，快速多步且封顶', () => {
  assert.equal(throwSubsteps(0, 0, 1 / 60), 1);
  assert.equal(throwSubsteps(1200, 0, 1 / 60), 3);
  assert.ok(throwSubsteps(3600, 3600, 1 / 60) > 1);
  assert.ok(throwSubsteps(1e9, 1e9, 1 / 60) <= 8);
});

test('挤压深度夹在 0.08–0.26 之间', () => {
  assert.ok(squashDepth(0) >= 0.08);
  assert.ok(squashDepth(0) <= 0.09);
  assert.ok(squashDepth(1e6) <= 0.26 + 1e-9);
  assert.ok(squashDepth(3000) > squashDepth(100));
});

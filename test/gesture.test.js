'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DRAG_THRESHOLD, distance, createPointerSession } = require('../src/renderer/gesture');

test('阈值是 4 CSS 像素', () => {
  assert.equal(DRAG_THRESHOLD, 4);
});

test('distance 是欧氏距离', () => {
  assert.equal(distance(0, 0, 3, 4), 5);
  assert.equal(distance(10, 10, 10, 12), 2);
});

test('原地按下松开按点击处理，不进拖拽', () => {
  // 这条对应「原地按下松开必须发 poke、不触发 drag」：
  // up() 返回 click，渲染层才会走 poke / 睡着轻晃那条路。
  const s = createPointerSession();
  s.down(100, 100);
  assert.equal(s.move(100, 100), 'moving');
  assert.equal(s.up(), 'click');
  assert.equal(s.pressed, false);
  assert.equal(s.dragging, false);
});

test('挪 4px 以内仍是点击', () => {
  const s = createPointerSession();
  s.down(100, 100);
  assert.equal(s.move(102, 102), 'moving'); // 2.83
  assert.equal(s.move(103, 102), 'moving'); // 3.16
  assert.equal(s.up(), 'click');
});

test('超过 4px 才进拖拽，且只 start 一次', () => {
  const s = createPointerSession();
  s.down(100, 100);
  assert.equal(s.move(104, 100), 'moving'); // 正好 4，不算
  assert.equal(s.move(105, 100), 'start-drag');
  assert.equal(s.move(120, 100), 'drag');
  assert.equal(s.up(), 'drag');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createActionQueue } = require('../src/renderer/action-queue.js');

test('动作队列：先进先出', () => {
  const q = createActionQueue(8);
  assert.equal(q.push('nod', null), 'queued');
  assert.equal(q.push('bounce', null), 'queued');
  assert.deepEqual(q.pending, ['nod', 'bounce']);
  assert.equal(q.shift(), 'nod');
  assert.equal(q.shift(), 'bounce');
  assert.equal(q.shift(), null);
});

test('动作队列：正在播的同类不再入队', () => {
  const q = createActionQueue(8);
  assert.equal(q.push('nod', 'nod'), 'duplicate');
  assert.equal(q.size, 0);
});

test('动作队列：相邻同名去重，隔开的不去重', () => {
  const q = createActionQueue(8);
  assert.equal(q.push('nod', null), 'queued');
  assert.equal(q.push('nod', null), 'duplicate');
  assert.equal(q.push('bounce', null), 'queued');
  assert.equal(q.push('nod', null), 'queued');
  assert.deepEqual(q.pending, ['nod', 'bounce', 'nod']);
});

test('动作队列：上限 8，满了丢最新', () => {
  const q = createActionQueue(8);
  const names = ['nod', 'shake', 'bounce', 'shy', 'laugh', 'stretch', 'wake', 'quiet'];
  for (const n of names) assert.equal(q.push(n, null), 'queued');
  assert.equal(q.size, 8);
  assert.equal(q.push('nod', null), 'full');
  assert.equal(q.size, 8);
  assert.equal(q.pending.at(-1), 'quiet');
});

test('动作队列：clear 清空，cap 可调', () => {
  const q = createActionQueue(2);
  q.push('nod', null);
  q.push('bounce', null);
  assert.equal(q.push('shy', null), 'full');
  q.clear();
  assert.equal(q.size, 0);
  assert.deepEqual(q.pending, []);
  assert.equal(q.shift(), null);
});

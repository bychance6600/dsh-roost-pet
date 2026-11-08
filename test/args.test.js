'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, POSITIONS } = require('../lib/args');

test('什么都不传：协议不强制、size 1、右下、穿透、default 宠物', () => {
  const a = parseArgs([]);
  assert.equal(a.protocol, null);
  assert.equal(a.protocolOk, true);
  assert.equal(a.size, 1);
  assert.equal(a.position, 'bottom-right');
  assert.equal(a.clickThrough, true);
  assert.equal(a.pet, 'default');
});

test('--protocol=1 认；别的版本是协议失败', () => {
  assert.equal(parseArgs(['--protocol=1']).protocolOk, true);
  assert.equal(parseArgs(['--protocol=2']).protocolOk, false);
  assert.equal(parseArgs(['--protocol=abc']).protocolOk, false);
});

test('size 自己再夹一次到 0.5–2.0', () => {
  assert.equal(parseArgs(['--size=0.3']).size, 0.5);
  assert.equal(parseArgs(['--size=9']).size, 2.0);
  assert.equal(parseArgs(['--size=1.25']).size, 1.25);
  // 不是数字就当没传。
  assert.equal(parseArgs(['--size=big']).size, 1);
});

test('position 只认五个值，乱写的回默认', () => {
  for (const p of POSITIONS) assert.equal(parseArgs([`--position=${p}`]).position, p);
  assert.equal(parseArgs(['--position=middle']).position, 'bottom-right');
});

test('click-through=0 / false 才关；缺省是开', () => {
  assert.equal(parseArgs(['--click-through=0']).clickThrough, false);
  assert.equal(parseArgs(['--click-through=false']).clickThrough, false);
  assert.equal(parseArgs(['--click-through=1']).clickThrough, true);
});

test('--pet= 空值回 default', () => {
  assert.equal(parseArgs(['--pet=']).pet, 'default');
  assert.equal(parseArgs(['--pet=']).petExplicit, true);
  assert.equal(parseArgs(['--pet=cat']).pet, 'cat');
});

test('不认识的参数忽略，不抛', () => {
  const a = parseArgs(['--no-sandbox', '--user-data-dir=x', '--whatever=1', 'junk']);
  assert.equal(a.size, 1);
  assert.equal(a.clickThrough, true);
});

test('底噪间隔缺省 3–5 分钟，乱写/太小回默认或夹到 1 秒', () => {
  const a = parseArgs([]);
  assert.equal(a.ambientMin, 180000);
  assert.equal(a.ambientMax, 300000);

  assert.equal(parseArgs(['--ambient-min=2000', '--ambient-max=4000']).ambientMin, 2000);
  assert.equal(parseArgs(['--ambient-min=2000', '--ambient-max=4000']).ambientMax, 4000);

  // 契约外的调试参数：非法值不能把渲染层搞成 0 间隔的抖动。
  assert.equal(parseArgs(['--ambient-min=abc']).ambientMin, 180000);
  assert.equal(parseArgs(['--ambient-min=0']).ambientMin, 180000);
  assert.equal(parseArgs(['--ambient-min=10']).ambientMin, 1000);
  assert.equal(parseArgs(['--ambient-max=-5']).ambientMax, 300000);

  // max 比 min 小时抬到 min，别让随机区间反过来。
  const b = parseArgs(['--ambient-min=5000', '--ambient-max=1000']);
  assert.equal(b.ambientMin, 5000);
  assert.equal(b.ambientMax, 5000);
});

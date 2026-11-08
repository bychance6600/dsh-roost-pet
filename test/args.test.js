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
  assert.equal(parseArgs(['--pet=cat']).pet, 'cat');
});

test('不认识的参数忽略，不抛', () => {
  const a = parseArgs(['--no-sandbox', '--user-data-dir=x', '--whatever=1', 'junk']);
  assert.equal(a.size, 1);
  assert.equal(a.clickThrough, true);
});

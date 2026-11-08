'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { EXIT, exitCodeFor } = require('../lib/exit');

test('正常收尾是 0：bye、关窗、握手后的 stdin EOF', () => {
  assert.equal(exitCodeFor('roost-bye', { handshaken: true }), 0);
  assert.equal(exitCodeFor('window-closed', { handshaken: true }), 0);
  assert.equal(exitCodeFor('stdin-eof', { handshaken: true }), 0);
});

test('握手前 stdin 断了是 2（协议失败），不是 0', () => {
  assert.equal(exitCodeFor('stdin-eof', { handshaken: false }), EXIT.PROTOCOL);
  // 没传状态也按没握手算。
  assert.equal(exitCodeFor('stdin-eof'), EXIT.PROTOCOL);
});

test('hello 还没发出去 stdout 就坏，算协议失败；握手后坏，算崩溃', () => {
  assert.equal(exitCodeFor('stdout-error', { handshaken: false }), EXIT.PROTOCOL);
  assert.equal(exitCodeFor('stdout-error', { handshaken: true }), EXIT.CRASH);
});

test('--protocol 不认是 2', () => {
  assert.equal(exitCodeFor('protocol-error'), EXIT.PROTOCOL);
});

test('第二只身体是 3', () => {
  assert.equal(exitCodeFor('second-instance'), EXIT.SECOND_INSTANCE);
});

test('参数 / 配置错是 4', () => {
  assert.equal(exitCodeFor('config-error'), EXIT.CONFIG);
});

test('运行期崩溃一律 1', () => {
  for (const reason of ['stdin-error', 'renderer-gone', 'signal']) {
    assert.equal(exitCodeFor(reason, { handshaken: true }), EXIT.CRASH, reason);
  }
});

test('不认识的 reason 当崩溃，不静默当 0', () => {
  assert.equal(exitCodeFor('what'), EXIT.CRASH);
});

test('退出码互不重复，且就是 0/1/2/3/4', () => {
  assert.deepEqual(Object.values(EXIT).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

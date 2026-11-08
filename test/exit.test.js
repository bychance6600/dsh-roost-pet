'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { EXIT, exitCodeFor } = require('../lib/exit');

test('正常收尾是 0', () => {
  assert.equal(exitCodeFor('roost-bye', { handshaken: true }), EXIT.OK);
  assert.equal(exitCodeFor('stdin-eof', { handshaken: true }), EXIT.OK);
});

test('握手前 stdin 断了是 3，不是 0', () => {
  assert.equal(exitCodeFor('stdin-eof', { handshaken: false }), EXIT.HANDSHAKE);
  // 没传状态也按没握手算：宁可让 roost 看见 3，也别把半截启动当正常。
  assert.equal(exitCodeFor('stdin-eof'), EXIT.HANDSHAKE);
});

test('第二只身体是 4', () => {
  assert.equal(exitCodeFor('second-instance'), EXIT.SECOND_INSTANCE);
});

test('运行期出错一律 1', () => {
  for (const reason of ['stdin-error', 'stdout-error', 'renderer-gone', 'window-closed', 'signal']) {
    assert.equal(exitCodeFor(reason, { handshaken: true }), EXIT.ERROR, reason);
  }
});

test('不认识的 reason 当出错，不静默当 0', () => {
  assert.equal(exitCodeFor('what'), EXIT.ERROR);
});

test('退出码互不重复', () => {
  const codes = Object.values(EXIT);
  assert.equal(new Set(codes).size, codes.length);
});

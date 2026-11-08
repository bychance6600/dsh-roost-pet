'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { serializePidRecord, parsePidRecord } = require('../lib/pidfile');

test('写出去再读回来，是同一份', () => {
  const rec = { pid: 4321, startedAt: '2026-11-08T13:40:00.000Z', version: 'dsh-roost-pet/0.1.0' };
  const back = parsePidRecord(serializePidRecord(rec));
  assert.deepEqual(back, rec);
});

test('坏文件一律 null，不抛', () => {
  for (const bad of ['', '   ', 'not json', '[]', '{"pid":0}', '{"pid":"1"}', '{"pid":1}']) {
    assert.equal(parsePidRecord(bad), null, JSON.stringify(bad));
  }
});

test('没有 version 也认（旧版本写的）', () => {
  assert.deepEqual(parsePidRecord('{"pid":7,"startedAt":"x"}'), { pid: 7, startedAt: 'x', version: '' });
});

'use strict';

/**
 * .userdata/body.pid：给 roost 判断"单实例锁是另一只活 body 拿着的，
 * 还是上一轮崩溃留下的"。只负责序列化和校验，落盘在 main.js。
 *
 * 格式（一行 JSON + 换行）：
 *   {"pid":12345,"startedAt":"2026-11-08T13:40:00.000Z","version":"dsh-roost-pet/0.1.0"}
 */

function serializePidRecord({ pid, startedAt, version }) {
  return `${JSON.stringify({ pid, startedAt, version })}\n`;
}

function parsePidRecord(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (!Number.isInteger(obj.pid) || obj.pid <= 0) return null;
  if (typeof obj.startedAt !== 'string' || !obj.startedAt) return null;
  if (obj.version !== undefined && typeof obj.version !== 'string') return null;
  return { pid: obj.pid, startedAt: obj.startedAt, version: obj.version ?? '' };
}

module.exports = { serializePidRecord, parsePidRecord };

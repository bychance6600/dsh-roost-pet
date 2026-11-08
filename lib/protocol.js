'use strict';

/**
 * 协议 v1 的唯一实现。
 *
 * 表在 docs/protocol.md，那张表是唯一来源；这里只是把表写成代码。
 * test/protocol.test.js 会把这张表从 markdown 里读出来逐字段对账，
 * 所以两边只要有一边先动手，另一边就会红。
 *
 * 纯函数，不碰 electron、不碰 process。
 */

const VERSION = 1;

/** 单行上限。超过就丢这一行并 warn，不当成半截消息处理。 */
const LINE_LIMIT = 16 * 1024;
/** 半行攒到这么大还没见到 \n，就当这条线是坏的，丢掉直到下一个换行。 */
const MAX_BUFFER = 1024 * 1024;

const STATES = Object.freeze(['thinking', 'acting', 'waiting', 'error', 'done']);
const ACTIONS = Object.freeze([
  'nod', 'shake', 'bounce', 'shy', 'laugh',
  'stretch', 'sleep', 'wake', 'quiet', 'loud',
]);
const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

/** roost → body。seq 只对 say 有意义。 */
const R2B = Object.freeze({
  hello: { required: ['v', 'roost'], types: { v: 'number', roost: 'string' } },
  say: {
    required: ['id', 'seq', 'text', 'final'],
    types: { id: 'string', seq: 'number', text: 'string', final: 'boolean' },
  },
  state: {
    required: ['state', 'why'],
    types: { state: 'string', why: 'string' },
    enums: { state: STATES },
  },
  act: {
    // 动作名由角色包定义（2026-11-08 18:17 板子）：这里只查形状，不查白名单。
    required: ['action', 'why'],
    types: { action: 'string', why: 'string' },
  },
  bye: { required: [], types: {} },
});

/** body → roost。 */
const B2R = Object.freeze({
  hello: {
    required: ['v', 'body', 'pet'],
    types: { v: 'number', body: 'string', pet: 'string' },
  },
  input: { required: ['id', 'text'], types: { id: 'string', text: 'string' } },
  // 点击只报一声，反应由 roost 定（2026-11-08 17:47 板子）：ts 必填，x/y 可选留着给以后。
  poke: { required: ['ts'], types: { ts: 'string', x: 'number', y: 'number' } },
  ack: { required: ['id'], types: { id: 'string' } },
  log: {
    required: ['level', 'msg'],
    types: { level: 'string', msg: 'string' },
    enums: { level: LEVELS },
  },
  bye: { required: [], types: {} },
});

const TABLES = Object.freeze({ r2b: R2B, b2r: B2R });

/** 字段实际类型（null 和数组不算 object，免得 typeof 蒙混过关）。 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 校验一条入站消息。
 * @returns {{ok: true, msg: object} | {ok: false, reason: string}}
 */
function validate(msg, dir) {
  const table = TABLES[dir];
  if (!table) return { ok: false, reason: `未知方向 ${dir}` };
  if (typeOf(msg) !== 'object') return { ok: false, reason: '不是对象' };

  const t = msg.t;
  if (typeof t !== 'string') return { ok: false, reason: '缺 t' };
  const spec = table[t];
  if (!spec) return { ok: false, reason: `未知 t：${t}` };

  for (const field of Object.keys(spec.types)) {
    const want = spec.types[field];
    if (!(field in msg)) {
      if (spec.required.includes(field)) {
        return { ok: false, reason: `${t} 缺必填字段 ${field}` };
      }
      continue;
    }
    const got = typeOf(msg[field]);
    if (got !== want) {
      return { ok: false, reason: `${t}.${field} 应为 ${want}，实为 ${got}` };
    }
  }

  for (const field of Object.keys(spec.enums || {})) {
    const allowed = spec.enums[field];
    if (!allowed.includes(msg[field])) {
      return { ok: false, reason: `${t}.${field} 不在枚举里：${msg[field]}` };
    }
  }

  if (t === 'act') {
    const action = msg.action.trim();
    if (!action) return { ok: false, reason: 'act.action 不能为空' };
    if (msg.action.length > 40) {
      return { ok: false, reason: `act.action 太长（${msg.action.length} > 40）` };
    }
  }

  if (t === 'say' && (!Number.isInteger(msg.seq) || msg.seq < 0)) {
    // 表里写的是 int≥0，这里给个准数：小数、负数、NaN 都不收。
    return { ok: false, reason: `say.seq 应为 >= 0 的整数，实为 ${msg.seq}` };
  }

  return { ok: true, msg };
}

/** 编码成一行（带 \n）。超长直接抛，不悄悄截断。 */
function encode(msg) {
  const line = JSON.stringify(msg);
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > LINE_LIMIT) {
    throw new RangeError(`一条消息 ${bytes} 字节，超过 ${LINE_LIMIT} 上限`);
  }
  return line + '\n';
}

/** 只做 JSON 解析，不校验语义。 */
function parseLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return { ok: false, reason: `坏 JSON：${err.message}` };
  }
  if (typeOf(msg) !== 'object') return { ok: false, reason: '不是 JSON 对象' };
  return { ok: true, msg };
}

/** 把字节流按 \n 切成整行。跨 chunk 的半行先攒着。 */
class LineDecoder {
  constructor({ limit = LINE_LIMIT, maxBuffer = MAX_BUFFER } = {}) {
    this.limit = limit;
    this.maxBuffer = maxBuffer;
    this.pending = '';
    this.dropping = false;
  }

  /**
   * @param {string|Buffer} chunk
   * @returns {{lines: string[], problems: Array<{kind: string, bytes?: number}>}}
   */
  push(chunk) {
    const lines = [];
    const problems = [];
    if (chunk === null || chunk === undefined) return { lines, problems };

    this.pending += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

    let at;
    while ((at = this.pending.indexOf('\n')) !== -1) {
      let line = this.pending.slice(0, at);
      this.pending = this.pending.slice(at + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (this.dropping) {
        // 上一条超长行的尾巴，连这个换行一起丢
        this.dropping = false;
        continue;
      }
      if (line.length === 0) continue;

      const bytes = Buffer.byteLength(line, 'utf8');
      if (bytes > this.limit) {
        problems.push({ kind: 'too-long', bytes });
        continue;
      }
      lines.push(line);
    }

    if (Buffer.byteLength(this.pending, 'utf8') > this.maxBuffer) {
      this.dropping = true;
      this.pending = '';
      problems.push({ kind: 'overflow' });
    }

    return { lines, problems };
  }

  /** stdin 关掉时，最后那截没有换行的内容。 */
  flush() {
    const rest = this.pending;
    this.pending = '';
    if (!rest) return { lines: [], problems: [] };
    if (Buffer.byteLength(rest, 'utf8') > this.limit) {
      return { lines: [], problems: [{ kind: 'too-long', bytes: Buffer.byteLength(rest, 'utf8') }] };
    }
    return { lines: [rest], problems: [] };
  }
}

module.exports = {
  VERSION,
  LINE_LIMIT,
  MAX_BUFFER,
  STATES,
  ACTIONS,
  LEVELS,
  R2B,
  B2R,
  validate,
  encode,
  parseLine,
  LineDecoder,
};

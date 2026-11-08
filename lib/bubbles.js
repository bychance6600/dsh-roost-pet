'use strict';

/**
 * 气泡排程（docs/protocol.md §5）。
 *
 * 纯逻辑：不碰 electron、不碰 DOM、不自己读时钟。
 * 时间、定时器、显示回调都从外面注入，测试里换成假时钟就能一秒跑完十分钟。
 */

const MIN_HOLD_MS = 2500;
const MAX_HOLD_MS = 10000;
const CHARS_PER_SEC = 12;
const MIN_SWAP_MS = 1200;
const CAPACITY = 20;
const SEEN_LIMIT = 256;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** §5.4：clamp(字数 / 12, 2.5s, 10s)，取整到毫秒。 */
function holdMsFor(text) {
  const chars = typeof text === 'string' ? text.length : 0;
  return Math.round(clamp((chars / CHARS_PER_SEC) * 1000, MIN_HOLD_MS, MAX_HOLD_MS));
}

class BubbleQueue {
  /**
   * @param {object} opts
   * @param {(item: {id: string, seq: number, text: string, holdMs: number}) => void} [opts.onShow]
   * @param {() => void} [opts.onIdle]  队列空了、最后一个气泡也收走了
   * @param {(msg: string) => void} [opts.log]
   * @param {() => number} [opts.now]
   * @param {(fn: Function, ms: number) => any} [opts.setTimer]
   * @param {(handle: any) => void} [opts.clearTimer]
   * @param {number} [opts.capacity]
   */
  constructor({
    onShow = () => {},
    onIdle = () => {},
    log = () => {},
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h),
    capacity = CAPACITY,
  } = {}) {
    this.onShow = onShow;
    this.onIdle = onIdle;
    this.log = log;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.capacity = capacity;

    this.items = [];
    /** 去重键 id+seq → 到达时间。Map 的插入顺序就是淘汰顺序。 */
    this.seen = new Map();
    this.current = null;
    this.shownAt = 0;
    this.timer = null;
    this.droppedOverflow = 0;
  }

  get pending() {
    return this.items.length;
  }

  /**
   * 收一条已经校验过的 say。
   * @returns {'queued'|'duplicate'|'overflow'}
   */
  push({ id, seq, text }) {
    const key = `${id}#${seq}`;
    if (this.seen.has(key)) return 'duplicate';

    this.seen.set(key, this.now());
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.keys().next().value;
      this.seen.delete(oldest);
    }

    if (this.items.length >= this.capacity) {
      this.droppedOverflow += 1;
      // §5.6：丢最新到达的这条，并且只报一次，别刷屏。
      if (this.droppedOverflow === 1) {
        this.log(`气泡队列满了（${this.capacity} 条），丢最新到达的 say ${id}#${seq}`);
      }
      return 'overflow';
    }

    this.insert({ id, seq, text });
    if (!this.current) this.showNext();
    return 'queued';
  }

  /** §5.3：跨 id 按到达先后；同 id 按 seq 升序插进正确位置。 */
  insert(item) {
    let at = -1;
    for (let i = 0; i < this.items.length; i += 1) {
      const other = this.items[i];
      if (other.id === item.id && other.seq > item.seq) {
        at = i;
        break;
      }
    }
    if (at === -1) {
      // 排在同 id 已有的最后一条之后；没有同 id 就排到队尾
      let last = -1;
      for (let i = 0; i < this.items.length; i += 1) {
        if (this.items[i].id === item.id) last = i;
      }
      at = last === -1 ? this.items.length : last + 1;
    }
    this.items.splice(at, 0, item);
  }

  showNext() {
    const next = this.items.shift();
    if (!next) {
      this.current = null;
      this.onIdle();
      return;
    }

    const hold = holdMsFor(next.text);
    this.current = next;
    this.shownAt = this.now();
    this.onShow({ ...next, holdMs: hold });

    // §5.5 的 1.2 秒下限：hold 本身不会低于 2.5s，这条是给以后设置项改短留的底。
    const delay = Math.max(hold, MIN_SWAP_MS);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.current = null;
      this.showNext();
    }, delay);
  }

  dispose() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.items = [];
    this.current = null;
  }
}

module.exports = {
  BubbleQueue,
  holdMsFor,
  MIN_HOLD_MS,
  MAX_HOLD_MS,
  CHARS_PER_SEC,
  MIN_SWAP_MS,
  CAPACITY,
};

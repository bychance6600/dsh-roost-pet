/*
 * 动作队列（16:53）。纯逻辑，不碰 DOM，方便单测。
 *
 * 规矩：
 * - 正在播动作时新动作排队，不打断当前；
 * - 相邻同名去重（连发两次 nod 只播一次，包括「正在播的」和「队尾的」）；
 * - 队列上限 8，满了丢最新；
 * - wake / sleep 不走这个队列，由调用方先清空再优先处理。
 */
function createActionQueue(capacity = 8) {
  const items = [];

  return {
    /**
     * @param {string} action 动作名
     * @param {string|null} current 正在播的动作（没有就传 null）
     * @returns {'queued'|'duplicate'|'full'}
     */
    push(action, current = null) {
      if (items.length === 0 && current === action) return 'duplicate';
      if (items.length > 0 && items[items.length - 1] === action) return 'duplicate';
      if (items.length >= capacity) return 'full';
      items.push(action);
      return 'queued';
    },

    /** 取下一个；空队列给 null。 */
    shift() {
      return items.length ? items.shift() : null;
    },

    clear() {
      items.length = 0;
    },

    get size() {
      return items.length;
    },

    /** 只看不用（测试与日志）。 */
    get pending() {
      return items.slice();
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createActionQueue };
}
if (typeof window !== 'undefined') {
  window.createActionQueue = createActionQueue;
}

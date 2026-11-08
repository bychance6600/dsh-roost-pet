'use strict';

/**
 * 启动参数。约定见 docs/launch.md（唯一来源是施工单 §4.2）。
 * 纯函数，不读 process.argv，方便测试。
 */

const POSITIONS = Object.freeze(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center']);
const SIZE_MIN = 0.5;
const SIZE_MAX = 2.0;

function parseArgs(argv) {
  const out = {
    protocol: null, // 没传就是 null：旧调用方还没带 --protocol，按 1 处理
    protocolOk: true,
    size: 1,
    position: 'bottom-right',
    clickThrough: true,
    pet: 'default',
  };

  for (const arg of argv) {
    const m = /^--([a-z][a-z-]*)=(.*)$/.exec(arg);
    if (!m) continue; // 不是 --key=value 的，直接忽略（§4.2：不许因此退出）
    const [, key, value] = m;
    switch (key) {
      case 'protocol': {
        const n = Number.parseInt(value, 10);
        out.protocol = Number.isFinite(n) ? n : null;
        out.protocolOk = out.protocol === 1;
        break;
      }
      case 'size': {
        const n = Number.parseFloat(value);
        // §4.2：roost 会先夹一次，body 仍然自己再夹一次，别信外部输入。
        if (Number.isFinite(n)) out.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
        break;
      }
      case 'position':
        // 乱写的值当没传，回默认位；不报错。
        if (POSITIONS.includes(value)) out.position = value;
        break;
      case 'click-through':
        out.clickThrough = value !== '0' && value !== 'false';
        break;
      case 'pet':
        out.pet = value || 'default';
        break;
      default:
        break; // 不认识的参数忽略
    }
  }

  return out;
}

module.exports = { parseArgs, POSITIONS, SIZE_MIN, SIZE_MAX };

'use strict';

/**
 * 退出码。唯一来源是施工单 §4.4，本文档只做映射。
 *
 *   0 正常（bye / 窗口关闭 / 握手后的 stdin EOF）
 *   1 未分类崩溃
 *   2 握手 / 协议失败（--protocol 不认、握手前就 EOF、hello 发不出去）
 *   3 已经有一只（单实例锁没抢到）
 *   4 参数 / 配置错
 *
 * 只做映射，不碰 process（main.js 拿去用，测试直接调）。
 */

const EXIT = Object.freeze({
  OK: 0,
  CRASH: 1,
  PROTOCOL: 2,
  SECOND_INSTANCE: 3,
  CONFIG: 4,
});

function exitCodeFor(reason, { handshaken = false } = {}) {
  switch (reason) {
    case 'roost-bye':
    case 'window-closed':
      return EXIT.OK;
    case 'stdin-eof':
      // 握手前就 EOF：roost 没走完握手，按协议失败处理，不假装正常收尾。
      return handshaken ? EXIT.OK : EXIT.PROTOCOL;
    case 'stdout-error':
      // hello 还没发出去 stdout 就坏了，属于 §4.4 的"hello 发不出去"。
      return handshaken ? EXIT.CRASH : EXIT.PROTOCOL;
    case 'protocol-error':
      return EXIT.PROTOCOL;
    case 'second-instance':
      return EXIT.SECOND_INSTANCE;
    case 'config-error':
      return EXIT.CONFIG;
    case 'stdin-error':
    case 'renderer-gone':
    case 'signal':
    default:
      return EXIT.CRASH;
  }
}

module.exports = { EXIT, exitCodeFor };

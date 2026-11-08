'use strict';

/**
 * 退出码。给 roost 看的：它只能从退出码和 stderr 判断这只身体是怎么没的。
 *
 * 约定见 docs/launch.md，改这里之前先改那份文档。
 * 只做映射，不碰 process（main.js 拿去用，测试直接调）。
 */

const EXIT = Object.freeze({
  OK: 0, // 正常：收到 bye，或握手后 stdin 关闭
  ERROR: 1, // 运行期出错：stdout 写不了、stdin 读不了、渲染进程没了、窗口被关
  HANDSHAKE: 3, // 还没握手 stdin 就断了（roost 那边没把 hello 发出来）
  SECOND_INSTANCE: 4, // 已经有一只在同一份 userData 上跑着
});

function exitCodeFor(reason, { handshaken = false } = {}) {
  switch (reason) {
    case 'roost-bye':
      return EXIT.OK;
    case 'stdin-eof':
      // 握手前就 EOF：说明 roost 没走完握手，这不是一次正常收尾。
      return handshaken ? EXIT.OK : EXIT.HANDSHAKE;
    case 'second-instance':
      return EXIT.SECOND_INSTANCE;
    case 'stdin-error':
    case 'stdout-error':
    case 'renderer-gone':
    case 'window-closed':
    case 'signal':
      return EXIT.ERROR;
    default:
      return EXIT.ERROR;
  }
}

module.exports = { EXIT, exitCodeFor };

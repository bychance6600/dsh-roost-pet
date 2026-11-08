'use strict';

/**
 * 沙箱里的 preload。只开这几扇小门，渲染层拿不到 node、也拿不到 ipcRenderer 本身。
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
  return (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('pet', {
  /** 渲染层准备好了：要尺寸参数、要积压的气泡。 */
  ready: () => ipcRenderer.send('pet:ready'),
  /** 指针在不在身体上。true = 关穿透。 */
  hit: (inside) => ipcRenderer.send('pet:hit', Boolean(inside)),
  /** 身体在窗口里的矩形（CSS 像素）；主进程拿它做鼠标命中轮询。 */
  hitBox: (box) => ipcRenderer.send('pet:hitbox', box),
  /** 气泡需要多高（含身体），主进程据此往上长窗口。 */
  bubbleHeight: (height) => ipcRenderer.send('pet:bubble-height', Number(height)),
  /** 渲染层自己的麻烦（包里的文件放不出来等），交给主进程报给 roost。 */
  issue: (payload) => ipcRenderer.send('pet:issue', payload),
  /** 拖拽：给指针的屏幕坐标，主进程据此挪窗口。 */
  dragStart: (point) => ipcRenderer.send('pet:drag-start', point),
  dragMove: (point) => ipcRenderer.send('pet:drag-move', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  /** 单击身体：窗口内 CSS 像素坐标。 */
  poke: (point) => ipcRenderer.send('pet:poke', point),
  /** 运行时换包：传包目录，回 { ok, pack } 或 { ok:false, error }。 */
  swapPack: (dir) => ipcRenderer.invoke('pet:swap-pack', { dir }),

  onInit: subscribe('pet:init'),
  onBubble: subscribe('pet:bubble'),
  onBubbleHide: subscribe('pet:bubble-hide'),
  onState: subscribe('pet:state'),
  onAct: subscribe('pet:act'),
  /** 抛掷落地：渲染层据此压一下（§7 落地挤压）。 */
  onLanding: subscribe('pet:landing'),
  /** 指针在不在身体上：只读状态条靠它开关。 */
  onHover: subscribe('pet:hover'),
});

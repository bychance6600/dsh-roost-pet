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
  /** 气泡需要多高（含身体），主进程据此往上长窗口。 */
  bubbleHeight: (height) => ipcRenderer.send('pet:bubble-height', Number(height)),

  onInit: subscribe('pet:init'),
  onBubble: subscribe('pet:bubble'),
  onBubbleHide: subscribe('pet:bubble-hide'),
  onState: subscribe('pet:state'),
  onAct: subscribe('pet:act'),
});

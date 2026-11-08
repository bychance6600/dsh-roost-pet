/*
 * 手势判定：按下不算拖，指针挪过 4px 才算拖；没挪过就松开按点击。
 * 纯函数，Node 里 require 得到同一份逻辑，渲染层用 <script> 引入（2026-11-08 22:52）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetGesture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DRAG_THRESHOLD = 4; // CSS 像素

  function distance(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 一次按下 → 移动 → 松开的判定。
   * move() 返回 'moving'（还没到阈值）/ 'start-drag'（刚越过阈值）/ 'drag'（已在拖）/ 'ignored'。
   * up() 返回 'click'（没拖过）/ 'drag' / 'none'（没按下过）。
   */
  function createPointerSession(threshold = DRAG_THRESHOLD) {
    let press = null;
    let dragging = false;
    return {
      get pressed() {
        return press !== null;
      },
      get dragging() {
        return dragging;
      },
      down(x, y) {
        press = { x, y };
        dragging = false;
        return 'pressed';
      },
      move(x, y) {
        if (!press) return 'ignored';
        if (!dragging) {
          if (distance(press.x, press.y, x, y) > threshold) {
            dragging = true;
            return 'start-drag';
          }
          return 'moving';
        }
        return 'drag';
      },
      up() {
        const result = dragging ? 'drag' : press ? 'click' : 'none';
        press = null;
        dragging = false;
        return result;
      },
      cancel() {
        press = null;
        dragging = false;
      },
    };
  }

  return { DRAG_THRESHOLD, distance, createPointerSession };
});

'use strict';

/**
 * 拖拽与抛掷的纯函数（不碰窗口、不碰 Electron）。
 *
 * 数值取自施工单 §7：重力 2000px/s²、反弹 0.35、落地挤压 0.08s。
 * 跟手弹簧与初速估算的形态照 dsh-pet 的实现搬（MIT，PC2005-cloud 2026），
 * 只保留我们窗口这块大小的最小一套。
 */

const SPRING_K = 200;
const SPRING_C = 30;
const MAX_STEP_DT = 1 / 30;
const MAX_THROW_SPEED = 3600;
const TRAIL_KEEP_MS = 200;
const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 500;
const PEAK_WEIGHT = 0.5;
const ACCEL_REF = 8000;
const ACCEL_GAIN_MAX = 0.6;

const GRAVITY = 2000;
const RESTITUTION = 0.35;
const FLOOR_FRICTION = 6; // 落地后横向速度每秒衰减倍率

function softClampSpeed(speed) {
  if (!(speed > 0)) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
}

/** 过阻尼弹簧单轴速度步进；调用方随后 x += v*dt。 */
function springStep(v, x, target, dt, power = 1) {
  const step = Math.min(Math.max(dt, 0), MAX_STEP_DT);
  return v + ((target - x) * SPRING_K - v * SPRING_C) * power * step;
}

/** 只留最近 ms 的采样（trail 按时间追加，从头上裁）。 */
function trimTrail(trail, now, keepMs = TRAIL_KEEP_MS) {
  const cutoff = now - keepMs;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i += 1;
  return i === 0 ? trail : trail.slice(i);
}

/**
 * 由拖拽轨迹估松手初速（px/s）。null = 温柔放下。
 * 方向取窗口首末端点位移，大小 = 端点均值与峰值加权，末段仍在加速再放大一点。
 */
function estimateReleaseVelocity(trail, now) {
  if (!trail || trail.length === 0) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t;
  const t1 = win[win.length - 1].t;
  const span = t1 - t0;
  if (span < MIN_SPAN_MS) return null;
  const dx = win[win.length - 1].x - win[0].x;
  const dy = win[win.length - 1].y - win[0].y;
  const baseVx = (dx / span) * 1000;
  const baseVy = (dy / span) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null;

  const segs = [];
  let px = win[0].x;
  let py = win[0].y;
  let pt = t0;
  for (let i = 1; i < win.length; i += 1) {
    const s = win[i];
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segs.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, t: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peak = segs.length ? Math.max(...segs.map((s) => s.speed)) : Math.hypot(baseVx, baseVy);
  let accel = 0;
  if (segs.length >= 2) {
    const first = segs[0];
    const lastSeg = segs[segs.length - 1];
    const dt = Math.max((lastSeg.t - first.t) / 1000, MIN_SPAN_MS / 1000);
    accel = (lastSeg.speed - first.speed) / dt;
  }
  const raw = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peak) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(raw);
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
}

/** 一帧该积几步：位移超过 8px 就拆，免得一帧跨过落地。 */
function throwSubsteps(vx, vy, dt) {
  const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
  if (!(travel > 8)) return 1;
  return Math.min(8, Math.ceil(travel / 8));
}

/**
 * 抛掷单步：重力 + 边界反弹 + 地面摩擦。
 * bounds 是窗口左上角的允许范围（工作区减去窗口尺寸）。
 * 返回 {x,y,vx,vy,bounced,landed,atRest}。
 */
function throwStep(state, dtRaw, bounds) {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  let { x, y, vx, vy } = state;
  const prevY = y;
  vy += GRAVITY * dt;
  x += vx * dt;
  y += vy * dt;
  let bounced = false;
  let landed = false;
  let impact = 0;

  if (x < bounds.minX) {
    x = bounds.minX;
    vx = Math.abs(vx) * RESTITUTION;
    bounced = true;
  } else if (x > bounds.maxX) {
    x = bounds.maxX;
    vx = -Math.abs(vx) * RESTITUTION;
    bounced = true;
  }
  if (y < bounds.minY) {
    y = bounds.minY;
    vy = Math.abs(vy) * RESTITUTION;
    bounced = true;
  } else if (y > bounds.maxY) {
    y = bounds.maxY;
    impact = Math.abs(vy);
    const impactSpeed = impact;
    vy = -impactSpeed * RESTITUTION;
    // 落地摩擦：只在贴地那一步吃掉横向速度
    vx *= Math.max(0, 1 - FLOOR_FRICTION * dt);
    if (impact > 60) landed = true;
    bounced = true;
    if (Math.abs(vy) < 40) vy = 0;
  }
  const onFloor = y >= bounds.maxY - 0.5;
  const atRest = onFloor && Math.abs(vy) < 1 && Math.abs(vx) < 12;
  if (atRest) {
    y = bounds.maxY;
    vx = 0;
    vy = 0;
  }
  return { x, y, vx, vy, bounced, landed, atRest, impact, prevY };
}

/** 挤压深度（0–1）：冲击速度越大压得越扁，落地挤压时长 0.08s 由渲染层管。 */
function squashDepth(impactSpeed) {
  const k = Math.min(Math.max(impactSpeed, 0) / 1200, 1);
  return 0.08 + 0.18 * k;
}

module.exports = {
  SPRING_K,
  SPRING_C,
  MAX_STEP_DT,
  GRAVITY,
  RESTITUTION,
  MAX_THROW_SPEED,
  DEAD_ZONE_SPEED,
  softClampSpeed,
  springStep,
  trimTrail,
  estimateReleaseVelocity,
  throwSubsteps,
  throwStep,
  squashDepth,
};

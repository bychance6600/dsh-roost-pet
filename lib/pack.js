'use strict';

/**
 * 宠物包：读 pet.json、校验、缺组回退。纯 Node（不碰 Electron），好测。
 * 规格见施工单 §9：
 *   <pack>/pet.json  +  <pack>/<动画文件>.webm
 * 校验：文件存在、数组非空、路径不越出包目录；坏包给明确报错，不静默。
 */

const fs = require('node:fs');
const path = require('node:path');

const ARRAY_GROUPS = ['breathing', 'look', 'doze', 'stretch', 'drag', 'click'];
const DIRECTIONAL_GROUPS = ['turn', 'sleep', 'states'];
/** 协议里的控制名，不是包内动作：走渲染层特例处理，任何包都该能用。 */
const CONTROL_ACTIONS = Object.freeze(['sleep', 'wake', 'quiet', 'loud']);

const STATE_KEYS = ['thinking', 'acting', 'done', 'error', 'waiting'];
function insideDir(dir, abs) {
  const rel = path.relative(dir, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readFileList(dir, value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label}：必须是至少一个文件的数组`);
    return null;
  }
  const out = [];
  for (const rel of value) {
    const ok = readClipFile(dir, rel, label, errors);
    if (!ok) return null;
    out.push(ok);
  }
  return out;
}

/** 校验单个文件名（不许绝对路径、不许越出包目录、必须存在）。 */
function readClipFile(dir, rel, label, errors) {
  if (typeof rel !== 'string' || !rel) {
    errors.push(`${label}：文件名必须是非空字符串`);
    return null;
  }
  if (path.isAbsolute(rel)) {
    errors.push(`${label}：不许用绝对路径 ${rel}`);
    return null;
  }
  const abs = path.resolve(dir, rel);
  if (!insideDir(dir, abs)) {
    errors.push(`${label}：路径越出包目录 ${rel}`);
    return null;
  }
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    errors.push(`${label}：文件不存在 ${rel}`);
    return null;
  }
  if (!st.isFile()) {
    errors.push(`${label}：不是文件 ${rel}`);
    return null;
  }
  return rel;
}

/**
 * 动作片段可以有窗口：整段（字符串）或只播一段 {file, from, to}。
 * 返回数组，元素是字符串（整段）或 {file, from?, to?}（窗口）。
 */
function readActionEntry(dir, value, label, errors) {
  if (typeof value === 'string') {
    const rel = readClipFile(dir, value, label, errors);
    return rel ? [rel] : null;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      errors.push(`${label}：至少一个片段`);
      return null;
    }
    const out = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const rel = readClipFile(dir, item, label, errors);
        if (!rel) return null;
        out.push(rel);
      } else {
        const clip = readWindowClip(dir, item, label, errors);
        if (!clip) return null;
        out.push(clip);
      }
    }
    return out;
  }
  const clip = readWindowClip(dir, value, label, errors);
  return clip ? [clip] : null;
}

function readWindowClip(dir, item, label, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${label}：只能是文件名、文件名数组或 {file,from,to}`);
    return null;
  }
  if (item.url !== undefined || item.path !== undefined) {
    errors.push(`${label}：窗口片段只认 file 字段（不是 url/path）`);
    return null;
  }
  const rel = readClipFile(dir, item.file, label, errors);
  if (!rel) return null;

  const clip = { file: rel };
  if (item.from !== undefined) {
    if (typeof item.from !== 'number' || !Number.isFinite(item.from) || item.from < 0) {
      errors.push(`${label}：from 必须是 >= 0 的秒数`);
      return null;
    }
    clip.from = item.from;
  }
  if (item.to !== undefined) {
    if (typeof item.to !== 'number' || !Number.isFinite(item.to) || item.to <= 0) {
      errors.push(`${label}：to 必须是 > 0 的秒数`);
      return null;
    }
    clip.to = item.to;
  }
  if (clip.from !== undefined && clip.to !== undefined && clip.to <= clip.from) {
    errors.push(`${label}：to（${clip.to}）必须大于 from（${clip.from}）`);
    return null;
  }
  return clip;
}

function readSubGroup(dir, value, label, keys, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}：必须是对象（${keys.join(' / ')}）`);
    return null;
  }
  const out = {};
  let any = false;
  for (const key of keys) {
    if (value[key] === undefined) continue;
    const list = readFileList(dir, value[key], `${label}.${key}`, errors);
    if (!list) return null;
    out[key] = list;
    any = true;
  }
  if (!any) errors.push(`${label}：${keys.join(' / ')} 至少给一组`);
  return any ? out : null;
}

/**
 * 校验并规范化一个包目录。
 * @returns {{ok: boolean, dir: string, pack: object|null, errors: string[], warnings: string[]}}
 */
function inspectPack(dir) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => {
    errors.push(msg);
    return { ok: false, dir, pack: null, errors, warnings };
  };

  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return fail(`宠物包目录不存在：${dir}`);
  }
  if (!st.isDirectory()) return fail(`不是目录：${dir}`);

  let json;
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
  } catch (err) {
    return fail(`pet.json 读不了或不是 JSON：${err.message}`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return fail('pet.json 必须是一个对象');

  if (typeof json.id !== 'string' || !json.id.trim()) errors.push('pet.json：id 必须是非空字符串');
  if (json.name !== undefined && typeof json.name !== 'string') errors.push('pet.json：name 必须是字符串');

  let size = 1;
  if (json.size !== undefined) {
    if (typeof json.size !== 'number' || !Number.isFinite(json.size) || json.size <= 0) {
      errors.push('pet.json：size 必须是正数');
    } else {
      size = Math.min(2, Math.max(0.5, json.size));
      if (size !== json.size) warnings.push(`size ${json.size} 超出 0.5–2.0，按 ${size} 画`);
    }
  }

  if (!json.animations || typeof json.animations !== 'object' || Array.isArray(json.animations)) {
    return fail('pet.json：animations 必须是对象');
  }

  const animations = {};
  for (const [key, value] of Object.entries(json.animations)) {
    if (ARRAY_GROUPS.includes(key)) {
      const list = readFileList(dir, value, `animations.${key}`, errors);
      if (list) animations[key] = list;
    } else if (key === 'turn') {
      const sub = readSubGroup(dir, value, 'animations.turn', ['left', 'right'], errors);
      if (sub) animations.turn = sub;
    } else if (key === 'sleep') {
      const sub = readSubGroup(dir, value, 'animations.sleep', ['start', 'loop', 'end'], errors);
      if (sub) animations.sleep = sub;
    } else if (key === 'states') {
      // 五档可以各配画面；不配就按 look → turn.left → breathing 回退。
      const sub = readSubGroup(dir, value, 'animations.states', STATE_KEYS, errors);
      if (sub) animations.states = sub;
    } else if (key === 'actions') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push('animations.actions：必须是对象（动作名 → 文件数组）');
        continue;
      }
      const actions = {};
      // 动作由角色包定义（2026-11-08 17:50 板子）：什么都收，不按协议白名单拦。
      for (const [action, files] of Object.entries(value)) {
        // 动作可以是整段（字符串/数组），也可以带窗口 {file,from,to}。
        const list = readActionEntry(dir, files, `animations.actions.${action}`, errors);
        if (list) actions[action] = list;
      }
      animations.actions = actions;
    } else {
      warnings.push(`animations.${key}：不认识的组，忽略`);
    }
  }

  if (Object.keys(animations).length === 0) errors.push('animations 里没有任何一组能用的');

  if (errors.length) return { ok: false, dir, pack: null, errors, warnings };

  return {
    ok: true,
    dir,
    errors,
    warnings,
    pack: {
      id: json.id.trim(),
      name: typeof json.name === 'string' && json.name.trim() ? json.name.trim() : json.id.trim(),
      size,
      dir,
      animations,
    },
  };
}

function getByKey(obj, key) {
  return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

/**
 * 取一组动画。缺组的回退顺序（§9）：actions.x → click → turn.left → breathing。
 * 其余组没有定义回退，缺了就是 null（静止画占位）。
 */
function pickAnimation(pack, key) {
  if (!pack || !pack.animations) return null;
  let chain = [key];
  if (key.startsWith('actions.')) chain = [key, 'click', 'turn.left', 'breathing'];
  // §9 回退：没配 thinking/acting 就用张望/转身顶上，再没有就呼吸，别静默不动。
  else if (key.startsWith('states.')) chain = [key, 'look', 'turn.left', 'breathing'];
  for (const k of chain) {
    const list = getByKey(pack.animations, k);
    if (Array.isArray(list) && list.length > 0) return list;
  }
  return null;
}

module.exports = {
  inspectPack,
  pickAnimation,
  CONTROL_ACTIONS,
  ARRAY_GROUPS,
  DIRECTIONAL_GROUPS,
  STATE_KEYS,
};

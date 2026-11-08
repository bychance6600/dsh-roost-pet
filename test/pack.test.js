'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectPack, pickAnimation } = require('../lib/pack');

function makePack(files, petJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petpack-'));
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  if (petJson !== undefined) {
    fs.writeFileSync(path.join(dir, 'pet.json'), typeof petJson === 'string' ? petJson : JSON.stringify(petJson));
  }
  return dir;
}

const goodJson = {
  id: 'demo',
  name: '演示',
  size: 1,
  animations: {
    breathing: ['a.webm'],
    click: ['b.webm'],
    turn: { left: ['c.webm'] },
    actions: { nod: ['d.webm'] },
  },
};

test('好包：读出来、id/name/size 规范化', () => {
  const dir = makePack(['a.webm', 'b.webm', 'c.webm', 'd.webm'], goodJson);
  const res = inspectPack(dir);
  assert.equal(res.ok, true, res.errors.join(';'));
  assert.equal(res.pack.id, 'demo');
  assert.equal(res.pack.name, '演示');
  assert.equal(res.pack.size, 1);
  assert.deepEqual(res.pack.animations.actions.nod, ['d.webm']);
});

test('缺 pet.json / 坏 JSON / 不是对象，都要报错', () => {
  assert.equal(inspectPack(makePack([], undefined)).ok, false);
  const bad = inspectPack(makePack([], '{oops'));
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /pet\.json/);
  assert.equal(inspectPack(makePack([], '[]')).ok, false);
});

test('文件不存在、不是数组、空数组、路径越界，都拒绝', () => {
  const missing = inspectPack(makePack([], { id: 'x', animations: { breathing: ['a.webm'] } }));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(';'), /文件不存在/);

  const empty = inspectPack(makePack([], { id: 'x', animations: { breathing: [] } }));
  assert.equal(empty.ok, false);

  const escape = inspectPack(
    makePack(['../outside.webm'], { id: 'x', animations: { breathing: ['../outside.webm'] } }),
  );
  assert.equal(escape.ok, false);
  assert.match(escape.errors.join(';'), /越出包目录/);

  const abs = inspectPack(
    makePack(['a.webm'], { id: 'x', animations: { breathing: [path.resolve(os.tmpdir(), 'a.webm')] } }),
  );
  assert.equal(abs.ok, false);
  assert.match(abs.errors.join(';'), /绝对路径/);
});

test('turn / sleep 必须是对象，至少给一组', () => {
  const turnBad = inspectPack(
    makePack(['a.webm'], { id: 'x', animations: { breathing: ['a.webm'], turn: ['a.webm'] } }),
  );
  assert.equal(turnBad.ok, false);

  const sleepEmpty = inspectPack(
    makePack(['a.webm'], { id: 'x', animations: { breathing: ['a.webm'], sleep: {} } }),
  );
  assert.equal(sleepEmpty.ok, false);
});

test('不认识的组只 warn，不影响加载', () => {
  const dir = makePack(['a.webm'], {
    id: 'x',
    animations: { breathing: ['a.webm'], sparkle: ['a.webm'] },
  });
  const res = inspectPack(dir);
  assert.equal(res.ok, true);
  assert.match(res.warnings.join(';'), /sparkle/);
});

test('回退链：actions.nod → click → turn.left → breathing', () => {
  const mk = (animations) => ({ id: 'x', animations });
  const withAll = {
    breathing: ['a.webm'],
    click: ['b.webm'],
    turn: { left: ['c.webm'] },
    actions: { nod: ['d.webm'] },
  };
  const p1 = inspectPack(makePack(['a.webm', 'b.webm', 'c.webm', 'd.webm'], { id: 'x', animations: withAll })).pack;
  assert.deepEqual(pickAnimation(p1, 'actions.nod'), ['d.webm']);
  assert.deepEqual(pickAnimation(p1, 'actions.shake'), ['b.webm']);
  assert.deepEqual(pickAnimation(p1, 'actions.laugh'), ['b.webm']);

  const noClick = inspectPack(
    makePack(['a.webm', 'c.webm'], mk({ breathing: ['a.webm'], turn: { left: ['c.webm'] } })),
  ).pack;
  assert.deepEqual(pickAnimation(noClick, 'actions.nod'), ['c.webm']);

  const onlyBreathing = inspectPack(makePack(['a.webm'], mk({ breathing: ['a.webm'] }))).pack;
  assert.deepEqual(pickAnimation(onlyBreathing, 'actions.nod'), ['a.webm']);

  const none = inspectPack(makePack(['a.webm'], mk({ breathing: ['a.webm'] }))).pack;
  assert.equal(pickAnimation(none, 'click'), null);
  assert.equal(pickAnimation(null, 'click'), null);
});

test('states：thinking / acting 可单独配，形状错要报错', () => {
  const dir = makePack(['a.webm', 'b.webm'], {
    id: 'x',
    animations: { breathing: ['a.webm'], states: { thinking: ['b.webm'] } },
  });
  const res = inspectPack(dir);
  assert.equal(res.ok, true);
  assert.deepEqual(res.pack.animations.states, { thinking: ['b.webm'] });

  const bad = inspectPack(
    makePack(['a.webm'], { id: 'x', animations: { breathing: ['a.webm'], states: ['a.webm'] } }),
  );
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(';'), /animations\.states/);

  const empty = inspectPack(
    makePack(['a.webm'], { id: 'x', animations: { breathing: ['a.webm'], states: {} } }),
  );
  assert.equal(empty.ok, false);
});

test('回退链：states.thinking → look → turn.left → breathing', () => {
  const mk = (animations) => inspectPack(makePack(['a.webm', 'b.webm', 'c.webm'], { id: 'x', animations })).pack;

  const full = mk({
    breathing: ['a.webm'],
    look: ['b.webm'],
    turn: { left: ['c.webm'] },
    states: { acting: ['c.webm'] },
  });
  assert.deepEqual(pickAnimation(full, 'states.acting'), ['c.webm']);
  assert.deepEqual(pickAnimation(full, 'states.thinking'), ['b.webm']);

  const noLook = mk({ breathing: ['a.webm'], turn: { left: ['c.webm'] } });
  assert.deepEqual(pickAnimation(noLook, 'states.thinking'), ['c.webm']);

  const onlyBreathing = mk({ breathing: ['a.webm'] });
  assert.deepEqual(pickAnimation(onlyBreathing, 'states.thinking'), ['a.webm']);
});

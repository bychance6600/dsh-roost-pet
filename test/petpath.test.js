'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { petCandidates } = require('../lib/petpath');

test('默认：先本机角色目录，再仓库目录', () => {
  const list = petCandidates({ pet: 'default', home: 'C:\\Users\\me', repoRoot: 'D:\\repo' });
  assert.deepEqual(list, [
    path.join('C:\\Users\\me', '.dsh-roost', 'pets', 'default'),
    path.join('D:\\repo', 'pets', 'default'),
  ]);
});

test('--pet 换角色名只换最后一段', () => {
  const list = petCandidates({ pet: 'test2', home: '/home/me', repoRoot: '/repo' });
  assert.equal(list[0], path.join('/home/me', '.dsh-roost', 'pets', 'test2'));
  assert.equal(list[1], path.join('/repo', 'pets', 'test2'));
});

test('--pet-dir 优先且唯一（不再回退）', () => {
  const dir = path.resolve('.tmp/pack-test');
  assert.deepEqual(petCandidates({ pet: 'x', petDir: '.tmp/pack-test', home: '/h', repoRoot: '/r' }), [dir]);
});

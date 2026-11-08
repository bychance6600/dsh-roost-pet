'use strict';

/**
 * 宠物包目录的解析顺序（2026-11-08 17:31 板子）：
 *   --pet-dir > ~/.dsh-roost/pets/<id> > <repo>/pets/<id>
 * 纯路径运算，不碰盘；读不读得出来由调用方判断。
 */

const path = require('node:path');

const HOME_PETS_DIR = '.dsh-roost';

function petCandidates({ pet = 'default', petDir = '', home, repoRoot }) {
  if (petDir) return [path.resolve(petDir)];
  return [
    path.join(home, HOME_PETS_DIR, 'pets', pet),
    path.join(repoRoot, 'pets', pet),
  ];
}

module.exports = { petCandidates, HOME_PETS_DIR };

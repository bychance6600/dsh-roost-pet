#!/usr/bin/env node
'use strict';

/*
 * 打便携包：electron 的 dist + 我们的 app.asar，解压即可跑，不装。
 *
 *   node scripts/build-portable.js
 *
 * 产物：
 *   dist/dsh-roost-pet-win32-x64/            解压后的目录（dsh-roost-pet.exe 在里面）
 *   dist/dsh-roost-pet-v<version>-win32-x64.zip
 *
 * 刻意不含：pets/（素材不入库、不随包）、docs/、.userdata/、.tmp/、node_modules/、
 * test/、tools/、scripts/。运行时不需要任何依赖。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'dsh-roost-pet-win32-x64');
const APP_TMP = path.join(DIST, '_app');
const APP_FILES = ['package.json', 'src', 'lib'];
const EXE = 'dsh-roost-pet.exe';

function log(msg) {
  process.stdout.write(`[build] ${msg}\n`);
}

function rm(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyElectron() {
  const electronDist = path.dirname(require('electron'));
  fs.cpSync(electronDist, STAGE, { recursive: true });
  const rawExe = path.join(STAGE, 'electron.exe');
  if (!fs.existsSync(rawExe)) throw new Error('electron dist 里没有 electron.exe');
  fs.renameSync(rawExe, path.join(STAGE, EXE));

  // 默认应用的壳不需要；有它在 Electron 会优先拿它当 app。
  for (const junk of ['resources/default_app.asar', 'resources/app.asar']) {
    rm(path.join(STAGE, junk));
  }
  log(`electron dist 已复制到 ${path.relative(ROOT, STAGE)}`);
}

function buildAsar() {
  rm(APP_TMP);
  fs.mkdirSync(APP_TMP, { recursive: true });
  for (const name of APP_FILES) {
    const from = path.join(ROOT, name);
    const to = path.join(APP_TMP, name);
    fs.cpSync(from, to, {
      recursive: true,
      filter: (src) => !/\.(map|log)$/.test(src) && !src.includes(`${path.sep}.tmp`),
    });
  }
  fs.mkdirSync(path.join(STAGE, 'resources'), { recursive: true });
  asar.createPackage(APP_TMP, path.join(STAGE, 'resources', 'app.asar')).then(
    () => {
      rm(APP_TMP);
      log('resources/app.asar 已生成');
      zip();
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}

function zip() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const zipPath = path.join(DIST, `dsh-roost-pet-v${pkg.version}-win32-x64.zip`);
  rm(zipPath);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  log(`zip: ${path.relative(ROOT, zipPath)}（${mb} MB）`);
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  rm(STAGE);
  copyElectron();
  buildAsar();
}

main();

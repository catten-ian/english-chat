'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const platform = path.join(root, 'android');
const gradle = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlePath = path.join(platform, gradle);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!fs.existsSync(path.join(root, 'node_modules', '@capacitor', 'cli'))) {
  console.error('Install Android wrapper dependencies first: npm install');
  process.exit(1);
}

if (!fs.existsSync(gradlePath)) run(npx, ['cap', 'add', 'android'], root);
run(npx, ['cap', 'sync', 'android'], root);
run(gradlePath, ['assembleDebug', '--console=plain'], platform);

const apk = path.join(platform, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(apk)) throw new Error('Gradle completed but debug APK was not found: ' + apk);
console.log('APK created: ' + apk);

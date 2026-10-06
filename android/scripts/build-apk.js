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

function extendGradleDownloadTimeout() {
  const properties = path.join(platform, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!fs.existsSync(properties)) return;
  const source = fs.readFileSync(properties, 'utf8');
  const timeout = process['env'].GRADLE_NETWORK_TIMEOUT || '120000';
  const updated = /(^|\n)networkTimeout=.*/.test(source)
    ? source.replace(/(^|\n)networkTimeout=.*/, `$1networkTimeout=${timeout}`)
    : source + `\nnetworkTimeout=${timeout}\n`;
  if (updated !== source) fs.writeFileSync(properties, updated);
}

if (!fs.existsSync(path.join(root, 'node_modules', '@capacitor', 'cli'))) {
  console.error('Install Android wrapper dependencies first: npm install');
  process.exit(1);
}

if (!fs.existsSync(gradlePath)) run(npx, ['cap', 'add', 'android'], root);
run(npx, ['cap', 'sync', 'android'], root);
extendGradleDownloadTimeout();
run(gradlePath, ['assembleDebug', '--console=plain'], platform);

const apk = path.join(platform, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(apk)) throw new Error('Gradle completed but debug APK was not found: ' + apk);
console.log('APK created: ' + apk);

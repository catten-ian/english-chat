'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('desktop wrapper has an isolated dev frontend and installer targets', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(config.build.frontendDist, '../web');
  assert.equal(config.build.devUrl, 'https://www.catten.cyou/english?version=dev');
  assert.deepEqual(config.bundle.targets, ['msi', 'nsis']);
  assert.ok(fs.existsSync(path.join(root, 'desktop/web/index.html')));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'desktop/web/index.html'), 'utf8'), /(?:MINIMAX|ELEVEN|API[_-]?KEY|Authorization)/i);
});

test('android wrapper build script targets debug APK without server secrets', () => {
  const config = fs.readFileSync(path.join(root, 'android/capacitor.config.ts'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'android/scripts/build-apk.js'), 'utf8');
  assert.match(config, /cyou\.catten\.english\.dev/);
  assert.match(config, /https:\/\/www\.catten\.cyou\/english\?version=dev/);
  assert.match(script, /assembleDebug/);
  assert.match(script, /app-debug\.apk/);
  assert.doesNotMatch(script, /\.env|MINIMAX_API_KEY|ELEVEN_API_KEY|sk-/i);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildDevIndex } = require('../scripts/build-dev-index');
const root = path.join(__dirname, '..');

test('dev entry mounts every resource and fingerprints its actual content', () => {
  const html = buildDevIndex(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.ok(html.includes('<base href="/english-dev/">'));
  assert.equal(buildDevIndex(html), html);
  for (const [, file, revision] of html.matchAll(/(?:src|href)="([^"?]+)\?v=([^"\s]+)/g)) {
    assert.equal(revision, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 16));
    assert.equal(new URL(file, 'https://www.catten.cyou/english-dev/').pathname, '/english-dev/' + file);
  }
});

test('homepage overflowing a short viewport remains reachable from its top', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /\.home-inner\s*\{[^}]*margin-block:\s*auto;[^}]*flex-shrink:\s*0;/);
});

test('both mobile drawers are above their shared backdrop', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /body\.drawer-open \.sidebar,\s*body\.drawer-open \.side-panel\s*\{\s*z-index:\s*1200;/);
  assert.match(css, /body\.drawer-open \.drawer-backdrop\s*\{[^}]*z-index:\s*1190;/);
});

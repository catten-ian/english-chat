'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer, request, login, openDb, APP_DIR } = require('./helpers');

test('personal provider secrets are encrypted, masked, isolated and removable', async () => {
  const server = await startServer();
  try {
    const token = await login(server.port, 'test', 'test');
    const other = await login(server.port, 'catten', 'catten');
    const call = (method, json, auth = token) => request({ port: server.port, path: '/api/providers', method, json, token: auth });
    assert.equal((await call('GET', undefined, '')).status, 401);
    const secret = 'unit-test-secret-never-return';
    assert.equal((await call('POST', { provider: 'openai', key: secret, base: 'https://api.openai.com/v1', model: 'test-model' })).status, 200);
    const status = await call('GET');
    assert.ok(!status.body.includes(secret));
    const own = JSON.parse(status.body).providers.find(p => p.id === 'openai');
    assert.equal(own.personal, true);
    assert.equal(own.model, 'test-model');
    assert.equal(JSON.parse((await call('GET', undefined, other)).body).providers.find(p => p.id === 'openai').personal, false);
    assert.equal((await call('POST', { provider: 'openai', base: 'https://api.openai.com/v1', model: 'updated' })).status, 200);
    const db = openDb(path.join(server.dataDir, 'app.db'));
    try {
      const raw = db.prepare('SELECT value FROM provider_credentials').get().value;
      assert.ok(!raw.includes(secret));
      assert.ok(!Buffer.from(raw, 'base64').toString().includes(secret));
      assert.equal(fs.statSync(path.join(server.dataDir, 'provider-key.bin')).size, 32);
    } finally { db.close(); }
    for (const base of ['http://127.0.0.1:8765', 'https://localhost', 'https://evil.example', 'https://api.openai.com@evil.example', 'https://api.openai.com:444', 'https://api.openai.com?key=x']) {
      assert.equal((await call('POST', { provider: 'custom', key: secret, base })).status, 400, base);
    }
    assert.equal((await call('POST', { provider: 'search:tavily', key: secret })).status, 200);
    assert.equal((await call('POST', { provider: 'openai', remove: true })).status, 200);
    assert.equal(JSON.parse((await call('GET')).body).providers.find(p => p.id === 'openai').personal, false);
  } finally { await server.stop(); server.cleanup(); }
});

test('local dev query uses same-origin API, public dev uses isolated mount', () => {
  const src = fs.readFileSync(path.join(APP_DIR, 'js/storage.js'), 'utf8').split('/* ---------- Auth ---------- */')[0];
  function backend(location) { return vm.runInNewContext(src + '; BACKEND_URL', { location }); }
  assert.equal(backend({ protocol: 'http:', hostname: 'localhost', pathname: '/', search: '?version=dev' }), '');
  assert.equal(backend({ protocol: 'https:', hostname: 'www.catten.cyou', pathname: '/english', search: '?version=dev' }), '/api-dev');
  assert.equal(backend({ protocol: 'https:', hostname: 'www.catten.cyou', pathname: '/english-dev/', search: '' }), '/api-dev');
  assert.equal(backend({ protocol: 'https:', hostname: 'www.catten.cyou', pathname: '/english/', search: '?version=stable' }), '');
});

test('dev deployment HTML pins assets to dev without rewriting local or stable', () => {
  const { buildDevIndex } = require('../scripts/build-dev-index');
  const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  assert.ok(html.includes('<base href="./">'));
  const deployed = buildDevIndex(html);
  assert.ok(deployed.includes('<base href="/english-dev/">'));
  assert.equal(new URL('js/storage.js', new URL('/english-dev/', 'https://www.catten.cyou/english?version=dev')).pathname, '/english-dev/js/storage.js');
});

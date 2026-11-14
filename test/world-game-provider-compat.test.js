'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Set this to a prepared release root to verify its exact provider files before
// publishing. All I/O, provider calls, account data and credentials are mocked.
const root = path.resolve(process.env.AI_EN_PROVIDER_TEST_ROOT || path.join(__dirname, '..'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(file, dependencies, globals = {}, append = '') {
  const module = { exports: {} };
  vm.runInNewContext(read(file) + append, {
    module, exports: module.exports, Buffer, URL, console, ...globals,
    require(id) {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id.startsWith('node:')) return require(id);
      throw new Error(`Unexpected dependency ${id} in ${file}`);
    }
  }, { filename: file });
  return module.exports;
}
function config(env = {}) {
  return evaluate('server/config.js', { 'node:fs': { mkdirSync() {}, readFileSync() { return ''; }, existsSync() { return false; } } }, { __dirname: '/mock/server', process: { env } });
}
function providers(configuration, personal = null) {
  return evaluate('server/services/providers.js', { '../config': configuration, './provider-credentials': { readProviderConfig: () => personal } });
}
function prepare(configuration, personal = null) {
  const registry = providers(configuration, personal);
  const dependencies = {
    '../helpers': {}, '../config': configuration, '../services/proxy': {}, '../services/anki': {}, '../validation': {},
    '../services/logger': {}, '../services/usage': {}, '../services/providers': registry,
    '../db': { db: { prepare: () => ({ get: () => ({ username: 'ordinary-learner' }) }) } }
  };
  return evaluate('server/routes/proxy.js', dependencies, {}, '\nmodule.exports.prepareForTest = prepareChatPayload;').prepareForTest;
}
const message = { messages: [{ role: 'user', content: 'What did you hear by the harbor?' }] };

test('AIHub8 and MiniMax registry compatibility preserves explicit empty configuration and model defaults', () => {
  const configuration = config({ AIHUB8_API_KEY: 'mock-aihub8-key', MINIMAX_API_KEY: 'mock-minimax-key' });
  const registry = providers(configuration);
  assert.equal(registry.resolveProvider('aihub8').id, 'aihub8');
  assert.equal(registry.resolveProvider('aihub8').configured, true);
  assert.equal(registry.resolveProvider('aihub8').defaultModel, 'gpt-6.1-terra');
  assert.deepEqual(Array.from(registry.resolveProvider('minimax').models), ['MiniMax-M3', 'MiniMax-M3.1']);
  assert.equal(registry.resolveProvider('minimax').defaultModel, 'MiniMax-M3.1');
  const missing = providers(config({ AIHUB8_API_KEY: '', MINIMAX_API_KEY: '' })).resolveProvider('aihub8');
  assert.equal(missing.id, 'aihub8', 'missing AIHub8 credentials never mean select MiniMax instead');
  assert.equal(missing.configured, false);
});

test('ordinary account defaults, explicit MiniMax versions and sponsored restrictions use their own providers', () => {
  const run = prepare(config({ AIHUB8_API_KEY: 'mock-aihub8-key', MINIMAX_API_KEY: 'mock-minimax-key' }));
  for (const input of [{}, { provider: 'aihub8' }, { provider: 'aihub8', model: 'gpt-6.1-terra' }]) {
    const result = run({ ...message, ...input }, 1, true);
    assert.equal(result.error, undefined);
    assert.equal(result.upstream.id, 'aihub8');
    assert.equal(result.payload.model, 'gpt-6.1-terra');
    assert.equal(result.payload.stream, true);
  }
  for (const model of ['MiniMax-M3', 'MiniMax-M3.1']) {
    const result = run({ ...message, model }, 1, false);
    assert.equal(result.upstream.id, 'minimax');
    assert.equal(result.payload.model, model);
  }
  for (const input of [{ provider: 'aihub8', model: 'unfunded-model' }, { provider: 'openai', model: 'gpt-4o-mini' }]) {
    assert.equal(run({ ...message, ...input }, 1, false).status, 403);
  }
});

test('missing AIHub8 credentials are a provider-specific 503 and personal credentials preserve custom model choices', () => {
  const missing = prepare(config({ AIHUB8_API_KEY: '', MINIMAX_API_KEY: 'mock-minimax-key' }))({ ...message, provider: 'aihub8' }, 1, true);
  assert.equal(missing.status, 503);
  assert.equal(missing.error, 'provider_not_configured');
  assert.equal(missing.provider, 'aihub8');
  const custom = { base: 'https://api.aihub8.top/v1', key: 'mock-account-key', model: 'personal-default' };
  const personal = prepare(config({ AIHUB8_API_KEY: '' }), custom)({ ...message, provider: 'aihub8', model: 'personal-model' }, 1, false);
  assert.equal(personal.upstream.personal, true);
  assert.equal(personal.payload.model, 'personal-model');
});

test('AIHub8 personal provider host is trusted without weakening arbitrary host checks', () => {
  const credentials = evaluate('server/services/provider-credentials.js', {
    '../config': config(), '../db': {}, 'node:fs': {}
  }, { process: { env: {} } });
  assert.equal(credentials.validateBase('https://api.aihub8.top/v1', 'aihub8'), 'https://api.aihub8.top/v1');
  assert.throws(() => credentials.validateBase('https://untrusted.invalid/v1', 'aihub8'), /HTTPS/);
  assert.throws(() => credentials.validateBase('http://api.aihub8.top/v1', 'aihub8'), /HTTPS/);
});

test('AIHub8 sponsored dialogue and feedback pass the same quota classifier as MiniMax', () => {
  const usage = evaluate('server/services/usage.js', { './logger': {} });
  for (const kind of ['chat', 'chat_stream']) {
    assert.equal(usage.isGiftLearningRequest({ provider: 'aihub8', model: 'gpt-6.1-terra', kind }), true);
    assert.equal(usage.isGiftLearningRequest({ provider: 'minimax', model: 'MiniMax-M3.1', kind }), true);
    assert.equal(usage.isGiftLearningRequest({ provider: 'openai', model: 'gpt-4o-mini', kind }), false);
  }
  assert.equal(usage.isGiftLearningRequest({ provider: 'aihub8', model: 'gpt-6.1-terra', kind: 'tts' }), false);
  assert.equal(usage.isGiftLearningRequest({ provider: 'aihub8', model: 'other', kind: 'chat' }), false);
});

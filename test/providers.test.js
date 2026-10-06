'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ALLOWED, resolveProvider, normalizeProviderBase, sanitizeModel } = require('../server/services/providers');

test('compatible provider registry resolves provider-specific model defaults', () => {
  for (const id of ['minimax', 'openai', 'deepseek', 'qwen', 'siliconflow', 'openrouter', 'ollama', 'custom']) {
    assert.ok(ALLOWED.has(id));
    const provider = resolveProvider(id);
    assert.equal(provider.id, id);
    assert.equal(sanitizeModel('', provider), provider.defaultModel || 'MiniMax-M3');
  }
  assert.equal(resolveProvider('untrusted-endpoint').id, 'minimax');
});

test('base normalization preserves provider path and avoids duplicate v1', () => {
  assert.equal(normalizeProviderBase(' https://example.com/v1/ '), 'https://example.com');
  assert.equal(normalizeProviderBase('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com/compatible-mode');
  assert.equal(normalizeProviderBase('https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api');
});

function frontendPreferences(settings) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/app/01-core.js'), 'utf8');
  const start = source.indexOf('const LLM_PROVIDER_OPTIONS');
  const end = source.indexOf('function buildVisionMessages', start);
  const sandbox = { getSetting: (key, fallback) => settings[key] ?? fallback };
  vm.runInNewContext(source.slice(start, end) + '\nthis.result = { llmPreference, activeVisionProvider, activeVisionModel };', sandbox);
  return sandbox.result;
}

test('text and vision provider preferences are independent with MiniMax M3 default', () => {
  assert.equal(frontendPreferences({}).llmPreference().textModel, 'MiniMax-M3');
  const helpers = frontendPreferences({ llmProvider: 'deepseek', llmVisionProvider: 'qwen', llmVisionModel: 'qwen-vl-plus' });
  assert.equal(helpers.llmPreference().textModel, 'deepseek-chat');
  assert.equal(helpers.activeVisionProvider(), 'qwen');
  assert.equal(helpers.activeVisionModel(), 'qwen-vl-plus');
});

test('vision provider inherits text provider unless explicitly changed', () => {
  const helpers = frontendPreferences({ llmProvider: 'openai', llmTextModel: 'gpt-4o' });
  assert.equal(helpers.activeVisionProvider(), 'openai');
  assert.equal(helpers.activeVisionModel(), 'gpt-4o');
});

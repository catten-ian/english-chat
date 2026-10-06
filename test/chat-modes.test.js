'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js/app/01-core.js'), 'utf8');
const agents = fs.readFileSync(path.join(root, 'js/app/02-agents.js'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'js/app/07-chat-actions.js'), 'utf8');
const modes = fs.readFileSync(path.join(root, 'js/app/31-chat-modes.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'js/app/12-settings.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');

test('chat requests can select a dedicated provider/model without changing global calls', () => {
  assert.match(core, /options\.chat[\s\S]*chatLlmPreference\(\)/);
  assert.match(agents, /streamChat\(messages, onDelta, signal, options\)/);
  assert.match(agents, /options\.chat[\s\S]*chatLlmPreference\(\)/);
  assert.match(actions, /streamOrCall\([\s\S]*\{ chat: true \}\)/);
});

test('chat request history excludes empty streaming placeholders', () => {
  assert.match(core, /getActivePath\(\)\.slice\(-20\)[\s\S]*\.filter\(m =>/);
  assert.match(core, /typeof m\.content === 'string'\) return !!m\.content\.trim\(\)/);
  assert.match(core, /return Array\.isArray\(m\.content\) && m\.content\.length > 0/);
});

test('chat modes include human-style, debate, scenario, and Tavern world context', () => {
  assert.match(modes, /natural: \{ label: '自然聊天'/);
  assert.match(modes, /debate: \{ label: '人机辩论'/);
  assert.match(modes, /scenario: \{ label: '情景会话'/);
  assert.match(modes, /Do not enumerate every point/);
  assert.match(modes, /TavernCards\.worldPrompt/);
  assert.match(settings, /chatModeMarkup\(\)/);
  assert.match(settings, /saveChatModeSettings\(\)/);
  for (const key of ['chatMode', 'chatScenario', 'chatDebateSide', 'chatLlmProvider', 'chatLlmTextModel', 'chatWorldbook']) {
    assert.match(storage, new RegExp("['\"]" + key + "['\"]"), key + ' must be account-synced');
  }
});

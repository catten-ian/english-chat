/* 首页与模块切换回归测试 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert');
const { APP_DIR } = require('./helpers');

const SRC = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '15-modes.js'), 'utf8');

test('首页点击当前模式 Chat 仍会进入聊天区', () => {
  const elements = {
    homePage: { style: { display: 'flex' } },
    sidePanel: { style: {} },
    chatArea: { style: { display: 'none' } },
    newConvBtn: { style: {} },
    difficultyCtl: { style: {} },
    mainArea: { querySelectorAll: () => [elements.chatArea] }
  };
  const stored = new Map([['ai_en_mode', 'home']]);
  const sandbox = {
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value))
    },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => []
    },
    closeDrawers: () => {},
    closeMobileMore: () => {},
    resetAnalysisForMode: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: '15-modes.js' });

  sandbox.switchMode('chat');

  assert.strictEqual(elements.homePage.style.display, 'none');
  assert.strictEqual(elements.chatArea.style.display, 'flex');
  assert.strictEqual(stored.get('ai_en_mode'), 'chat');
});

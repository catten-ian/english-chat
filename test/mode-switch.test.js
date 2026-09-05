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

test('填空输入框 Enter 提交后不会冒泡为下一题', () => {
  const listeners = {};
  const input = {
    value: '',
    focus() { active = this; },
    addEventListener(type, fn) { listeners[type] = fn; }
  };
  const submit = { addEventListener() {} };
  const modal = {
    querySelectorAll() { return [input]; },
    querySelector(selector) { return selector === '#wrFillSubmit' ? submit : input; }
  };
  let active = null;
  let submitted = 0;
  const sandbox = {
    webReviewState: { quiz: { type: 'fill' }, locked: false },
    setTimeout() {},
    document: { getElementById: () => null, querySelector: () => null }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });
  vm.runInContext("webReviewState = { quiz: { type: 'fill' }, locked: false };", sandbox);

  sandbox.webReviewBindFillSubmit(modal);
  const event = {
    key: 'Enter',
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  input.value = 'answer';
  listeners.keydown(event);

  assert.strictEqual(vm.runInContext('webReviewState.stage', sandbox), 'graded');
  assert.strictEqual(event.defaultPrevented, true);
  assert.strictEqual(event.propagationStopped, true);
});

test('网页复习拒绝接管其他账户的 Anki 牌组', () => {
  const sandbox = {
    ANKI_DECK_PREFIX: '英语学习',
    currentUser: () => 'test',
    ankiBaseDeck: () => '英语学习::test'
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = `function ankiBaseDeck() { return ANKI_DECK_PREFIX + '::' + currentUser(); }\n` + fs.readFileSync(path.join(APP_DIR, 'js', 'app', '22-web-review.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: '22-web-review.js' });

  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::test::薄弱点' }), true);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::test' }), true);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: '英语学习::catten::薄弱点' }), false);
  assert.strictEqual(sandbox.webReviewDeckMatches({ deckName: 'Default' }), false);
});

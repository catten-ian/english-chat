'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const source = fs.readFileSync(path.join(__dirname, '../js/app/12-settings.js'), 'utf8');

test('settings markup places provider and TTS sections beside, not inside, other sections', () => {
  const start = source.indexOf('modal.innerHTML = `');
  const end = source.indexOf('overlay.appendChild(modal)', start);
  const { document } = parseHTML(source.slice(start, end));
  const parent = document.querySelector('[data-section="account"]').parentElement;
  for (const section of ['music', 'tts', 'llm', 'keys', 'reading-practice']) {
    assert.equal(document.querySelector('[data-section="' + section + '"]').parentElement, parent, section + ' must be an independent section');
  }
});

test('settings retain independent TTS, music and model sections without assigning unmarked blocks to account', () => {
  const { document } = parseHTML('<div id="modal"><div class="modal-body"><div data-section="account">当前账户</div><div data-section="music">背景音乐</div><div data-section="tts">TTS 设置 朗读时背景音乐</div><div data-section="llm">模型与搜索</div><div>未知的设置区域</div></div></div>');
  const start = source.indexOf('function restructureSettingsModal(');
  const end = source.indexOf('/* ---------- AnkiConnect', start);
  const context = { document, console };
  vm.runInNewContext(source.slice(start, end), context);
  context.restructureSettingsModal(document.getElementById('modal'));
  const groups = [...document.querySelectorAll('details')];
  assert.equal(groups.length, 4);
  assert.equal(groups.filter(el => el.querySelector('summary').textContent.includes('账户')).length, 1);
  assert.notEqual(document.querySelector('[data-section="tts"]').closest('details'), document.querySelector('[data-section="music"]').closest('details'));
  assert.equal(document.querySelector('[data-section="llm"]').closest('details').querySelector('summary').textContent, '🤖 模型与搜索');
  assert.ok(document.querySelector('.modal-body').textContent.includes('未知的设置区域'));
});

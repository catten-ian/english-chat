'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('js/app/05-chat-view.js', 'utf8');
const start = source.indexOf('function parseVocabImportRows(');
const end = source.indexOf('\nfunction saveVocabImport(', start);
assert.ok(start >= 0 && end > start, 'import parser must remain a standalone function');
const sandbox = {};
vm.runInNewContext(source.slice(start, end), sandbox);
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('生词批量导入解析 JSON 字符串数组和包装数组', () => {
  assert.deepEqual(plain(sandbox.parseVocabImportRows('["obscure", "take off"]')), [
    { word: 'obscure' }, { word: 'take off' }
  ]);
  assert.deepEqual(plain(sandbox.parseVocabImportRows('{"words":[{"word":"obscure","meaning":"不清楚的"}]}')), [
    { word: 'obscure', meaning: '不清楚的' }
  ]);
});

test('生词批量导入解析带引号逗号的 CSV 释义', () => {
  assert.deepEqual(plain(sandbox.parseVocabImportRows('obscure,"不清楚的,模糊的"\ncome across\t偶然遇到')), [
    { word: 'obscure', meanings: ['不清楚的,模糊的'] },
    { word: 'come across', meanings: ['偶然遇到'] }
  ]);
});

test('空输入返回空数组而不是抛异常', () => {
  assert.deepEqual(plain(sandbox.parseVocabImportRows('  ')), []);
  assert.deepEqual(plain(sandbox.parseVocabImportRows('{bad json')), [{ word: '{bad json', meanings: [] }], 'malformed JSON falls back to text rows');
});

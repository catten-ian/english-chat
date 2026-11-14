'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('js/app/05-chat-view.js', 'utf8');
const start = source.indexOf('function saveVocabEditor(');
const end = source.indexOf('\nfunction importVocab(', start);
assert.ok(start >= 0 && end > start, 'saveVocabEditor must remain a standalone function');

function runSave(initial, idx) {
  let saved;
  let removed = false;
  const values = {
    vocabEditWord: { value: 'orbit' },
    vocabEditMeanings: { value: '轨道\n运行轨迹' },
    vocabEditDirection: { value: 'word-to-meaning' },
    vocabEditContext: { value: 'satellite orbit' }
  };
  const sandbox = {
    document: {
      getElementById: id => values[id],
      querySelector: () => ({ remove: () => { removed = true; } })
    },
    getVocab: () => structuredClone(initial),
    saveVocab: value => { saved = value; },
    renderVocab() {},
    toastMsg() {},
    esc: value => value,
    generateVocabMeaningAsync() {}
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  sandbox.saveVocabEditor(idx);
  return { saved: JSON.parse(JSON.stringify(saved)), removed };
}

test('手动添加生词可以保存并关闭表单', () => {
  const result = runSave([], -1);
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].word, 'orbit');
  assert.deepEqual(result.saved[0].meanings, ['轨道', '运行轨迹']);
  assert.equal(result.saved[0].direction, 'word-to-meaning');
  assert.equal(result.removed, true);
});

test('编辑生词保留原有词性、例句和添加日期', () => {
  const result = runSave([{
    word: 'old', meanings: ['旧释义'], translation: '旧释义', direction: 'meaning-to-word',
    context: '', part: 'n.', example: 'An example.', added: '2026-01-01'
  }], 0);
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].word, 'orbit');
  assert.equal(result.saved[0].part, 'n.');
  assert.equal(result.saved[0].example, 'An example.');
  assert.equal(result.saved[0].added, '2026-01-01');
  assert.equal(result.removed, true);
});

test('逐条词义可以保存标记、重点状态和独立复习方向', () => {
  const rows = [{ querySelector: selector => ({
    '[data-sense-field="text"]': { value: '痴迷' },
    '[data-sense-field="pos"]': { value: 'n.' },
    '[data-sense-field="example"]': { value: 'Her obsession with detail was obvious.' },
    '[data-sense-field="focus"]': { checked: true },
    '[data-sense-field="unknown"]': { checked: true },
    '[data-sense-field="direction"]': { value: 'en2zh' }
  }[selector]) }];
  let saved;
  const sandbox = {
    document: {
      getElementById: id => ({
        vocabEditWord: { value: 'obsession' }, vocabEditDirection: { value: 'meaning-to-word' }, vocabEditContext: { value: '' }
      }[id]),
      querySelectorAll: () => rows,
      querySelector: () => ({ remove() {} })
    },
    getVocab: () => [], saveVocab: value => { saved = value; }, renderVocab() {}, toastMsg() {}, esc: value => value
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  sandbox.saveVocabEditor(-1);
  const sense = JSON.parse(JSON.stringify(saved[0].senses[0]));
  assert.equal(sense.text, '痴迷');
  assert.equal(sense.pos, 'n.');
  assert.equal(sense.focus, true);
  assert.equal(sense.unknown, true);
  assert.equal(sense.direction, 'en2zh');
});

test('旧格式字符串释义读取时转换为兼容的新 senses 结构', () => {
  const storage = fs.readFileSync('js/storage.js', 'utf8');
  const startAt = storage.indexOf('function normalizeVocabEntry(');
  const endAt = storage.indexOf('\nfunction saveVocab(', startAt);
  const sandbox = {};
  vm.runInNewContext(storage.slice(startAt, endAt) + '\nthis.normalizeVocabEntry = normalizeVocabEntry;', sandbox);
  const value = JSON.parse(JSON.stringify(sandbox.normalizeVocabEntry({
    word: 'orbit', meanings: ['轨道', '运行轨迹'], direction: 'word-to-meaning'
  })));
  assert.equal(value.senses.length, 2);
  assert.equal(value.senses[0].text, '轨道');
  assert.equal(value.senses[0].direction, 'en2zh');
  assert.equal(value.senses[0].focus, false);
});

test('仅有旧 translation 字符串的记录也迁移为 senses 并进入后台标准化队列', () => {
  const storage = fs.readFileSync('js/storage.js', 'utf8');
  const startAt = storage.indexOf('function normalizeVocabEntry(');
  const endAt = storage.indexOf('\nfunction saveVocab(', startAt);
  const sandbox = {};
  vm.runInNewContext(storage.slice(startAt, endAt) + '\nthis.normalizeVocabEntry = normalizeVocabEntry;', sandbox);
  const value = JSON.parse(JSON.stringify(sandbox.normalizeVocabEntry({ word: 'orbit', translation: '轨道 / 运行轨迹' })));
  assert.deepEqual(value.senses.map(sense => sense.text), ['轨道', '运行轨迹']);
  assert.equal(value.needsMeaningStandardization, true);
});

test('后台标准化成功时保留逐义重点和方向，只补词性与例句', async () => {
  const startAt = source.indexOf('let vocabStandardizationPending = false;');
  const endAt = source.indexOf('\nfunction showVocabDetail(', startAt);
  let rows = [{ word: 'orbit', meanings: ['轨道'], senses: [{ text: '轨道', focus: true, unknown: true, direction: 'en2zh' }], needsMeaningStandardization: true }];
  let saved;
  const sandbox = {
    getVocab: () => structuredClone(rows),
    saveVocab: value => { saved = JSON.parse(JSON.stringify(value)); rows = value; },
    renderVocab() {},
    smartParseJSON: JSON.parse,
    callAPI: async () => JSON.stringify({ items: [{ word: 'orbit', senses: [{ pos: 'n.', meaning: '轨道', example: 'The satellite entered orbit.' }] }] })
  };
  vm.runInNewContext(source.slice(startAt, endAt), sandbox);
  sandbox.standardizeLegacyVocabAsync();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saved[0].senses[0].pos, 'n.');
  assert.equal(saved[0].senses[0].example, 'The satellite entered orbit.');
  assert.equal(saved[0].senses[0].focus, true);
  assert.equal(saved[0].senses[0].unknown, true);
  assert.equal(saved[0].senses[0].direction, 'en2zh');
  assert.equal(saved[0].needsMeaningStandardization, false);
});

test('后台标准化自动续跑所有超过首批十条的旧释义', async () => {
  const startAt = source.indexOf('let vocabStandardizationPending = false;');
  const endAt = source.indexOf('\nfunction showVocabDetail(', startAt);
  let rows = Array.from({ length: 23 }, (_, i) => ({
    word: 'word' + i, meanings: ['释义' + i], senses: [{ text: '释义' + i, direction: 'en2zh' }], needsMeaningStandardization: true
  }));
  let calls = 0;
  const sandbox = {
    getVocab: () => structuredClone(rows),
    saveVocab: value => { rows = JSON.parse(JSON.stringify(value)); },
    renderVocab() {}, smartParseJSON: JSON.parse,
    setTimeout: callback => setTimeout(callback, 0),
    callAPI: async messages => {
      calls++;
      const items = JSON.parse(messages[1].content).map(item => ({ word: item.word, senses: item.meanings.map(meaning => ({ pos: 'n.', meaning, example: 'A natural example.' })) }));
      return JSON.stringify({ items });
    }
  };
  vm.runInNewContext(source.slice(startAt, endAt), sandbox);
  sandbox.standardizeLegacyVocabAsync();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 3);
  assert.equal(rows.filter(item => item.needsMeaningStandardization).length, 0);
  assert.ok(rows.every(item => item.senses[0].example === 'A natural example.'));
});

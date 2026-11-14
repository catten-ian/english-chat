'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function createStatsHarness(history, initialStats = {}) {
  const helpers = fs.readFileSync(path.join(root, 'js/app/33-translation-stats.js'), 'utf8');
  assert.ok(helpers, 'translation stats helpers should be present');
  const values = { trHistory: history, trQuestionStats: initialStats };
  const raw = new Map([
    ['ai_en_setting_trHistory', JSON.stringify(history)],
    ['ai_en_setting_trQuestionStats', JSON.stringify(initialStats)]
  ]);
  let settingReads = 0;
  const sandbox = {
    TRANSLATION_BANK: {
      gaokao: { items: [{ zh: '随着中国经济的发展，人们的生活水平有了显著提高。' }, { zh: '随着中国经济的发展，人们的生活水平有了显著提高！' }] },
      cet4: { items: [{ zh: '随着中国经济的发展，人们的生活水平有了显著提高！' }] }
    },
    getSetting: (key, fallback) => { settingReads++; return values[key] ?? fallback; },
    setSetting: (key, value) => {
      values[key] = value;
      raw.set('ai_en_setting_' + key, JSON.stringify(value));
    },
    localStorage: { getItem: key => raw.get(key) ?? null },
    Date, Number, String, Map, Math, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers + '\nglobalThis.reconcile = trReconcileStatsFromHistory; globalThis.getStat = trGetStat; globalThis.unique = trUniqueTranslationEntries; globalThis.categoryEntries = trTranslationCategoryEntries; globalThis.categoryLabel = trTranslationCategoryLabel;', sandbox);
  return { reconcile: sandbox.reconcile, getStat: sandbox.getStat, unique: sandbox.unique, categoryEntries: sandbox.categoryEntries, categoryLabel: sandbox.categoryLabel, values, getSettingReads: () => settingReads };
}

test('legacy translation history restores answered state and scores by normalized prompt', () => {
  const { reconcile, values } = createStatsHarness([
    { action: 'submit', question: '随着中国经济的发展，人们的生活水平有了显著提高', userAnswer: 'Answer one', score: '9/10', feedback: 'Good', t: 100 },
    { action: 'show_answer', question: '随着中国经济的发展，人们的生活水平有了显著提高。', userAnswer: '(查看参考答案)', score: 'N/A', t: 200 }
  ]);

  const stats = reconcile();
  assert.equal(stats['gaokao:0'].answered, 1);
  assert.equal(stats['gaokao:0'].bestScore, 9);
  assert.equal(stats['gaokao:0'].lastAnswer, 'Answer one');
  assert.equal(stats['cet4:0'].answered, 1);
  assert.equal(values.trQuestionStats['gaokao:0'].lastScore, 9);
});

test('history reconciliation preserves existing counts and is idempotent', () => {
  const { reconcile, values } = createStatsHarness([
    { action: 'submit', question: '随着中国经济的发展，人们的生活水平有了显著提高。', userAnswer: 'Answer', score: '7/10', t: 100 }
  ], { 'gaokao:0': { answered: 4, bestScore: 8, lastScore: 6, lastTime: 50 } });

  const first = reconcile();
  assert.equal(first['gaokao:0'].answered, 4);
  assert.equal(first['gaokao:0'].bestScore, 8);
  assert.equal(first['gaokao:0'].lastScore, 7);
  const snapshot = JSON.stringify(values.trQuestionStats);
  reconcile();
  assert.equal(JSON.stringify(values.trQuestionStats), snapshot);
});

test('repeated question lookups reuse the reconciled history snapshot', () => {
  const { getStat, getSettingReads } = createStatsHarness([
    { action: 'submit', question: '随着中国经济的发展，人们的生活水平有了显著提高。', userAnswer: 'Answer', score: '7/10', t: 100 }
  ]);
  getStat('gaokao', 0);
  const readsAfterFirstLookup = getSettingReads();
  getStat('gaokao', 0);
  getStat('cet4', 0);
  assert.equal(getSettingReads(), readsAfterFirstLookup);
});

test('duplicate prompts are listed once and share their strongest history', () => {
  const { getStat, unique, values } = createStatsHarness([], {
    'gaokao:0': { answered: 1, bestScore: 6, lastScore: 6, lastTime: 100 },
    'gaokao:1': { answered: 2, bestScore: 9, lastScore: 8, lastTime: 200 }
  });
  values.trQuestionStats = values.trQuestionStats;
  const entries = unique([
    { catKey: 'gaokao', catIdx: 0, item: { zh: '同一句。' } },
    { catKey: 'gaokao', catIdx: 1, item: { zh: '同一句' } }
  ]);
  assert.equal(entries.length, 1);
  assert.equal(getStat('gaokao', 0).bestScore, 9);
  assert.equal(getStat('gaokao', 0).answered, 2);
});

test('only-new selection filters the de-duplicated pool', () => {
  const { unique } = createStatsHarness([]);
  const entries = unique([
    { catKey: 'gaokao', catIdx: 0, item: { zh: '重复题。' } },
    { catKey: 'gaokao', catIdx: 1, item: { zh: '重复题' } },
    { catKey: 'gaokao', catIdx: 2, item: { zh: '新题。' } }
  ]);
  assert.deepEqual(entries.map(x => x.catIdx), [0, 2]);
  const answered = new Set(['gaokao:0']);
  assert.deepEqual(entries.filter(x => !answered.has(`${x.catKey}:${x.catIdx}`)).map(x => x.catIdx), [2]);
});

test('Shanghai 2024 category count reflects the 108 unique prompts', () => {
  const source = fs.readFileSync(path.join(root, 'js/shgaoka_bank.js'), 'utf8');
  const bankContext = { window: {} };
  vm.createContext(bankContext);
  vm.runInContext(source, bankContext);
  const settings = {};
  const sandbox = {
    TRANSLATION_BANK: bankContext.window.SH_GAOKAO_BANK,
    getSetting: (key, fallback) => settings[key] ?? fallback,
    setSetting: (key, value) => { settings[key] = value; },
    Date, Number, String, Map, Math, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app/33-translation-stats.js'), 'utf8') +
    '\nglobalThis.entries = trTranslationCategoryEntries; globalThis.label = trTranslationCategoryLabel;', sandbox);
  assert.equal(bankContext.window.SH_GAOKAO_BANK['上海高考 2024'].items.length, 116);
  assert.equal(sandbox.entries('上海高考 2024').length, 108);
  assert.equal(sandbox.label('上海高考 2024'), '上海高考 2024');
});

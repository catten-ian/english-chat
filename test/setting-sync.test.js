'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('setting sync defers serialization and batches changed keys after paint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/storage.js'), 'utf8');
  const start = source.indexOf('const SYNCED_SETTING_KEYS = [');
  const end = source.indexOf('/* ---------- Vocabulary ---------- */', start);
  assert.ok(start >= 0 && end > start);
  const values = new Map([
    ['ai_en_setting_trHistory', JSON.stringify([{ question: 'q' }])],
    ['ai_en_setting_trQuestionStats', JSON.stringify({ 'cat:0': { answered: 1 } })]
  ]);
  const rafCallbacks = [];
  const timers = [];
  const uploads = [];
  let backup = { theme: 'dark' };
  const sandbox = {
    module: { exports: {} },
    Set, Array, JSON,
    localStorage: { getItem: key => values.get(key) ?? null },
    currentUser: () => 'test',
    requestAnimationFrame: callback => rafCallbacks.push(callback),
    setTimeout: callback => timers.push(callback),
    getSettingsBackup: () => ({ ...backup }),
    saveSettingsBackup: value => { backup = { ...value }; },
    apiSave: (key, data) => uploads.push({ key, data }),
    dbg() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.sync = syncSettingToServer;', sandbox);

  sandbox.sync('trHistory');
  sandbox.sync('trQuestionStats');
  assert.equal(uploads.length, 0);
  assert.deepEqual(backup, { theme: 'dark' });
  assert.equal(rafCallbacks.length, 1);

  rafCallbacks[0]();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].key, 'settings');
  assert.deepEqual(uploads[0].data, {
    theme: 'dark',
    trHistory: [{ question: 'q' }],
    trQuestionStats: { 'cat:0': { answered: 1 } }
  });
});

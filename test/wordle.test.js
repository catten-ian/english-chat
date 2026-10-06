'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadWordleHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app', '18-games.js'), 'utf8');
  const start = source.indexOf('const WORDLE_BANK =');
  const end = source.indexOf('function wordleSource', start);
  assert.ok(start >= 0 && end > start, 'Wordle bank section not found');
  const sandbox = { Math, Set, String, Array, parseInt: Number.parseInt };
  vm.runInNewContext(source.slice(start, end) + '\nthis.__helpers = { WORDLE_BANK, normalizeWordleWord, wordleBankWord, scoreWordleGuess };', sandbox);
  return sandbox.__helpers;
}

describe('Wordle local bank and duplicate scoring', () => {
  test('bank contains only valid 4-7 letter lowercase words', () => {
    const { WORDLE_BANK } = loadWordleHelpers();
    for (const length of [4, 5, 6, 7]) {
      assert.ok(Array.isArray(WORDLE_BANK[length]) && WORDLE_BANK[length].length > 0);
      for (const word of WORDLE_BANK[length]) assert.match(word, new RegExp('^[a-z]{' + length + '}$'));
    }
  });

  test('two-pass scoring does not over-count duplicate letters', () => {
    const { scoreWordleGuess } = loadWordleHelpers();
    assert.deepEqual(scoreWordleGuess('allee', 'apple'), ['right', 'mispos', 'absent', 'absent', 'right']);
    assert.deepEqual(scoreWordleGuess('eerie', 'erase'), ['right', 'absent', 'mispos', 'absent', 'right']);
    assert.deepEqual(scoreWordleGuess('aabbb', 'abaca'), ['right', 'mispos', 'mispos', 'absent', 'absent']);
  });

  test('invalid AI output is rejected by length and alphabet validation', () => {
    const { normalizeWordleWord } = loadWordleHelpers();
    assert.equal(normalizeWordleWord('APPLE', 5), 'apple');
    assert.equal(normalizeWordleWord('apple!', 5), '');
    assert.equal(normalizeWordleWord('planet', 5), '');
    assert.equal(normalizeWordleWord('teacher', 7), 'teacher');
  });
});

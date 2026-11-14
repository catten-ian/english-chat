'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/app/20-progress.js', 'utf8');

function loadTrendHelpers(history = []) {
  const sandbox = {
    getSetting: key => key === 'trHistory' ? history : undefined,
    module: { exports: {} }
  };
  vm.runInNewContext(source + '\nmodule.exports = { translationScores, translationScoreBuckets };', sandbox);
  return sandbox.module.exports;
}

test('translation trend filters scores to the selected time range', () => {
  const now = Date.UTC(2026, 10, 8);
  const points = [
    { t: now - 8 * 86400000, score: 9 },
    { t: now - 6 * 86400000, score: 7 },
    { t: now, score: 8 },
    { t: now + 86400000, score: 10 }
  ];
  const { translationScoreBuckets } = loadTrendHelpers();
  const result = translationScoreBuckets(points, '7d', now);

  assert.equal(result.points.length, 2);
  assert.equal(result.range.label, '7 天');
  assert.deepEqual(Array.from(result.buckets, bucket => bucket.score), [7, 8]);
});

test('translation trend groups dense scores into time buckets and averages each bucket', () => {
  const now = Date.UTC(2026, 10, 8);
  const start = now - 30 * 86400000;
  const points = [
    { t: start + 86400000, score: 6 },
    { t: start + 2 * 86400000, score: 8 },
    { t: start + 5 * 86400000, score: 9 }
  ];
  const { translationScoreBuckets } = loadTrendHelpers();
  const result = translationScoreBuckets(points, '30d', now);

  assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[0].score, 7);
  assert.equal(result.buckets[0].count, 2);
  assert.equal(result.buckets[1].score, 9);
});

test('translation score history accepts numeric and ISO timestamps and decimal scores', () => {
  const history = [
    { t: Date.UTC(2026, 10, 7), score: '8.5/10' },
    { t: '2026-11-08T00:00:00.000Z', score: '7/10' },
    { t: '2026-11-08T01:00:00.000Z', score: '评分中' }
  ];
  const { translationScores } = loadTrendHelpers(history);
  const result = translationScores();

  assert.equal(result.length, 2);
  assert.equal(result[0].score, 8.5);
  assert.equal(result[1].score, 7);
  assert.ok(result[0].t < result[1].t);
});

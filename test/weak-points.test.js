'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { embedTexts, parseEmbeddings, cosine } = require('../server/services/embeddings');
const { lexicalClusters, embeddingClusters } = require('../server/routes/weak-points');

test('embedding response is validated, ordered, and dimension-consistent', () => {
  const vectors = parseEmbeddings(JSON.stringify({ data: [
    { index: 1, embedding: [0, 1, 0] },
    { index: 0, embedding: [1, 0, 0] }
  ] }), 2);
  assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(parseEmbeddings({ data: [{ index: 0, embedding: [1] }] }, 1), null);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('embedding provider failure returns explicit lexical fallback status', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, text: async () => '{"error":"offline"}' });
  try {
    const result = await embedTexts(['verb tense error'], { provider: 'ollama', model: 'nomic-embed-text' });
    assert.equal(result.vectors, null);
    assert.equal(result.mode, 'fallback');
    assert.equal(result.reason, 'provider_error');
    assert.equal(result.provider, 'ollama');
  } finally { global.fetch = oldFetch; }
});

test('semantic clusters use provider vectors while lexical fallback stays available', () => {
  const points = [
    { id: 'a', text: 'verb tense', category: 'grammar', count: 1 },
    { id: 'b', text: 'verb conjugation', category: 'grammar', count: 1 },
    { id: 'c', text: 'article vocabulary', category: 'vocabulary', count: 1 }
  ];
  const clusters = embeddingClusters(points, [[1, 0], [0.99, 0.01], [-1, 0]], 0.78);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
  assert.equal(lexicalClusters(points).length >= 1, true);
});

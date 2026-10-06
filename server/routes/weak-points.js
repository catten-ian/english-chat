/* ============================================================
   薄弱点分析：按用户隔离，提供轻量本地向量特征聚类
   ============================================================ */
'use strict';
const { sendJson, readBody } = require('../helpers');
const { db } = require('../db');
const { embedTexts, cosine } = require('../services/embeddings');

function tokens(text) { return String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []; }
function vector(text) {
  const ts = tokens(text); const v = new Map();
  ts.forEach(t => v.set(t, (v.get(t) || 0) + 1));
  return v;
}
function similarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const n of a.values()) na += n * n;
  for (const n of b.values()) nb += n * n;
  for (const [k, n] of a) dot += n * (b.get(k) || 0);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function lexicalClusters(points) {
  const clusters = [];
  for (const point of points) {
    const v = vector(point.text + ' ' + point.category); let best = null; let score = 0;
    clusters.forEach(c => { const s = similarity(v, c.vector); if (s > score) { score = s; best = c; } });
    if (!best || score < 0.18) { best = { id: 'cluster-' + (clusters.length + 1), label: point.category || point.text.slice(0, 36), vector: new Map(), points: [] }; clusters.push(best); }
    best.points.push(point); for (const [k, n] of v) best.vector.set(k, (best.vector.get(k) || 0) + n);
  }
  return clusters.map(c => ({ id: c.id, label: c.label, count: c.points.length, points: c.points }));
}
function embeddingClusters(points, vectors, threshold) {
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    let best = null; let score = 0;
    clusters.forEach(c => { const s = cosine(vectors[i], c.centroid); if (s > score) { score = s; best = c; } });
    if (!best || score < threshold) {
      best = { id: 'cluster-' + (clusters.length + 1), label: points[i].category || points[i].text.slice(0, 36), centroid: vectors[i].slice(), points: [] };
      clusters.push(best);
    } else {
      // Incremental centroid keeps clusters stable without pulling in a heavy
      // ML dependency. The vector provider still supplies the semantic space.
      const n = best.points.length + 1;
      best.centroid = best.centroid.map((value, index) => (value * (n - 1) + vectors[i][index]) / n);
    }
    best.points.push(points[i]);
  }
  return clusters.map(c => ({ id: c.id, label: c.label, count: c.points.length, points: c.points }));
}
async function weakPointsCluster(req, res) {
  const body = await readBody(req, 512 * 1024);
  let input = null; try { input = body ? JSON.parse(body.toString('utf8')) : null; } catch (e) { input = null; }
  let points = Array.isArray(input) ? input : (input && Array.isArray(input.points) ? input.points : null);
  if (!points) {
    const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(req.uid, 'weak');
    try { points = row ? JSON.parse(row.value) : []; } catch (e) { points = []; }
    if (!Array.isArray(points)) points = Object.values(points || {});
  }
  points = points.slice(0, 300).map((p, i) => ({ id: p.id || String(i), text: String(p.text || p.point || p.title || p.category || ''), category: p.category || '', count: Number(p.count || 1) })).filter(p => p.text);
  const embedding = await embedTexts(points.map(p => p.text + ' ' + p.category), {
    uid: req.uid,
    provider: input && !Array.isArray(input) ? input.embeddingProvider : undefined,
    model: input && !Array.isArray(input) ? input.embeddingModel : undefined
  });
  const threshold = Math.max(0.5, Math.min(0.99, Number(process.env.AI_EN_EMBEDDING_THRESHOLD || 0.78)));
  const clusters = embedding.vectors
    ? embeddingClusters(points, embedding.vectors, threshold)
    : lexicalClusters(points);
  sendJson(res, 200, {
    clusters,
    analysis: {
      mode: embedding.mode,
      provider: embedding.provider,
      model: embedding.model,
      dimension: embedding.dimension || null,
      fallbackReason: embedding.mode === 'fallback' ? embedding.reason : null,
      threshold: embedding.mode === 'embedding' ? threshold : 0.18
    }
  }, req);
}
module.exports = { weakPointsCluster, lexicalClusters, embeddingClusters };

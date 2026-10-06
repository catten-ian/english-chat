'use strict';

/*
 * Embeddings are deliberately isolated from the chat proxy.  A weak-point
 * analysis may use a user's configured OpenAI-compatible provider, but must
 * never silently claim to have used vectors when that provider is unavailable.
 */
const { resolveProvider, sanitizeModel } = require('./providers');

const MAX_TEXTS = 300;
const MAX_TEXT_LENGTH = 2000;
const TIMEOUT_MS = 15000;

function embeddingProviderId(input) {
  const configured = String(input || process.env.AI_EN_EMBEDDING_PROVIDER || 'openai').trim();
  return configured || 'openai';
}

function embeddingModel(input, provider) {
  const configured = String(input || process.env.AI_EN_EMBEDDING_MODEL || '').trim();
  return (configured || provider.defaultModel || '').slice(0, 120);
}

function validVector(value) {
  return Array.isArray(value) && value.length > 1 && value.length <= 8192 && value.every(n => Number.isFinite(Number(n)));
}

function parseEmbeddings(body, expected) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch (_) { return null; }
  if (!data || !Array.isArray(data.data) || data.data.length !== expected) return null;
  const rows = data.data.map((row, index) => ({
    index: Number.isInteger(row?.index) ? row.index : index,
    embedding: row?.embedding
  })).sort((a, b) => a.index - b.index);
  if (rows.some(row => !validVector(row.embedding))) return null;
  const dimension = rows[0].embedding.length;
  if (rows.some(row => row.embedding.length !== dimension)) return null;
  return rows.map(row => row.embedding.map(Number));
}

async function embedTexts(texts, options = {}) {
  const input = (Array.isArray(texts) ? texts : []).slice(0, MAX_TEXTS)
    .map(text => String(text || '').slice(0, MAX_TEXT_LENGTH));
  if (!input.length || input.some(text => !text.trim())) {
    return { vectors: null, mode: 'fallback', reason: 'invalid_input', provider: null, model: null };
  }
  const id = embeddingProviderId(options.provider);
  let provider;
  try { provider = resolveProvider(id, options.uid); } catch (error) {
    return { vectors: null, mode: 'fallback', reason: 'provider_unavailable', detail: String(error.message || error).slice(0, 160), provider: id, model: null };
  }
  const model = embeddingModel(options.model, provider);
  if (!model) return { vectors: null, mode: 'fallback', reason: 'model_not_configured', provider: id, model: null };
  if (!provider.configured || !provider.base || (!provider.key && provider.requiresKey !== false)) {
    return { vectors: null, mode: 'fallback', reason: 'provider_not_configured', provider: id, model };
  }
  // A server-side paid key must not become an unmetered embedding endpoint.
  // Personal credentials and local keyless Ollama are allowed; administrators
  // can explicitly opt in to a shared embedding budget.
  if (!provider.personal && provider.requiresKey !== false && process.env.AI_EN_EMBEDDING_ALLOW_SHARED !== '1') {
    return { vectors: null, mode: 'fallback', reason: 'shared_provider_disabled', provider: id, model };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(provider.base.replace(/\/+$/, '') + '/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + provider.key },
      body: JSON.stringify({ model, input }),
      redirect: 'error',
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) return { vectors: null, mode: 'fallback', reason: 'provider_error', status: response.status, provider: id, model };
    const vectors = parseEmbeddings(raw, input.length);
    if (!vectors) return { vectors: null, mode: 'fallback', reason: 'invalid_provider_response', provider: id, model };
    return { vectors, mode: 'embedding', provider: id, model, dimension: vectors[0].length };
  } catch (error) {
    return { vectors: null, mode: 'fallback', reason: error.name === 'AbortError' ? 'provider_timeout' : 'provider_error', provider: id, model };
  } finally {
    clearTimeout(timer);
  }
}

function cosine(a, b) {
  if (!validVector(a) || !validVector(b) || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]); const y = Number(b[i]);
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

module.exports = { embedTexts, cosine, parseEmbeddings, validVector, MAX_TEXTS, MAX_TEXT_LENGTH };

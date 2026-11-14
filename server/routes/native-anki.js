/* Authenticated gateway to the explicitly local native scheduler. */
'use strict';

const { sendJson, readBody } = require('../helpers');
const { createNativeAnkiAdapter } = require('../services/native-anki');

function adapterFromEnv() {
  return createNativeAnkiAdapter({
    url: process.env.AI_EN_SCHEDULER_URL,
    secret: process.env.AI_EN_SCHEDULER_SECRET,
    timeoutMs: process.env.AI_EN_SCHEDULER_TIMEOUT_MS
  });
}

function disabled(res, req, adapter) {
  sendJson(res, 503, { error: 'native_scheduler_disabled', reason: adapter.reason || 'not configured' }, req);
}

function parseBody(req, res, limit) {
  return readBody(req, limit).then((body) => {
    if (!body) {
      sendJson(res, 413, { error: 'body_too_large' }, req);
      return null;
    }
    try {
      const parsed = JSON.parse(body.toString('utf8') || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object');
      return parsed;
    } catch (error) {
      sendJson(res, 400, { error: 'invalid_json', message: error.message }, req);
      return null;
    }
  });
}

async function nativeAnki(req, res) {
  // app.js normally authenticates before routing; keep this boundary safe when
  // the handler is invoked directly in tests or by a future embedding.
  if (!req || !req.uid) {
    return sendJson(res, 401, { error: 'unauthorized' }, req);
  }
  const adapter = adapterFromEnv();
  if (!adapter.enabled) return disabled(res, req, adapter);
  const userId = String(req.uid);
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(/^\/api\/native-anki\/cards\/([^/]+)\/answer$/);
  try {
    if (req.method === 'GET' && url.pathname === '/api/native-anki/health') {
      const health = await adapter.health();
      return sendJson(res, 200, health, req);
    }
    if (req.method === 'GET' && url.pathname === '/api/native-anki/decks') {
      return sendJson(res, 200, await adapter.listDecks(userId), req);
    }
    if (req.method === 'GET' && url.pathname === '/api/native-anki/export') {
      return sendJson(res, 200, await adapter.exportSnapshot(userId), req);
    }
    if (req.method === 'GET' && url.pathname === '/api/native-anki/export/apkg') {
      return sendJson(res, 200, await adapter.exportPackage(userId), req);
    }
    if (req.method === 'GET' && url.pathname === '/api/native-anki/export/official-apkg') {
      return sendJson(res, 200, await adapter.exportOfficialPackage(userId), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/import/validate') {
      const body = await parseBody(req, res, 12 * 1024 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.validateSnapshot(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/import/snapshot') {
      const body = await parseBody(req, res, 12 * 1024 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.importSnapshot(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/import/apkg') {
      const body = await parseBody(req, res, 12 * 1024 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.importPackage(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/import/official-apkg') {
      const body = await parseBody(req, res, 12 * 1024 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.importOfficialPackage(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/notes') {
      const body = await parseBody(req, res, 2 * 1024 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.createNote(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/cards/due') {
      const body = await parseBody(req, res, 256 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.dueCards(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/cards/all') {
      const body = await parseBody(req, res, 256 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.allCards(userId, body), req);
    }
    if (req.method === 'POST' && url.pathname === '/api/native-anki/cards/preview') {
      const body = await parseBody(req, res, 64 * 1024);
      if (!body) return;
      return sendJson(res, 200, await adapter.preview(userId, body), req);
    }
    if (req.method === 'POST' && match) {
      const body = await parseBody(req, res, 64 * 1024);
      if (!body) return;
      let cardId;
      try { cardId = decodeURIComponent(match[1]); }
      catch (_) { return sendJson(res, 400, { error: 'invalid_card_id' }, req); }
      return sendJson(res, 200, await adapter.answer(userId, cardId, body), req);
    }
    return sendJson(res, 404, { error: 'not found' }, req);
  } catch (error) {
    const status = Number(error.status) || (error.code === 'scheduler_disabled' ? 503 : 400);
    sendJson(res, status, { error: error.code || 'native_scheduler_error', message: error.message }, req);
  }
}

module.exports = { nativeAnki };

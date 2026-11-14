/* Local-only client for the native scheduler. Configuration is explicit and disabled by default. */
'use strict';

function endpoint(baseUrl) {
  const parsed = new URL(String(baseUrl || ''));
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    const e = new Error('scheduler endpoint must be localhost HTTP'); e.code = 'scheduler_endpoint_rejected'; throw e;
  }
  return parsed.toString().replace(/\/$/, '');
}

function createClient(options) {
  const opts = options || {};
  const baseUrl = opts.url ? endpoint(opts.url) : null;
  const secret = String(opts.secret || '');
  const timeoutValue = Number(opts.timeoutMs || 5000);
  const timeout = Number.isFinite(timeoutValue) ? Math.max(1000, Math.min(60000, timeoutValue)) : 5000;
  const requestJson = async (url, init) => {
    let res;
    try {
      res = await fetch(url, init);
    } catch (error) {
      const err = new Error(error && error.name === 'AbortError' ? 'scheduler request timed out' : 'scheduler request failed');
      err.code = error && error.name === 'AbortError' ? 'scheduler_timeout' : 'scheduler_unavailable';
      err.status = 503;
      err.cause = error;
      throw err;
    }
    const text = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json());
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) {
      const err = new Error('scheduler returned invalid JSON'); err.code = 'scheduler_invalid_response'; err.status = res.status; throw err;
    }
    if (!res.ok) { const e = new Error(data.message || data.error || `scheduler HTTP ${res.status}`); e.status = res.status; e.code = data.error || 'scheduler_error'; throw e; }
    return data;
  };
  const assertProtocol = (data) => {
    if (!data || data.data_version !== 'scheduler-json-v1') {
      const e = new Error('unsupported scheduler data version'); e.code = 'scheduler_protocol_mismatch'; throw e;
    }
    const allowedScaling = new Set([
      'migration-ready-not-horizontal',
      'horizontal-ready-user-sharding',
      'horizontal-ready-shared-postgresql'
    ]);
    if (data.scaling_status && !allowedScaling.has(data.scaling_status)) {
      const e = new Error('unsupported scheduler scaling mode'); e.code = 'scheduler_scaling_mismatch'; throw e;
    }
    return data;
  };
  const request = async (path, userId, payload, method) => {
    if (!baseUrl || !secret) { const e = new Error('native scheduler is disabled'); e.code = 'scheduler_disabled'; throw e; }
    if (!userId) throw new Error('scheduler user context is required');
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const headers = { 'X-Scheduler-Secret': secret, 'X-Scheduler-User': String(userId), Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return assertProtocol(await requestJson(baseUrl + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers, body, signal: ctrl.signal }));
    } finally { clearTimeout(timer); }
  };
  const health = async () => {
    if (!baseUrl || !secret) { const e = new Error('native scheduler is disabled'); e.code = 'scheduler_disabled'; throw e; }
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      return assertProtocol(await requestJson(baseUrl + '/health', { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal }));
    } finally { clearTimeout(timer); }
  };
  return { request, health, listDecks: u => request('/v1/decks', u, undefined, 'GET'), createNote: (u,p) => request('/v1/notes',u,p), dueCards: (u,p) => request('/v1/cards/query-due',u,p || {}), allCards: (u,p) => request('/v1/cards/query-all',u,p || {}), preview: (u,p) => request('/v1/cards/preview',u,p), answer: (u,id,p) => request('/v1/cards/'+encodeURIComponent(id)+'/answer',u,p), importPreview: (u,p) => request('/v1/import/preview',u,p), importCommit: (u,p) => request('/v1/import/commit',u,p), importSnapshot: (u,p) => request('/v1/import/snapshot',u,p), validateSnapshot: (u,p) => request('/v1/import/validate',u,p), exportPackage: u => request('/v1/export/apkg',u,undefined,'GET'), importPackage: (u,p) => request('/v1/import/apkg',u,p), exportOfficialPackage: u => request('/v1/export/official-apkg',u,undefined,'GET'), importOfficialPackage: (u,p) => request('/v1/import/official-apkg',u,p), exportSnapshot: u => request('/v1/export',u,undefined,'GET') };
}

module.exports = { endpoint, createClient };

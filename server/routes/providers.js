'use strict';

const { sendJson, readBody } = require('../helpers');
const { PROVIDER_DEFS } = require('../config');
const { readProviderConfig, saveProviderConfig, removeProviderConfig, SEARCH_BASES } = require('../services/provider-credentials');
const { resolveProvider } = require('../services/providers');

function status(req, res) {
  const providers = Object.entries(PROVIDER_DEFS).map(([id, def]) => {
    const own = readProviderConfig(req.uid, id);
    const resolved = resolveProvider(id, req.uid);
    return { id, label: def.label, base: resolved.base, model: resolved.defaultModel,
      configured: resolved.configured, personal: !!own };
  });
  const search = Object.entries(SEARCH_BASES).map(([id, base]) => {
    const own = readProviderConfig(req.uid, id);
    return { id, base: own?.base || base, personal: !!own };
  });
  sendJson(res, 200, { providers, search }, req);
}

async function save(req, res) {
  const body = await readBody(req, 12 * 1024);
  if (!body) return sendJson(res, 413, { error: 'body too large' }, req);
  let input;
  try { input = JSON.parse(body); } catch (_) { return sendJson(res, 400, { error: 'invalid json' }, req); }
  const id = String(input.provider || '');
  try {
    if (input.remove === true) removeProviderConfig(req.uid, id);
    else saveProviderConfig(req.uid, id, input);
    sendJson(res, 200, { saved: true }, req);
  } catch (e) { sendJson(res, 400, { error: e.message }, req); }
}
module.exports = { status, save };

'use strict';

const { PROVIDER_DEFS, MINIMAX_KEY, MINIMAX_BASE } = require('../config');

const ALLOWED = new Set(Object.keys(PROVIDER_DEFS));

function normalizeProviderBase(base) {
  return String(base || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function resolveProvider(input, uid) {
  const id = ALLOWED.has(String(input || '')) ? String(input) : 'minimax';
  const def = PROVIDER_DEFS[id];
  const custom = uid ? require('./provider-credentials').readProviderConfig(uid, id) : null;
  const base = normalizeProviderBase(custom?.base || (id === 'minimax' ? MINIMAX_BASE() : def.base));
  const key = String(custom?.key || (id === 'minimax' ? MINIMAX_KEY() : def.key()) || '');
  const defaultModel = custom?.model || def.defaultModel;
  const configured = !!base && (!!key || def.requiresKey === false);
  return { id, configured, base, key, defaultModel, requiresKey: def.requiresKey !== false, personal: !!custom?.key };
}

function sanitizeModel(model, provider) {
  const fallback = provider.defaultModel || 'MiniMax-M3';
  const value = String(model || '').trim().slice(0, 120);
  return value || fallback;
}

function resolveSearchProvider(input, uid) {
  const id = ['minimax', 'bing', 'brave', 'tavily', 'serper', 'none'].includes(String(input || '')) ? String(input) : 'minimax';
  const env = process.env;
  if (id === 'none') return { id, configured: false };
  const own = uid ? require('./provider-credentials').readProviderConfig(uid, id === 'minimax' ? id : 'search:' + id) : null;
  if (own) return { id, configured: true, base: own.base, key: own.key };
  if (id === 'minimax') return { id, configured: !!MINIMAX_KEY(), base: MINIMAX_BASE(), key: MINIMAX_KEY() };
  if (id === 'bing') return { id, configured: !!env.BING_SEARCH_KEY, base: env.BING_SEARCH_BASE || 'https://api.bing.microsoft.com/v7.0/search', key: env.BING_SEARCH_KEY || '' };
  if (id === 'tavily') return { id, configured: !!env.TAVILY_API_KEY, base: env.TAVILY_BASE || 'https://api.tavily.com/search', key: env.TAVILY_API_KEY || '' };
  if (id === 'serper') return { id, configured: !!env.SERPER_API_KEY, base: env.SERPER_BASE || 'https://google.serper.dev/search', key: env.SERPER_API_KEY || '' };
  return { id, configured: !!env.BRAVE_SEARCH_KEY, base: env.BRAVE_SEARCH_BASE || 'https://api.search.brave.com/res/v1/web/search', key: env.BRAVE_SEARCH_KEY || '' };
}

module.exports = { ALLOWED, resolveProvider, sanitizeModel, resolveSearchProvider, normalizeProviderBase };

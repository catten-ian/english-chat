/* Explicit local-only scheduler configuration. No environment auto-wiring. */
'use strict';

function validateLocalSchedulerConfig(config) {
  const value = config || {};
  const url = String(value.url || '').trim();
  const secret = String(value.secret || '');
  if (!url || !secret) return { enabled: false, reason: 'missing_explicit_config' };
  let parsed;
  try { parsed = new URL(url); } catch (e) { return { enabled: false, reason: 'invalid_endpoint' }; }
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    return { enabled: false, reason: 'non_local_endpoint' };
  }
  return { enabled: true, url: parsed.toString().replace(/\/$/, ''), secret };
}

module.exports = { validateLocalSchedulerConfig };

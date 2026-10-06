'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, PROVIDER_DEFS } = require('../config');
const { db } = require('../db');

let secret;
function encryptionKey() {
  if (secret) return secret;
  const file = path.join(DATA_DIR, 'provider-key.bin');
  try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  secret = fs.readFileSync(file);
  if (secret.length !== 32) throw new Error('Invalid provider encryption key');
  return secret;
}

function seal(uid, id, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(uid + ':' + id));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function readProviderConfig(uid, id) {
  const row = db.prepare('SELECT value FROM provider_credentials WHERE user_id=? AND provider=?').get(uid, id);
  if (!row) return null;
  const data = Buffer.from(row.value, 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(uid + ':' + id));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
}

const SEARCH_BASES = {
  'search:brave': 'https://api.search.brave.com/res/v1/web/search',
  'search:bing': 'https://api.bing.microsoft.com/v7.0/search',
  'search:tavily': 'https://api.tavily.com/search',
  'search:serper': 'https://google.serper.dev/search'
};

function validateBase(base, id) {
  const value = String(base || PROVIDER_DEFS[id]?.base || SEARCH_BASES[id] || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('请输入有效的 HTTPS API 地址'); }
  // User-controlled URLs must not turn the authenticated proxy into an SSRF endpoint.
  // Extra compatible hosts require an explicit server-side allowlist.
  const allowed = new Set(['api.minimaxi.com', 'api.minimax.io', 'api.openai.com', 'api.deepseek.com',
    'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'api.siliconflow.cn', 'api.siliconflow.com',
    'openrouter.ai', 'api.search.brave.com', 'api.bing.microsoft.com', 'api.tavily.com', 'google.serper.dev']);
  for (const hostname of (process.env.AI_EN_PROVIDER_HOSTS || '').split(',')) {
    if (hostname.trim()) allowed.add(hostname.trim().toLowerCase());
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || (url.port && url.port !== '443') || !allowed.has(url.hostname)) {
    throw new Error('API 地址须使用受信任的 HTTPS 域名；自定义域名需管理员加入 AI_EN_PROVIDER_HOSTS');
  }
  return value;
}

function saveProviderConfig(uid, id, input) {
  if (!Object.hasOwn(PROVIDER_DEFS, id) && !Object.hasOwn(SEARCH_BASES, id)) throw new Error('未知提供商');
  const previous = readProviderConfig(uid, id);
  const key = String(input.key || previous?.key || '').trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('请输入有效 API key');
  const value = { base: validateBase(input.base || previous?.base, id), key, model: String(input.model || '').trim().slice(0, 120) };
  db.prepare('INSERT INTO provider_credentials(user_id,provider,value) VALUES (?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET value=excluded.value')
    .run(uid, id, seal(uid, id, value));
}

function removeProviderConfig(uid, id) {
  db.prepare('DELETE FROM provider_credentials WHERE user_id=? AND provider=?').run(uid, id);
}

module.exports = { readProviderConfig, saveProviderConfig, removeProviderConfig, validateBase, SEARCH_BASES };

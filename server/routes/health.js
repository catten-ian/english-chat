/* ============================================================
   AI 英语对话教练 - 健康检查路由（server/routes/health.js）
   GET /api/health        无需鉴权；不返回绝对路径，避免泄露本机布局
   GET /api/health/anki   刷新 Anki 连接缓存
   ============================================================ */
'use strict';

const { sendJson } = require('../helpers');
const { MINIMAX_KEY, ELEVEN_KEY } = require('../config');
const { ankiCache } = require('../services/anki');

function healthGet(req, res) {
  sendJson(res, 200, { status: 'ok', minimax: !!MINIMAX_KEY(), eleven: !!ELEVEN_KEY() }, req);
}

function healthAnki(req, res) {
  ankiCache.clear();
  sendJson(res, 200, { status: 'cache_cleared' }, req);
}

module.exports = { healthGet, healthAnki };
'use strict';

const { sendJson } = require('../helpers');
const { getArticles, FEEDS } = require('../services/reading-sources');

async function sources(req, res) {
  const source = new URL(req.url, 'http://localhost').searchParams.get('source') || 'bbc';
  if (!Object.hasOwn(FEEDS, source)) return sendJson(res, 400, { error: 'Unknown reading source' }, req);
  try { return sendJson(res, 200, { articles: await getArticles(source) }, req); }
  catch (_) { return sendJson(res, 503, { error: '时文正文暂时无法获取，请使用预置文章或稍后重试' }, req); }
}

module.exports = { sources };

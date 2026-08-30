/* ============================================================
   AI 英语对话教练 - 用量记账（server/services/usage.js）

   目的：让「花了多少钱 / 数据发给了谁」可查，而不是只能靠猜。
   隐私前提：**只记录数字与元信息，绝不记录 prompt 或回复内容**。
     记：provider / kind / model / token 数 / TTS 字符数 / 状态码 / 日期
     不记：messages、生成文本、音频、搜索关键词

   写入是「best effort」：记账失败绝不能影响用户的请求，
   所有异常在此吞掉并记 warn 日志。
   ============================================================ */
'use strict';

const logger = require('./logger');

function getDb() { return require('../db').db; }

/* 本地日期 YYYY-MM-DD（按用户所在时区聚合更直观，不用 UTC） */
function localDay(d) {
  const t = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/* 记录一次调用。entry:
   { userId, provider, kind, model, promptTokens, completionTokens, totalTokens, chars, status } */
function recordUsage(entry) {
  if (!entry || !entry.userId) return;
  try {
    const pt = Math.max(0, Number(entry.promptTokens) || 0);
    const ct = Math.max(0, Number(entry.completionTokens) || 0);
    // 上游没给 total 时用 prompt+completion 兜底
    const tt = Math.max(0, Number(entry.totalTokens) || (pt + ct));
    getDb().prepare(`
      INSERT INTO usage_log (user_id, day, provider, kind, model, prompt_tokens, completion_tokens, total_tokens, chars, requests, status)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)
    `).run(
      entry.userId,
      localDay(),
      String(entry.provider || 'unknown'),
      String(entry.kind || 'unknown'),
      entry.model ? String(entry.model) : null,
      pt, ct, tt,
      Math.max(0, Number(entry.chars) || 0),
      Number(entry.status) || 200
    );
  } catch (e) {
    logger.warn('用量记账失败（不影响请求）: ' + e.message);
  }
}

/* 从 MiniMax 非流式响应里抽 usage。返回 null 表示上游没给。 */
function parseChatUsage(buf) {
  try {
    const obj = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf));
    const u = obj && obj.usage;
    if (!u) return { model: obj && obj.model ? String(obj.model) : null };
    return {
      model: obj.model ? String(obj.model) : null,
      promptTokens: u.prompt_tokens || 0,
      completionTokens: u.completion_tokens || 0,
      totalTokens: u.total_tokens || 0
    };
  } catch (e) { return null; }
}

/* 从 SSE 流的最后若干块里抽 usage。
   MiniMax 与 OpenAI 兼容格式一样：最后一个 data 帧里带 usage。
   传入累计的尾部文本（我们只保留尾部，避免把整段回复留在内存里）。 */
function parseStreamUsage(tailText) {
  if (!tailText) return null;
  // 从后往前找第一个含 "usage" 的 data 行
  const lines = String(tailText).split('\n').reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]' || !payload.includes('usage')) continue;
    try {
      const obj = JSON.parse(payload);
      const u = obj && obj.usage;
      if (u) {
        return {
          model: obj.model ? String(obj.model) : null,
          promptTokens: u.prompt_tokens || 0,
          completionTokens: u.completion_tokens || 0,
          totalTokens: u.total_tokens || 0
        };
      }
    } catch (e) { /* 不完整的帧，继续往前找 */ }
  }
  return null;
}

/* 汇总：按天 + 按 provider/kind。days 为回溯天数（含今天）。
   非法 / 缺失 / 非正数 → 默认 30 天；上限 365 天。 */
function getUsageSummary(userId, days) {
  const raw = Number(days);
  const n = Number.isFinite(raw) && raw >= 1 ? Math.min(365, Math.floor(raw)) : 30;
  const db = getDb();
  const since = (() => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    return localDay(d);
  })();

  const byDay = db.prepare(`
    SELECT day,
           SUM(total_tokens) AS tokens,
           SUM(chars) AS chars,
           SUM(requests) AS requests
    FROM usage_log
    WHERE user_id = ? AND day >= ?
    GROUP BY day ORDER BY day ASC
  `).all(userId, since);

  const byProvider = db.prepare(`
    SELECT provider, kind,
           SUM(total_tokens) AS tokens,
           SUM(prompt_tokens) AS prompt_tokens,
           SUM(completion_tokens) AS completion_tokens,
           SUM(chars) AS chars,
           SUM(requests) AS requests
    FROM usage_log
    WHERE user_id = ? AND day >= ?
    GROUP BY provider, kind ORDER BY tokens DESC
  `).all(userId, since);

  const byModel = db.prepare(`
    SELECT COALESCE(model, '(unknown)') AS model,
           SUM(total_tokens) AS tokens,
           SUM(requests) AS requests
    FROM usage_log
    WHERE user_id = ? AND day >= ? AND total_tokens > 0
    GROUP BY model ORDER BY tokens DESC LIMIT 20
  `).all(userId, since);

  const totals = db.prepare(`
    SELECT SUM(total_tokens) AS tokens,
           SUM(prompt_tokens) AS prompt_tokens,
           SUM(completion_tokens) AS completion_tokens,
           SUM(chars) AS chars,
           SUM(requests) AS requests,
           COUNT(*) AS calls
    FROM usage_log WHERE user_id = ? AND day >= ?
  `).get(userId, since) || {};

  const today = db.prepare(`
    SELECT SUM(total_tokens) AS tokens, SUM(chars) AS chars, SUM(requests) AS requests
    FROM usage_log WHERE user_id = ? AND day = ?
  `).get(userId, localDay()) || {};

  const num = (v) => Number(v || 0);
  return {
    since,
    days: n,
    totals: {
      tokens: num(totals.tokens),
      promptTokens: num(totals.prompt_tokens),
      completionTokens: num(totals.completion_tokens),
      chars: num(totals.chars),
      requests: num(totals.requests),
      calls: num(totals.calls)
    },
    today: { tokens: num(today.tokens), chars: num(today.chars), requests: num(today.requests) },
    byDay: byDay.map(r => ({ day: r.day, tokens: num(r.tokens), chars: num(r.chars), requests: num(r.requests) })),
    byProvider: byProvider.map(r => ({
      provider: r.provider, kind: r.kind,
      tokens: num(r.tokens), promptTokens: num(r.prompt_tokens), completionTokens: num(r.completion_tokens),
      chars: num(r.chars), requests: num(r.requests)
    })),
    byModel: byModel.map(r => ({ model: r.model, tokens: num(r.tokens), requests: num(r.requests) }))
  };
}

/* 清空该用户的用量记录（隐私中心「清除用量数据」）。返回删除条数。 */
function clearUsage(userId) {
  try {
    const r = getDb().prepare('DELETE FROM usage_log WHERE user_id = ?').run(userId);
    return Number(r.changes || 0);
  } catch (e) {
    logger.warn('清除用量记录失败: ' + e.message);
    return 0;
  }
}

module.exports = { recordUsage, parseChatUsage, parseStreamUsage, getUsageSummary, clearUsage, localDay };

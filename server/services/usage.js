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
const { randomUUID } = require('node:crypto');
let giftLedgerReady = false;

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
    if (entry.personal) ensureGiftLedger();
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
    if (giftLedgerReady && !entry.reservationId && !entry.personal && isGiftLearningRequest(entry)) {
      getDb().prepare('INSERT INTO gift_calls(id,user_id,day,created_ms,state) VALUES(?,?,?,?,?)')
        .run(randomUUID(), entry.userId, localDay(), Date.now(), Number(entry.status || 200) < 400 ? 'committed' : 'released');
    }
  } catch (e) {
    logger.warn('用量记账失败（不影响请求）: ' + e.message);
  }
}

// Separate from deletable usage history: clearing analytics cannot reset gifts.
function ensureGiftLedger() {
  if (giftLedgerReady) return;
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gift_calls'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS gift_calls (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL, created_ms INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','committed','released'))
    ); CREATE INDEX IF NOT EXISTS gift_calls_user_day ON gift_calls(user_id,day);
    CREATE INDEX IF NOT EXISTS gift_calls_user_time ON gift_calls(user_id,created_ms)`);
    if (!exists) db.exec(`INSERT INTO gift_calls(id,user_id,day,created_ms,state)
      SELECT 'legacy-' || id,user_id,day,CAST(strftime('%s',ts) AS INTEGER)*1000,
      CASE WHEN status < 400 THEN 'committed' ELSE 'released' END FROM usage_log
      WHERE provider='minimax' AND kind IN ('chat','chat_stream') AND lower(COALESCE(model,'')) LIKE '%m3%'`);
    db.exec('COMMIT');
    giftLedgerReady = true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function quotaStatus(userId) {
  ensureGiftLedger();
  const db = getDb();
  const u = db.prepare('SELECT username, role, daily_call_limit, rpm_limit, provider_mode FROM users WHERE id=? AND soft_deleted_at IS NULL').get(userId);
  if (!u) return { allowed: false, status: 401, error: '账户不可用', unlimited: false, daily: 0, used: 0, rpm: 0 };
  if (u.username === 'catten' || u.username === 'test') return { allowed: true, unlimited: true };
  const day = localDay();
  const today = db.prepare("SELECT COUNT(*) requests FROM gift_calls WHERE user_id=? AND day=? AND state!='released'").get(userId, day).requests;
  const recent = db.prepare('SELECT COUNT(*) c FROM gift_calls WHERE user_id=? AND created_ms > ?').get(userId, Date.now() - 60000).c;
  const daily = Number.isInteger(u.daily_call_limit) && u.daily_call_limit >= 0 ? u.daily_call_limit : 100;
  const rpm = Number.isInteger(u.rpm_limit) && u.rpm_limit >= 1 ? u.rpm_limit : 10;
  if (Number(today) >= daily) return { allowed: false, status: 429, error: '已达到今日赠送调用次数上限', daily, used: Number(today), rpm };
  if (Number(recent) >= rpm) return { allowed: false, status: 429, error: '调用过于频繁，请稍后再试', daily, used: Number(today), rpm };
  return { allowed: true, daily, used: Number(today), rpm };
}

function giftQuotaForUser(userId) {
  const db = getDb();
  const u = db.prepare('SELECT username, role, daily_call_limit, rpm_limit, provider_mode FROM users WHERE id=? AND soft_deleted_at IS NULL').get(userId);
  if (!u) return { allowed: false, unlimited: false, daily: 0, used: 0, rpm: 0 };
  const status = quotaStatus(userId);
  return { ...status, username: u.username, providerMode: u.provider_mode || 'gift' };
}

function quotaStatusForRequest(userId, entry) {
  return isGiftLearningRequest(entry) && !entry.personal ? quotaStatus(userId) : { allowed: true, unlimited: true, bypass: true };
}

// The check and reservation share a write transaction, including across workers.
function reserveGiftCall(userId, entry) {
  if (!isGiftLearningRequest(entry) || entry.personal) return quotaStatusForRequest(userId, entry);
  ensureGiftLedger();
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const quota = quotaStatus(userId);
    if (quota.allowed && !quota.unlimited) {
      quota.reservationId = randomUUID();
      db.prepare("INSERT INTO gift_calls(id,user_id,day,created_ms,state) VALUES(?,?,?,?,'pending')")
        .run(quota.reservationId, userId, localDay(), Date.now());
    }
    db.exec('COMMIT');
    return quota;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function finishGiftCall(reservationId, status) {
  if (!reservationId) return;
  ensureGiftLedger();
  getDb().prepare("UPDATE gift_calls SET state=? WHERE id=? AND state='pending'")
    .run(Number(status) >= 200 && Number(status) < 400 ? 'committed' : 'released', reservationId);
}

// Gift quota applies only to the site's M3 learning requests. Other upstream
// services and utility calls must not consume the daily allowance.
function isGiftLearningRequest(entry) {
  if (!entry || entry.provider !== 'minimax') return false;
  const kind = String(entry.kind || '');
  if (!['chat', 'chat_stream'].includes(kind)) return false;
  const model = String(entry.model || '').toLowerCase();
  return model.includes('m3');
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
    ensureGiftLedger();
    const r = getDb().prepare('DELETE FROM usage_log WHERE user_id = ?').run(userId);
    return Number(r.changes || 0);
  } catch (e) {
    logger.warn('清除用量记录失败: ' + e.message);
    return 0;
  }
}

module.exports = { recordUsage, quotaStatus, giftQuotaForUser, quotaStatusForRequest, reserveGiftCall, finishGiftCall, isGiftLearningRequest, parseChatUsage, parseStreamUsage, getUsageSummary, clearUsage, localDay };

/* ============================================================
   AI 英语对话教练 - 高考翻译题库路由（server/routes/gaokao.js）
   GET  /api/gaokao/exams             列出所有试卷（带题数）
   GET  /api/gaokao/exam/:name        单张试卷题目
   GET  /api/gaokao/question/:id      单题查询
   GET  /api/gaokao/pushed            该用户已推送到 Anki 的题号
   POST /api/gaokao/push-to-anki      推送到 Anki（直接调 AnkiConnect）
   ============================================================ */
'use strict';

const { sendJson, readBody } = require('../helpers');
const { db, parseWords } = require('../db');
const { ankiCall, parseAnkiBody } = require('../services/anki');
const { isOwnedDeck, isSaneDeckName } = require('../validation');
const logger = require('../services/logger');

function gaokaoExams(req, res) {
  try {
    const rows = db.prepare(`
      SELECT exam, exam_year, source_file,
             COUNT(*) AS q_count,
             MIN(id) AS first_id,
             MAX(id) AS last_id
      FROM gaokao_questions
      GROUP BY exam
      ORDER BY exam_year DESC, exam ASC
    `).all();
    const list = rows.map(r => ({
      exam: r.exam,
      year: r.exam_year || '',
      source_file: r.source_file || '',
      q_count: r.q_count,
      first_id: r.first_id,
      last_id: r.last_id
    }));
    sendJson(res, 200, { total: list.length, exams: list }, req);
  } catch (e) {
    sendJson(res, 500, { error: 'failed', detail: e.message }, req);
  }
}

function gaokaoExam(req, res, name) {
  try {
    const examName = decodeURIComponent(name);
    // 必须选 source_file，否则下方 rows[0].source_file 恒为空
    const rows = db.prepare('SELECT id, q_no, q_text, a_text, q_words, source_file FROM gaokao_questions WHERE exam = ? ORDER BY id ASC').all(examName);
    if (!rows.length) { sendJson(res, 404, { error: 'not found' }, req); return; }
    sendJson(res, 200, { exam: examName, source_file: rows[0].source_file || '', questions: rows.map(r => ({ id: r.id, q_no: r.q_no, q_text: r.q_text, a_text: r.a_text, q_words: parseWords(r.q_words) })) }, req);
  } catch (e) {
    sendJson(res, 500, { error: 'failed', detail: e.message }, req);
  }
}

function gaokaoQuestion(req, res, id) {
  try {
    const qid = parseInt(id);
    const row = db.prepare('SELECT id, exam, q_no, q_text, a_text, q_words, source_file, exam_year FROM gaokao_questions WHERE id = ?').get(qid);
    if (!row) { sendJson(res, 404, { error: 'not found' }, req); return; }
    sendJson(res, 200, { ...row, q_words: parseWords(row.q_words) }, req);
  } catch (e) {
    sendJson(res, 500, { error: 'failed', detail: e.message }, req);
  }
}

function gaokaoPushed(req, res) {
  try {
    const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(req.uid, 'gaokao_pushed');
    let ids = [];
    if (row) { try { ids = JSON.parse(row.value); if (!Array.isArray(ids)) ids = []; } catch (e) {} }
    sendJson(res, 200, { ids }, req);
  } catch (e) { sendJson(res, 500, { error: 'failed', detail: e.message }, req); }
}

async function gaokaoPushToAnki(req, res) {
  try {
    const body = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(body.toString('utf8')); } catch (e) {}
    // ids 严格校验：正整数、去重、批量上限 100（防止超大 IN 子句 / 巨大 notes payload）
    const rawIds = Array.isArray(payload.ids) ? payload.ids : [];
    if (rawIds.length > 100) { sendJson(res, 400, { error: 'too many ids (max 100)' }, req); return; }
    const ids = Array.from(new Set(rawIds.filter(x => Number.isSafeInteger(x) && x > 0)));
    if (!ids.length) { sendJson(res, 400, { error: 'ids required' }, req); return; }
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, q_text, a_text, q_words, exam FROM gaokao_questions WHERE id IN (${placeholders})`).all(...ids);
    if (!rows.length) { sendJson(res, 404, { error: 'no questions found' }, req); return; }
    const deckName = `英语学习::${req.username}::翻译题`;
    // 直连 AnkiConnect 路径（不走代理白名单），服务端自构牌组名后仍做双重兜底：
    // 形状异常（如编码丢失产生的 ????）或归属不符时直接中止，防止在 Anki 里建出垃圾牌组
    if (!isSaneDeckName(deckName) || !isOwnedDeck(deckName, req.username)) {
      sendJson(res, 500, { error: 'deck name rejected by server guard' }, req); return;
    }
    // 确保目标牌组存在
    try {
      const decks = await ankiCall(8765, 'deckNames', Buffer.from(JSON.stringify({ action: 'deckNames', version: 6 })));
      if (decks.ok) {
        const parsed = parseAnkiBody(decks.body);
        const list = parsed.result || [];
        if (!list.includes(deckName)) {
          await ankiCall(8765, 'createDeck', Buffer.from(JSON.stringify({ action: 'createDeck', version: 6, params: { deck: deckName } })));
        }
      }
    } catch (e) { logger.warn('确保牌组存在失败: ' + e.message); }
    // 卡片正面附上「必用词」（如有），让 Anki 复习时也能看到要求
    const notes = rows.map(r => {
      const ws = parseWords(r.q_words);
      const front = r.q_text
        + (ws.length ? '\n\n🔑 必用词: ' + ws.join(' / ') : '')
        + '\n\n📚 ' + (r.exam || '').substring(0, 30);
      return {
        deckName,
        modelName: 'Basic',
        fields: { Front: front, Back: r.a_text },
        tags: ['ai-english', 'translation', 'gaokao', `q${r.id}`]
      };
    });
    const ankiPayload = JSON.stringify({ action: 'addNotes', version: 6, params: { notes } });
    const ankiRes = await ankiCall(8765, 'addNotes', Buffer.from(ankiPayload, 'utf8'), 8000);
    if (!ankiRes.ok) { sendJson(res, 502, { error: 'anki conn failed', detail: ankiRes.err }, req); return; }
    let result;
    try { result = parseAnkiBody(ankiRes.body); } catch (e) { sendJson(res, 502, { error: 'anki bad response', detail: ankiRes.body.slice(0, 200) }, req); return; }
    // AnkiConnect 顶层 error 不应被当作成功
    if (result.error) { sendJson(res, 502, { error: 'anki error', detail: String(result.error).slice(0, 300) }, req); return; }
    const noteIds = Array.isArray(result.result) ? result.result : [];
    // 逐题结果：noteIds[i] 对应 rows[i]；null 表示该题重复/失败，不能记为已推
    const perQuestion = rows.map((r, i) => {
      const noteId = noteIds[i];
      return { id: r.id, added: Number.isInteger(noteId) ? true : false };
    });
    const added = perQuestion.filter(x => x.added).length;
    const requested = rows.length;
    // 只把真实添加成功的题记入已推状态
    const newIds = perQuestion.filter(x => x.added).map(x => x.id);
    if (newIds.length) {
      try {
        const row = db.prepare('SELECT value FROM user_data WHERE user_id=? AND key=?').get(req.uid, 'gaokao_pushed');
        let existed = [];
        if (row) { try { const p = JSON.parse(row.value); existed = Array.isArray(p) ? p : []; } catch (e) { existed = []; } }
        const merged = Array.from(new Set([...existed, ...newIds]));
        db.prepare('INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?, datetime(\'now\')) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime(\'now\')')
          .run(req.uid, 'gaokao_pushed', JSON.stringify(merged));
      } catch (e) { logger.warn('记录已推送题号失败: ' + e.message); }
    }
    sendJson(res, 200, { ok: true, requested, added, skipped: requested - added, deck: deckName, questions: perQuestion }, req);
  } catch (e) {
    sendJson(res, 500, { error: 'failed', detail: e.message }, req);
  }
}

module.exports = { gaokaoExams, gaokaoExam, gaokaoQuestion, gaokaoPushed, gaokaoPushToAnki };
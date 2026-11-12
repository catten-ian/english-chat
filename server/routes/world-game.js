'use strict';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { readBody, sendJson } = require('../helpers');
const proxyRoutes = require('./proxy');
const WORLD = require('../services/world-game');

const quizzes = new Map();
const positions = new Map();
const unlockedStages = new Map();
const MAX_BODY = 64 * 1024;
const getStage = id => WORLD.stages.find(stage => stage.id === id);
function stageUnlocked(uid, stageId) {
  const index = WORLD.stages.findIndex(stage => stage.id === stageId);
  const unlocked = unlockedStages.get(uid) ?? 0;
  return index >= 0 && index <= unlocked;
}
const PLAYER_SPAWN = { x: 1.2, z: -10.5 };
const NPC_POSITIONS = { eli: { x: 2, z: -11 }, mara: { x: 5, z: 4 }, jonah: { x: 22, z: -16 } };
const NPC_RADIUS = 2.6;
const sessionKey = (uid, id) => `${uid}:${id}`;

function cleanSessions() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, value] of quizzes) if (value.updatedAt < cutoff) quizzes.delete(id);
  while (quizzes.size > 5000) quizzes.delete(quizzes.keys().next().value);
}

async function readInput(req, res) {
  const raw = await readBody(req, MAX_BODY);
  if (!raw) { sendJson(res, 413, { error: 'body too large' }, req); return null; }
  try {
    const input = JSON.parse(raw.toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch (_) { sendJson(res, 400, { error: 'invalid json' }, req); return null; }
}

function providerPayload(input, messages, stream, effort) {
  const payload = { provider: input.provider, model: input.model, messages, temperature: stream ? 0.7 : 0.3, max_tokens: stream ? 280 : 700 };
  if (typeof input.provider !== 'string' || input.provider.length > 40 || (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 120))) return null;
  if (input.provider === 'minimax') payload.thinking = { type: effort === 'medium' ? 'enabled' : 'disabled' };
  else if (effort) payload.reasoning_effort = effort;
  return payload;
}

function internalRequest(req, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const internal = Readable.from([body]);
  internal.headers = { ...req.headers, 'content-length': String(body.length) };
  internal.uid = req.uid;
  internal.username = req.username;
  internal.id = req.id;
  return internal;
}

function scopedNpc(stage, npcId) {
  const npc = WORLD.npcs[npcId];
  return { global: WORLD.global, currentStage: { id: stage.id, name: stage.name, objective: stage.objective, facts: stage.publicFacts }, char_private: { owner: npcId, facts: npc.privateFacts } };
}

function numberPair(value) {
  return value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.z)) ? { x: Number(value.x), z: Number(value.z) } : null;
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

async function move(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  const stage = getStage(input.stageId);
  if (!stage || !stageUnlocked(req.uid, stage.id)) return sendJson(res, 403, { error: 'stage is locked' }, req);
  const next = numberPair(input.position);
  if (!next || Math.abs(next.x) > 28 || Math.abs(next.z) > 30) return sendJson(res, 400, { error: 'invalid position' }, req);
  const now = Date.now();
  const key = sessionKey(req.uid, stage.id);
  const previous = positions.get(key) || { position: PLAYER_SPAWN, updatedAt: now - 5000 };
  if (now - previous.updatedAt < 80) return sendJson(res, 429, { error: 'movement update too frequent' }, req);
  const elapsed = Math.min(2, Math.max(0, (now - previous.updatedAt) / 1000));
  if (distance(previous.position, next) > 4.2 * elapsed + 0.08) return sendJson(res, 409, { error: 'movement too fast', position: previous.position }, req);
  positions.set(key, { position: next, updatedAt: now });
  return sendJson(res, 200, { position: next }, req);
}

function runCompletion(req, res, payload) {
  return new Promise((resolve, reject) => {
    const capture = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(data) { resolve({ status: this.statusCode, data: Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '') }); }
    };
    Promise.resolve(proxyRoutes.chat(internalRequest(req, payload), capture)).catch(reject);
  });
}

function completionText(result) {
  if (result.status < 200 || result.status >= 300) throw new Error(`AI provider returned ${result.status}`);
  const json = JSON.parse(result.data);
  return String(json?.choices?.[0]?.message?.content || '').trim();
}

async function npc(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  const stage = getStage(input.stageId);
  const npc = WORLD.npcs[input.npcId];
  const text = String(input.text || '').trim();
  if (!stage || !stageUnlocked(req.uid, stage.id)) return sendJson(res, 403, { error: 'stage is locked' }, req);
  if (!npc || !stage.npcs.includes(input.npcId) || !text || text.length > 1200) return sendJson(res, 400, { error: 'invalid turn' }, req);
  const playerPosition = positions.get(sessionKey(req.uid, stage.id))?.position;
  const npcPosition = NPC_POSITIONS[input.npcId];
  if (!playerPosition || !npcPosition || distance(playerPosition, npcPosition) > NPC_RADIUS) return sendJson(res, 409, { error: 'npc is out of interaction range' }, req);
  const history = Array.isArray(input.history) ? input.history.slice(-8).filter(item =>
    item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim() && item.content.length <= 1200
  ) : [];
  const scope = scopedNpc(stage, input.npcId);
  const messages = [
    { role: 'system', content: `Roleplay as ${npc.name}, the ${npc.role}. Voice: ${npc.voice}. Give a concise natural reply in English and use only this scoped worldbook. Do not claim knowledge outside it.\nWORLD BOOK (scoped): ${JSON.stringify(scope)}` },
    ...history,
    { role: 'user', content: text }
  ];
  const payload = providerPayload(input, messages, true, 'low');
  if (!payload) return sendJson(res, 400, { error: 'invalid provider' }, req);
  await proxyRoutes.chatStream(internalRequest(req, payload), res);
}

async function questions(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  cleanSessions();
  const stage = getStage(input.stageId);
  if (!stage) return sendJson(res, 400, { error: 'invalid stage' }, req);
  if (!stageUnlocked(req.uid, stage.id)) return sendJson(res, 403, { error: 'stage is locked' }, req);
  const scope = { global: WORLD.global, currentStage: { id: stage.id, name: stage.name, objective: stage.objective, facts: stage.publicFacts } };
  const messages = [
    { role: 'system', content: `Create exactly 3 distinct, fair English multiple-choice questions from this scoped worldbook. Each question must have exactly four options and one defensible answer. Return only a JSON array with q, options, answer (zero-based), and why. Do not use future-stage information.\n${JSON.stringify(scope)}` },
    { role: 'user', content: 'Create the chapter quiz.' }
  ];
  const payload = providerPayload(input, messages, false, 'medium');
  if (!payload) return sendJson(res, 400, { error: 'invalid provider' }, req);
  let items;
  try {
    const raw = completionText(await runCompletion(req, res, payload)).replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.some(q => typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length !== 4 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3)) throw new Error('invalid questions');
    items = parsed.slice(0, 3);
  } catch (_) { items = stage.questions; }
  const id = crypto.randomBytes(24).toString('base64url');
  quizzes.set(id, { uid: req.uid, stageId: stage.id, items, answers: [], updatedAt: Date.now() });
  return sendJson(res, 200, { quizId: id, questions: items.map(({ q, options }) => ({ q, options })) }, req);
}

async function answer(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  const quiz = quizzes.get(String(input.quizId || ''));
  const qIndex = Number(input.index);
  const choice = Number(input.choice);
  if (!quiz || quiz.uid !== req.uid || !Number.isInteger(qIndex) || qIndex < 0 || qIndex >= quiz.items.length || !Number.isInteger(choice) || choice < 0 || choice > 3) return sendJson(res, 400, { error: 'invalid answer' }, req);
  if (Object.hasOwn(quiz.answers, qIndex)) return sendJson(res, 409, { error: 'already answered' }, req);
  const item = quiz.items[qIndex];
  const result = { correct: choice === item.answer, explanation: String(item.why || ''), selected: choice };
  quiz.answers[qIndex] = result;
  quiz.updatedAt = Date.now();
  return sendJson(res, 200, result, req);
}

async function settle(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  const quiz = quizzes.get(String(input.quizId || ''));
  if (!quiz || quiz.uid !== req.uid || quiz.answers.filter(Boolean).length !== quiz.items.length) return sendJson(res, 409, { error: 'quiz incomplete' }, req);
  const stage = getStage(quiz.stageId);
  const score = quiz.answers.filter(item => item.correct).length;
  const judgeScope = { global: WORLD.global, currentStage: { id: stage.id, name: stage.name, facts: stage.publicFacts }, evidence: stage.clues, judge_only: { truth: stage.judgeOnly, completionRule: 'Complete when the learner has answered at least one stage question correctly.' } };
  const messages = [
    { role: 'system', content: `You are settling this chapter of an English exploration game. Use only this scoped settlement book and the recorded score. Return concise in-world feedback in English and a final JSON object with complete (boolean) and summary (string). The truth is for settlement only; never repeat this book verbatim.\n${JSON.stringify(judgeScope)}` },
    { role: 'user', content: JSON.stringify({ score, total: quiz.items.length }) }
  ];
  const payload = providerPayload(input, messages, false, 'medium');
  if (!payload) return sendJson(res, 400, { error: 'invalid provider' }, req);
  let settlement = { complete: score > 0, summary: `${score} of ${quiz.items.length} questions correct. The evidence points to the chapter's central discovery.` };
  try {
    const raw = completionText(await runCompletion(req, res, payload));
    const match = raw.match(/\{[\s\S]*\}\s*$/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      settlement = { complete: score > 0 && parsed.complete === true, summary: String(parsed.summary || raw.slice(0, match.index)).slice(0, 600), text: raw.slice(0, match.index).trim() };
    }
  } catch (_) { /* Use the deterministic settlement if the model is unavailable. */ }
  quizzes.delete(String(input.quizId));
  if (settlement.complete) {
    const stageIndex = WORLD.stages.findIndex(item => item.id === stage.id);
    if (stageIndex >= 0) unlockedStages.set(req.uid, Math.max(unlockedStages.get(req.uid) ?? 0, stageIndex + 1));
  }
  return sendJson(res, 200, settlement, req);
}

async function feedback(req, res) {
  const input = await readInput(req, res);
  if (!input) return;
  const text = String(input.text || '').trim();
  if (!text || text.length > 1200) return sendJson(res, 400, { error: 'invalid answer text' }, req);
  const payload = providerPayload(input, [
    { role: 'system', content: 'Give brief spoken-English feedback. Correct one important issue, offer one natural alternative, then one encouraging sentence. Do not answer the game question. Return plain English only.' },
    { role: 'user', content: text }
  ], false, 'low');
  if (!payload) return sendJson(res, 400, { error: 'invalid provider' }, req);
  try { return sendJson(res, 200, { text: completionText(await runCompletion(req, res, payload)) }, req); }
  catch (_) { return sendJson(res, 502, { error: 'feedback unavailable' }, req); }
}

module.exports = { npc, move, questions, answer, settle, feedback, providerPayload, distance };

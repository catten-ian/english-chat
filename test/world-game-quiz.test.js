'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const quizBook = require('../server/services/world-game-quiz');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellweather-quiz-'));
process.env.AI_EN_DATA_DIR = dataDir;
process.env.AI_EN_GAME_WORKER = '0';
const proxyPath = require.resolve('../server/routes/proxy');
const oldProxy = require.cache[proxyPath];
let responseHandler;
const captured = [];
require.cache[proxyPath] = { id: proxyPath, filename: proxyPath, loaded: true, exports: {
  async chat(req, res) {
    let body = '';
    for await (const chunk of req) body += chunk.toString('utf8');
    const input = JSON.parse(body); captured.push(input);
    await responseHandler(req, res, input);
  },
  async chatStream() { throw new Error('not used'); }
} };
const routes = require('../server/routes/world-game');
const store = require('../server/services/world-game-store').getDefaultStore();
const { db } = require('../server/db');
const uid = Number(db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run('quiz-fixture-user', 'fixture').lastInsertRowid);
function ready() {
  store.ensureJourney(uid);
  for (const npc of ['eli', 'mara']) {
    const id = `interview-${npc}`;
    const turn = store.beginTurn(uid, 'low-tide', npc, 'What did you observe?', id, { provider: 'fixture' });
    store.finishTurn(uid, turn.id, npc === 'eli' ? 'The lens is intact; the oil reservoir is full.' : 'I found a wet fuse and tide mark by the lower switch box.');
  }
}
class Response extends EventEmitter {
  constructor() { super(); this.statusCode = 200; this.body = ''; this.writableFinished = false; }
  writeHead(status) { this.statusCode = status; return this; }
  end(data) { this.body = String(data ?? ''); this.writableFinished = true; this.emit('close'); }
}
async function call(name, input) {
  const req = new PassThrough(); req.headers = {}; req.uid = uid; req.username = 'quiz-fixture-user'; req.id = 'quiz-test';
  const res = new Response();
  const running = routes[name](req, res); req.end(JSON.stringify(input)); await running;
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
const settings = { provider: 'fixture' };
const scope = { stageId: 'low-tide', ...settings };
const catalog = quizBook.catalog('low-tide');
const identity = () => catalog.map(item => ({ id: item.id, wordingId: 'w1', optionOrder: item.options.map(option => option.id) }));
function reply(res, content, status = 200) {
  res.writeHead(status); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}
after(() => {
  routes.stopWorker(); db.close();
  if (oldProxy) require.cache[proxyPath] = oldProxy; else delete require.cache[proxyPath];
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('blueprint recipe yields server-derived grading; arbitrary model text and answer keys are rejected', () => {
  for (const stage of ['low-tide', 'storm-line', 'beacon']) {
    const book = quizBook.catalog(stage);
    assert.equal(book.length, 3);
    assert.doesNotMatch(JSON.stringify(book), /correctId|answer|why|judgeOnly/);
    const recipe = book.map(item => ({ id: item.id, wordingId: 'w2', optionOrder: [...item.options.map(o => o.id)].reverse() }));
    const assembled = quizBook.assemble(stage, recipe, 'ai_assembled', 1);
    assert.ok(quizBook.valid({ stage_id: stage, ...assembled }));
    assert.equal(assembled.items[0].answer, 2, 'original second option becomes third after reversal');
    assert.equal(quizBook.valid({ stage_id: stage, items: [{ ...assembled.items[0], answer: 0 }, ...assembled.items.slice(1)], metadata: assembled.metadata }), false);
    assert.equal(quizBook.valid({ stage_id: stage, items: assembled.items, metadata: { ...assembled.metadata, revision: 'forged' } }), false);
    assert.throws(() => quizBook.assemble(stage, recipe.map((item, i) => i === 1 ? { ...item, optionOrder: ['o1', 'o1', 'o3', 'o4'] } : item), 'ai_assembled', 1));
    assert.throws(() => quizBook.assemble(stage, recipe.map((item, i) => i === 1 ? { ...item, id: recipe[0].id } : item), 'ai_assembled', 1));
    assert.throws(() => quizBook.assemble(stage, recipe.map((item, i) => i === 1 ? { ...item, q: 'model invention' } : item), 'ai_assembled', 1));
    assert.throws(() => quizBook.assemble(stage, recipe.map((item, i) => i === 1 ? { ...item, wordingId: 'unknown' } : item), 'ai_assembled', 1));
  }
});

test('AI assembly prompt is a public projection and persisted grading ignores model-authored answer claims', async () => {
  ready(); captured.length = 0;
  responseHandler = async (_req, res) => reply(res, JSON.stringify(identity().map(item => ({ ...item, wordingId: 'w2', optionOrder: [...item.optionOrder].reverse() }))));
  const generated = await call('questions', scope);
  assert.equal(generated.status, 200);
  assert.equal(generated.body.source, 'ai_assembled');
  assert.equal(generated.body.questions[0].q, 'What best explains the harbor lanterns going dark?');
  assert.equal(generated.body.questions[0].options[2], 'Saltwater reached the lower switch box');
  assert.equal((await call('answer', { quizId: generated.body.quizId, index: 0, choice: 2 })).body.correct, true);
  const prompt = JSON.stringify(captured[0].messages);
  assert.doesNotMatch(prompt, /judgeOnly|correctId|"answer"|"why"|dry ceramic fuse|Jonah knows the north channel/i);
  assert.match(prompt, /wet fuse/);
  assert.equal(store.currentQuiz(uid, 'low-tide').metadata.source, 'ai_assembled');
  assert.equal((await call('questions', scope)).body.quizId, generated.body.quizId, 'resume without provider call');
  assert.equal(captured.length, 1);
});

test('malformed selections retry once and fallback is labeled; legacy IDs cannot answer or settle', async () => {
  const existing = store.currentQuiz(uid, 'low-tide'); store.invalidateQuiz(uid, existing.id);
  captured.length = 0;
  responseHandler = async (_req, res) => reply(res, JSON.stringify([{ q: 'Invented question', options: ['a', 'b', 'c', 'd'], answer: 0, why: 'Invented explanation' }]));
  const generated = await call('questions', scope);
  assert.equal(generated.status, 200); assert.equal(generated.body.source, 'authored_fallback');
  assert.equal(captured.length, 2);
  for (const payload of captured) assert.doesNotMatch(JSON.stringify(payload.messages), /judgeOnly|correctId|"answer"|"why"/);
  const legacy = store.createQuiz(uid, 'low-tide', []);
  assert.equal(legacy.id, generated.body.quizId, 'get-or-create returns existing valid quiz');
  const oldId = 'legacy-quiz-id';
  const oldItem = { q: 'Forged?', options: ['A', 'B', 'C', 'D'], answer: 0, why: 'Forged.' };
  db.prepare('INSERT INTO world_game_quizzes(id,user_id,stage_id,items,answers,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(oldId, uid, 'low-tide', JSON.stringify([oldItem]), '[]', Date.now() + 1, Date.now() + 1);
  assert.equal((await call('answer', { quizId: oldId, index: 0, choice: 0 })).body.error, 'quiz_refreshed');
  assert.equal((await call('settle', { quizId: oldId, ...settings })).body.error, 'quiz_refreshed');
  assert.equal(db.prepare('SELECT invalidated FROM world_game_quizzes WHERE id=?').get(oldId).invalidated, 1);
  assert.equal(store.currentQuiz(uid, 'low-tide').id, generated.body.quizId);
});

test('a durable lease bounds duplicate generation and a chapter switch cannot save stale output', async () => {
  store.invalidateQuiz(uid, store.currentQuiz(uid, 'low-tide').id);
  let unblock;
  responseHandler = async (_req, res) => { await new Promise(resolve => { unblock = resolve; }); reply(res, JSON.stringify(identity())); };
  const pending = call('questions', scope);
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await call('questions', scope)).status, 429);
  db.prepare('UPDATE world_game_journeys SET stage_id=? WHERE user_id=?').run('storm-line', uid);
  unblock();
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal(store.currentQuiz(uid, 'low-tide'), null);
  db.prepare('UPDATE world_game_journeys SET stage_id=? WHERE user_id=?').run('low-tide', uid);
});

test('provider errors do not trigger a repair call and stored answer/text tampering is rejected', async () => {
  captured.length = 0;
  responseHandler = async (_req, res) => reply(res, '{}', 503);
  const generated = await call('questions', scope);
  assert.equal(generated.body.source, 'authored_fallback');
  assert.equal(captured.length, 1);
  const row = store.getQuiz(uid, generated.body.quizId);
  row.items[0].answer = 0;
  db.prepare('UPDATE world_game_quizzes SET items=? WHERE id=?').run(JSON.stringify(row.items), row.id);
  assert.equal((await call('answer', { quizId: row.id, index: 0, choice: 0 })).body.error, 'quiz_refreshed');
  assert.equal(store.state(uid).quiz, undefined);
  assert.equal(store.state(uid).evidence.length, 2);
});

test('closing the client aborts upstream selection work and cannot save a late reply', async () => {
  let abortObserved = false, entered;
  responseHandler = async (req, res) => {
    entered = true;
    await new Promise(resolve => req.signal.addEventListener('abort', () => { abortObserved = true; resolve(); }, { once: true }));
    reply(res, JSON.stringify(identity()));
  };
  const req = new PassThrough(); req.uid = uid; req.headers = {}; req.id = 'disconnect-test';
  const res = new Response();
  const pending = routes.questions(req, res); req.end(JSON.stringify(scope));
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  res.emit('close'); await pending;
  assert.equal(abortObserved, true);
  assert.equal(store.currentQuiz(uid, 'low-tide'), null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM world_game_quiz_leases').get().n, 0);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createWorldGameStore, LEASE_MS, RETRY_DELAYS } = require('../server/services/world-game-store');
const { createFeedbackWorker } = require('../server/services/world-game-worker');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bellweather-durable-'));
  const file = path.join(dir, 'game.db');
  let db, store;
  const open = () => {
    db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO users VALUES(1),(2);');
    store = createWorldGameStore(db);
  };
  open();
  return {
    get db() { return db; }, get store() { return store; },
    reopen() { db.close(); open(); },
    close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}
const settings = { provider: 'fixture-provider', model: 'fixture-model' };
const question = { q: 'Which circuit failed?', options: ['A', 'B', 'C', 'D'], answer: 1, why: 'The investigation identified B.' };
function successfulTurn(store, user, npc, text, clientId, stage = 'low-tide') {
  store.ensureJourney(user);
  const turn = store.beginTurn(user, stage, npc, text, clientId, settings);
  assert.ok(turn.id);
  store.finishTurn(user, turn.id, `${npc} reply to ${text}`);
  return turn;
}

test('journey, authoritative positions, complete NPC turns, evidence, quizzes and settlements survive reopening SQLite', () => {
  const f = fixture();
  try {
    successfulTurn(f.store, 1, 'eli', 'How is the lens?', 'durable-eli');
    successfulTurn(f.store, 1, 'mara', 'What did the water reach?', 'durable-mara');
    f.store.move(1, 'low-tide', { x: 5, z: 4 });
    const blueprint = require('../server/services/world-game-quiz').authored('low-tide');
    const quiz = f.store.createQuiz(1, 'low-tide', blueprint.items, blueprint.metadata);
    f.store.answer(1, quiz.id, 0, 1);
    const before = f.store.state(1);
    f.reopen();
    assert.deepEqual(f.store.state(1), before);
    assert.equal(f.store.state(1).quiz.source, 'authored_fallback');
    assert.equal(f.store.state(1).quiz.answers[0].correct, true);
    assert.equal(f.store.history(1, 'low-tide', 'eli')[0].content, 'How is the lens?');
    f.store.settle(1, quiz.id, { complete: true, summary: 'The lantern circuit was restored.', score: 1, total: 1 }, settings);
    assert.equal(f.store.changeStage(1, 'storm-line'), true);
    f.reopen();
    const resumed = f.store.state(1);
    assert.equal(resumed.stageId, 'storm-line');
    assert.deepEqual(resumed.unlockedStageIds, ['low-tide', 'storm-line']);
    assert.deepEqual(resumed.completedStageIds, ['low-tide']);
    assert.equal(resumed.settlements[0].summary, 'The lantern circuit was restored.');
    assert.equal(resumed.feedback.summaries[0].totalReplies, 2);
    assert.equal(f.store.changeStage(1, 'low-tide'), true);
    assert.deepEqual(f.store.state(1).position, { x: 5, z: 4 });
    assert.equal(f.store.changeStage(2, 'storm-line'), false);
    assert.deepEqual(f.store.state(2).feedback, { records: [], summaries: [] });
    assert.equal(f.store.state(2).evidence.length, 0);
    assert.equal(f.store.getQuiz(2, quiz.id), null);
  } finally { f.close(); }
});

test('client turn identifiers deduplicate learner feedback and concurrent NPC turns use persisted leases', () => {
  const f = fixture();
  try {
    f.store.ensureJourney(1);
    const first = f.store.beginTurn(1, 'low-tide', 'eli', 'Hello.', 'turn-identifier-1', settings);
    assert.equal(f.store.beginTurn(1, 'low-tide', 'eli', 'Forged replacement', 'turn-identifier-1', settings).duplicate, true);
    assert.equal(f.store.beginTurn(1, 'low-tide', 'eli', 'Overlap', 'turn-identifier-2', settings).locked, true);
    f.reopen();
    assert.equal(f.store.beginTurn(1, 'low-tide', 'eli', 'Overlap after reconnect', 'turn-identifier-3', settings).locked, true);
    f.store.finishTurn(1, first.id, 'Hello there.');
    const second = f.store.beginTurn(1, 'low-tide', 'eli', 'Again?', 'turn-identifier-2', settings);
    assert.ok(second.id);
    f.store.finishTurn(1, second.id, 'Yes.');
    const records = f.store.feedbackSnapshot(1).records;
    assert.equal(records.length, 2);
    assert.equal(records[0].text, 'Hello.');
    assert.equal(f.store.retry(2, records[0].id), false);
  } finally { f.close(); }
});

test('player stage books include facts only for the mounted chapter, including after a restart or revisit', () => {
  const f = fixture();
  try {
    const initial = f.store.state(1);
    assert.ok(initial.stages[0].publicFacts.length);
    for (const stage of initial.stages.slice(1)) {
      assert.equal(stage.objective, '');
      assert.deepEqual(stage.publicFacts, []);
      assert.deepEqual(stage.npcs, []);
    }
    const quiz = f.store.createQuiz(1, 'low-tide', [question]);
    f.store.settle(1, quiz.id, { complete: true, summary: 'Chapter one complete.', score: 1, total: 1 }, settings);
    assert.equal(f.store.changeStage(1, 'storm-line'), true);
    f.reopen();
    const mounted = f.store.state(1);
    assert.ok(mounted.stages[1].publicFacts.some(text => /tide chart/.test(text)));
    assert.deepEqual(mounted.stages[0].publicFacts, []);
    assert.deepEqual(mounted.stages[2].publicFacts, []);
    assert.equal(f.store.changeStage(1, 'low-tide'), true);
    assert.deepEqual(f.store.state(1).stages[1].publicFacts, []);
  } finally { f.close(); }
});

test('missing chapter report sources fail visibly instead of waiting forever', () => {
  const f = fixture();
  try {
    const source = f.store.enqueueFeedback(1, 'low-tide', 'eli', 'I was there.', 'missing-source', settings);
    const quiz = f.store.createQuiz(1, 'low-tide', [question]);
    f.store.settle(1, quiz.id, { complete: true, summary: 'Complete.', score: 1, total: 1 }, settings);
    f.db.prepare('DELETE FROM world_game_jobs WHERE id=?').run(source.id);
    assert.equal(f.store.claimJob('worker').waiting, true);
    assert.equal(f.store.claimJob('worker').waiting, true);
    const report = f.store.feedbackSnapshot(1).summaries[0];
    assert.equal(report.status, 'failed');
    assert.equal(report.pendingCount, 0);
    assert.match(report.error, /section failed/);
    assert.match(f.db.prepare("SELECT error FROM world_game_jobs WHERE kind='summary_chunk'").get().error, /source.*missing/);
  } finally { f.close(); }
});

test('server feedback retries six times with durable exponential backoff, then requires explicit account-owned recovery', async () => {
  const f = fixture();
  const actualNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  let calls = 0;
  let worker;
  try {
    f.store.enqueueFeedback(1, 'low-tide', 'eli', 'I seen the lamp.', 'retry-source', settings);
    worker = createFeedbackWorker({ store: f.store, complete: async () => { calls++; const error = new Error('Transient provider error'); error.status = 503; throw error; } });
    for (let attempt = 1; attempt <= 6; attempt++) {
      assert.equal(await worker.tick(), true);
      const record = f.store.feedbackSnapshot(1).records[0];
      assert.equal(record.attempts, attempt);
      assert.equal(record.status, attempt === 6 ? 'failed' : 'retry');
      if (attempt < 6) {
        assert.equal(record.nextAttemptAt, now + RETRY_DELAYS[attempt - 1]);
        assert.equal(await worker.tick(), false);
        worker.stop(); f.reopen();
        worker = createFeedbackWorker({ store: f.store, complete: async () => { calls++; const error = new Error('Transient provider error'); error.status = 503; throw error; } });
        now += RETRY_DELAYS[attempt - 1];
      }
    }
    assert.equal(calls, 6);
    now += 1000000;
    assert.equal(await worker.tick(), false);
    const id = f.store.feedbackSnapshot(1).records[0].id;
    assert.equal(f.store.retry(2, id), false);
    assert.equal(f.store.retry(1, id), true);
    worker.stop();
    worker = createFeedbackWorker({ store: f.store, complete: async () => 'Use “I saw the lamp.” Your meaning was clear.' });
    await worker.tick();
    assert.equal(f.store.feedbackSnapshot(1).records[0].status, 'ready');
    assert.equal(f.store.feedbackSnapshot(1).records[0].attempts, 1);
  } finally { worker?.stop(); Date.now = actualNow; f.close(); }
});

test('rejected provider credentials are not retried automatically, and interrupted leases recover without resetting attempts', async () => {
  const f = fixture();
  const actualNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  let worker;
  try {
    const authJob = f.store.enqueueFeedback(1, 'low-tide', 'eli', 'Hello!', 'auth-source', settings);
    worker = createFeedbackWorker({ store: f.store, complete: async () => { const error = new Error('Update credentials'); error.status = 401; throw error; } });
    await worker.tick();
    assert.equal(f.store.feedbackSnapshot(1).records.find(row => row.id === authJob.id).status, 'failed');
    assert.equal(await worker.tick(), false);
    worker.stop();
    const interrupted = f.store.enqueueFeedback(1, 'low-tide', 'mara', 'What have happened?', 'crashed-source', settings);
    const claimed = f.store.claimJob('dead-process');
    assert.equal(claimed.id, interrupted.id);
    assert.equal(claimed.attempts, 1);
    f.reopen();
    now += LEASE_MS + 1;
    worker = createFeedbackWorker({ store: f.store, complete: async () => 'Try “What happened?”' });
    await worker.tick();
    const recovered = f.store.feedbackSnapshot(1).records.find(row => row.id === interrupted.id);
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.attempts, 2);
  } finally { worker?.stop(); Date.now = actualNow; f.close(); }
});

test('chapter report covers all 25 replies through persisted sections without exposing worldbooks or truth', async () => {
  const f = fixture();
  let worker;
  try {
    f.store.ensureJourney(1);
    for (let index = 0; index < 25; index++) f.store.enqueueFeedback(1, 'low-tide', 'eli', `Learner reply ${index}.`, `summary-source-${index}`, settings);
    const quiz = f.store.createQuiz(1, 'low-tide', [question]);
    f.store.answer(1, quiz.id, 0, 1);
    f.store.settle(1, quiz.id, { complete: true, summary: 'Private game verdict', score: 1, total: 1 }, settings);
    const seenReplies = [], seenSections = [];
    worker = createFeedbackWorker({ store: f.store, complete: async (job, messages) => {
      assert.doesNotMatch(JSON.stringify(messages), /Private game verdict|judge_only|char_private|storm surge|Saltwater/);
      const input = JSON.parse(messages[1].content);
      if (job.kind === 'feedback') return 'A natural alternative.';
      if (job.kind === 'summary_chunk') {
        seenReplies.push(...input.replies.map(reply => reply.text));
        return `Section covering ${input.replies.length} replies.`;
      }
      seenSections.push(...input.sections);
      assert.equal(input.totalReplies, 25);
      return 'Reviewed all 25 replies. Here are your strengths and practice priorities.';
    } });
    for (let index = 0; index < 26; index++) await worker.tick();
    // Restart after feedback + first section: remaining sections and report resume.
    worker.stop(); f.reopen();
    worker = createFeedbackWorker({ store: f.store, complete: async (job, messages) => {
      const input = JSON.parse(messages[1].content);
      if (job.kind === 'summary_chunk') { seenReplies.push(...input.replies.map(reply => reply.text)); return `Section covering ${input.replies.length} replies.`; }
      seenSections.push(...input.sections);
      assert.equal(input.totalReplies, 25);
      return 'Reviewed all 25 replies. Here are your strengths and practice priorities.';
    } });
    for (let index = 0; index < 4; index++) await worker.tick();
    assert.equal(seenReplies.length, 25);
    assert.equal(new Set(seenReplies).size, 25);
    assert.equal(seenSections.length, 3);
    const report = f.store.feedbackSnapshot(1).summaries[0];
    assert.equal(report.status, 'ready');
    assert.equal(report.totalReplies, 25);
    assert.equal(report.pendingCount, 0);
    assert.match(report.text, /all 25/);
    assert.equal(f.store.feedbackSnapshot(2).summaries.length, 0);
  } finally { worker?.stop(); f.close(); }
});

test('failed report sections are visible and manual chapter retry recovers every failed section', async () => {
  const f = fixture();
  let worker;
  try {
    f.store.ensureJourney(1);
    f.store.enqueueFeedback(1, 'low-tide', 'eli', 'I am ready.', 'section-failure-source', settings);
    const quiz = f.store.createQuiz(1, 'low-tide', [question]);
    f.store.answer(1, quiz.id, 0, 1);
    f.store.settle(1, quiz.id, { complete: true, summary: 'Done', score: 1, total: 1 }, settings);
    worker = createFeedbackWorker({ store: f.store, complete: async job => {
      if (job.kind === 'summary_chunk') { const error = new Error('Bad provider credentials'); error.status = 401; throw error; }
      return 'Ready.';
    } });
    await worker.tick(); await worker.tick(); await worker.tick();
    let report = f.store.feedbackSnapshot(1).summaries[0];
    assert.equal(report.status, 'failed');
    assert.match(report.error, /section failed/);
    assert.equal(f.store.retry(1, report.id), true);
    worker.stop();
    worker = createFeedbackWorker({ store: f.store, complete: async () => 'Recovered complete report.' });
    await worker.tick(); await worker.tick();
    report = f.store.feedbackSnapshot(1).summaries[0];
    assert.equal(report.status, 'ready');
    assert.match(report.text, /Recovered/);
  } finally { worker?.stop(); f.close(); }
});

test('SQLite claims and ownership checks prevent two workers completing the same job', () => {
  const f = fixture();
  try {
    const queued = f.store.enqueueFeedback(1, 'low-tide', 'eli', 'Hello there.', 'claim-source', settings);
    const first = f.store.claimJob('worker-a');
    assert.equal(first.id, queued.id);
    assert.equal(f.store.claimJob('worker-b'), null);
    assert.equal(f.store.completeJob(first.id, 'worker-b', 'Forged completion'), false);
    assert.equal(f.store.completeJob(first.id, 'worker-a', 'Correct completion'), true);
    f.reopen();
    assert.equal(f.store.claimJob('worker-c'), null);
    assert.equal(f.store.feedbackSnapshot(1).records[0].feedback, 'Correct completion');
    f.db.prepare('DELETE FROM users WHERE id=1').run();
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM world_game_jobs').get().n, 0);
  } finally { f.close(); }
});

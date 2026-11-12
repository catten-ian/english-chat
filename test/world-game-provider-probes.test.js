'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-probe-fixtures-'));
process.env.AI_EN_DATA_DIR = dir;
process.env.AI_EN_GAME_WORKER = '0';
process.env.AI_EN_PROVIDER_HOSTS = 'probe.example.test,second.example.test';
const { createProviderProbes, isCustomBase, fingerprint, sendProbe, DAY, LEASE, ACTIVE } = require('../server/services/world-game-provider-probes');
const { validateBase } = require('../server/services/provider-credentials');
after(() => { require('../server/db').db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(options = {}) {
  const file = path.join(dir, 'probes-' + crypto.randomUUID() + '.db');
  const calls = [];
  let clock = 1000000, db, manager;
  let provider = { id: 'openai', base: 'https://probe.example.test/v1', key: 'FIXTURE_SECRET_KEY', configured: true, defaultModel: 'small-model' };
  const send = options.send || (async input => {
    calls.push(input);
    const expected = /CHECK_[a-f0-9]+/.exec(input.payload.messages[0].content)[0];
    return { status: 200, text: input.payload.stream ? expected : input.payload.messages[0].content.includes('Return JSON')
      ? JSON.stringify({ known: expected, unprovided: 'UNKNOWN' }) : expected, sse: true, complete: true };
  });
  function open() {
    db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO users VALUES(1),(2);');
    manager = createProviderProbes({ db, resolve: (id, uid) => ({ ...provider, id }), validate: validateBase,
      send, record: options.record, now: () => clock, random: options.random || (() => .9) });
  }
  open();
  return { calls, get db() { return db; }, get manager() { return manager; },
    get clock() { return clock; }, set clock(value) { clock = value; }, set provider(value) { provider = value; },
    due() { clock = Number(db.prepare("SELECT MAX(next_at) AS time FROM world_game_probe_jobs WHERE status IN ('pending','retry')").get().time || clock); },
    reopen() { manager.stop(); db.close(); open(); }, close() { manager.stop(); db.close(); } };
}
const crypto = require('node:crypto');
const settings = { provider: 'openai', model: 'small-model' };

test('custom URL detection is based on actual normalized URL, with existing endpoint allowlist enforced', () => {
  assert.equal(isCustomBase('https://api.openai.com/v1/'), false);
  assert.equal(isCustomBase('HTTPS://API.OPENAI.COM:443/v1/'), false);
  assert.equal(isCustomBase('https://openrouter.ai/api/v1/'), false);
  assert.equal(isCustomBase('https://dashscope.aliyuncs.com/compatible-mode/v1'), false);
  assert.equal(isCustomBase('https://probe.example.test/v1'), true);
  assert.equal(isCustomBase('https://api.openai.com.attacker.invalid'), true);
  assert.equal(fingerprint('https://probe.example.test/v1/'), fingerprint('https://probe.example.test'));
  assert.equal(fingerprint('HTTPS://PROBE.EXAMPLE.TEST:443/v1/'), fingerprint('https://probe.example.test'));
  const f = fixture();
  try {
    for (const base of ['http://127.0.0.1:1234', 'https://169.254.169.254', 'https://not-allowed.example', 'https://user:pass@probe.example.test', 'https://probe.example.test/?key=secret']) {
      f.provider = { id: 'openai', configured: true, base, key: 'secret' };
      assert.equal(f.manager.schedule(1, settings), false, base);
    }
    f.provider = { id: 'custom', configured: true, base: 'https://api.openai.com', key: 'secret' };
    assert.equal(f.manager.schedule(1, { provider: 'custom' }), false);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM world_game_probe_batches').get().n, 0);
  } finally { f.close(); }
});

test('two or three synthetic checks persist with random delay, account isolation and no game or credential data', async () => {
  const f = fixture({ random: () => .1 });
  try {
    assert.equal(f.manager.schedule(1, { ...settings, text: 'PLAYER_SECRET', judgeOnly: 'JUDGE_SECRET', stageId: 'WORLD_SECRET' }), true);
    assert.equal(f.manager.schedule(1, settings), false);
    assert.equal(f.manager.schedule(1, { provider: 'custom' }), false); // Alias cannot reset the URL budget.
    const before = f.manager.snapshot(1);
    assert.equal(before[0].checks.length, 3);
    assert.deepEqual(f.manager.snapshot(2), []);
    const first = f.db.prepare('SELECT MIN(next_at) AS time FROM world_game_probe_jobs').get().time;
    assert.ok(first >= f.clock + 20000 && first <= f.clock + 120000);
    f.reopen();
    assert.deepEqual(f.manager.snapshot(1), before);
    f.due();
    for (let i = 0; i < 3; i++) assert.equal(await f.manager.tick(), true);
    assert.equal(f.calls.length, 3);
    assert.ok(f.manager.snapshot(1)[0].checks.every(check => check.status === 'ready' && Object.values(check.signals).every(Boolean)));
    const payloads = JSON.stringify(f.calls.map(call => call.payload));
    assert.doesNotMatch(payloads, /PLAYER_SECRET|JUDGE_SECRET|WORLD_SECRET|Bellweather|Eli|Mara|Jonah|feedback|judgeOnly|privateFacts/);
    const persisted = JSON.stringify({ batches: f.db.prepare('SELECT * FROM world_game_probe_batches').all(), jobs: f.db.prepare('SELECT * FROM world_game_probe_jobs').all(), public: f.manager.snapshot(1) });
    assert.doesNotMatch(persisted, /FIXTURE_SECRET_KEY|probe.example.test|PLAYER_SECRET|JUDGE_SECRET|WORLD_SECRET|CHECK_/);
    assert.match(persisted, /do not guarantee/);
    assert.equal(await f.manager.tick(), false);
  } finally { f.close(); }
});

test('retry backoff and all workers share at most three outbound reservations per URL in rolling 24 hours', async () => {
  let calls = 0;
  const f = fixture({ send: async () => { calls++; const error = new Error('secret key https://raw.example/secret'); error.status = 503; throw error; } });
  try {
    f.manager.schedule(1, settings); f.due(); f.clock += 5 * 60 * 1000;
    await f.manager.tick();
    let job = f.db.prepare("SELECT * FROM world_game_probe_jobs WHERE status='retry'").get();
    assert.equal(job.next_at, f.clock + 2000);
    await f.manager.tick(); // The other synthetic check can run before the retry.
    f.clock += 2000;
    await f.manager.tick();
    f.clock += 2000;
    await f.manager.tick();
    assert.equal(calls, 3);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM world_game_probe_attempts').get().n, 3);
    assert.doesNotMatch(JSON.stringify(f.manager.snapshot(1)), /secret key|raw.example/);
    f.reopen(); f.manager.schedule(1, settings); f.due(); await f.manager.tick();
    assert.equal(calls, 3);
    // A new batch's creation day does not erase attempts made late in the old batch.
    f.clock = 1000000 + DAY + 1;
    assert.equal(f.manager.schedule(1, settings), true); f.due();
    await f.manager.tick(); await f.manager.tick();
    assert.equal(calls, 3);
    assert.ok(f.manager.snapshot(1)[0].checks.every(check => check.status === 'skipped'));
  } finally { f.close(); }
});

test('crash recovery keeps paid reservations, skips changed configuration and does not run while player is idle', async () => {
  const f = fixture();
  try {
    f.manager.schedule(1, settings); f.due();
    const job = f.db.prepare('SELECT j.id,b.fingerprint FROM world_game_probe_jobs j JOIN world_game_probe_batches b ON b.id=j.batch_id ORDER BY next_at LIMIT 1').get();
    f.db.prepare("UPDATE world_game_probe_jobs SET status='running',attempts=1,lease_owner='crashed',lease_until=? WHERE id=?").run(f.clock - 1, job.id);
    f.db.prepare('INSERT INTO world_game_probe_attempts VALUES(?,?,?,?,?)').run(crypto.randomUUID(), 1, job.fingerprint, job.id, f.clock);
    f.reopen(); await f.manager.tick(); f.clock += 2000; await f.manager.tick();
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM world_game_probe_attempts').get().n, 3);
    assert.equal(f.calls.length, 2);
    f.clock += DAY;
    f.manager.schedule(1, settings); f.due();
    f.provider = { id: 'openai', configured: true, base: 'https://second.example.test', key: 'new-secret' };
    await f.manager.tick();
    assert.ok(f.manager.snapshot(1)[0].checks.some(check => check.error === 'provider_changed'));
    const calls = f.calls.length;
    f.clock += ACTIVE + 1; await f.manager.tick();
    assert.equal(f.calls.length, calls);
  } finally { f.close(); }
});

test('repeated transient failures use 2s then 4s backoff and stop after the third reserved request', async () => {
  let calls = 0;
  const f = fixture({ send: async () => { calls++; throw new Error('transient'); } });
  try {
    f.manager.schedule(1, settings);
    f.clock = f.db.prepare('SELECT MIN(next_at) AS time FROM world_game_probe_jobs').get().time;
    await f.manager.tick();
    let job = f.db.prepare("SELECT * FROM world_game_probe_jobs WHERE attempts>0").get();
    assert.equal(job.next_at, f.clock + 2000);
    f.clock += 2000; await f.manager.tick();
    job = f.db.prepare("SELECT * FROM world_game_probe_jobs WHERE attempts>0").get();
    assert.equal(job.next_at, f.clock + 4000);
    f.clock += 4000; await f.manager.tick();
    assert.equal(calls, 3);
    job = f.db.prepare("SELECT * FROM world_game_probe_jobs WHERE attempts>0").get();
    assert.equal(job.status, 'failed');
    f.due(); await f.manager.tick();
    assert.equal(calls, 3);
  } finally { f.close(); }
});

test('simultaneous workers claim different jobs and stop aborts in-flight transport for retry after restart', async () => {
  const held = [];
  const f = fixture({ send: input => new Promise((resolve, reject) => {
    held.push({ input, resolve });
    input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  let second;
  try {
    f.manager.schedule(1, settings); f.due();
    second = createProviderProbes({ db: f.db, resolve: () => ({ configured: true, id: 'openai', base: 'https://probe.example.test' }),
      validate: validateBase, now: () => f.clock, send: async () => ({ status: 401, text: '' }) });
    const pending = f.manager.tick();
    assert.equal(held.length, 1);
    await second.tick();
    assert.equal(f.db.prepare('SELECT COUNT(DISTINCT job_id) AS n FROM world_game_probe_attempts').get().n, 2);
    f.manager.stop(); await pending;
    assert.equal(held[0].input.signal.aborted, true);
    const statuses = f.manager.snapshot(1)[0].checks;
    assert.ok(statuses.some(check => check.error === 'http_401' && check.status === 'failed'));
    assert.ok(statuses.some(check => check.error === 'interrupted' && check.status === 'retry'));
    f.db.prepare('DELETE FROM users WHERE id=1').run();
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM world_game_probe_attempts').get().n, 0);
  } finally { second?.stop(); f.close(); }
});

test('transport parses split UTF-8 SSE, detects truncation, blocks redirects and limits response size without fallback', async () => {
  const previous = global.fetch;
  let requestCount = 0;
  const input = { provider: { base: 'https://probe.example.test/v1', key: 'mock-key' }, signal: new AbortController().signal,
    payload: { stream: true, messages: [] } };
  try {
    global.fetch = async (url, options) => {
      requestCount++;
      assert.equal(url, 'https://probe.example.test/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      const bytes = Buffer.from('data: {"choices":[{"delta":{"content":"café"}}]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\ndata: [DONE]\n\n');
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    };
    const response = await sendProbe(input);
    assert.deepEqual(response, { status: 200, text: 'café', complete: true, sse: true, usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } });
    global.fetch = async () => Response.json({ choices: [{ message: { content: 'plain' } }], usage: { total_tokens: 5 } });
    assert.deepEqual(await sendProbe({ ...input, payload: { stream: false, messages: [] } }), { status: 200, text: 'plain', usage: { total_tokens: 5 } });
    global.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    assert.equal((await sendProbe(input)).complete, false);
    global.fetch = async () => new Response('event: error\ndata: {"message":"failed"}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const errorEvent = await sendProbe(input);
    assert.equal(errorEvent.complete, false);
    assert.equal(errorEvent.sse, false);
    global.fetch = async () => new Response('x'.repeat(33000));
    await assert.rejects(sendProbe(input), /oversized/);
    assert.equal(requestCount, 1);
  } finally { global.fetch = previous; }
});

test('accounting records only numbers and fixed request metadata, including failure status', async () => {
  const entries = [];
  let calls = 0;
  const f = fixture({ record: entry => entries.push(entry), send: async () => {
    calls++;
    return calls === 1 ? { status: 200, text: 'PRIVATE_RESPONSE_TEXT', usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, privateField: 'NEVER_LOG' } }
      : { status: 401, text: 'secret-key-in-error', usage: null };
  } });
  try {
    f.manager.schedule(1, settings); f.due();
    await f.manager.tick(); await f.manager.tick();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, 'world_game_probe');
    assert.equal(entries[0].promptTokens, 12);
    assert.equal(entries[0].completionTokens, 7);
    assert.equal(entries[0].totalTokens, 19);
    assert.equal(entries[1].status, 401);
    assert.equal(entries[1].totalTokens, 0);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_RESPONSE|NEVER_LOG|secret-key|probe.example.test|messages|CHECK_/);
  } finally { f.close(); }
});

test('malformed provider token counts cannot persist negative, fractional or non-finite accounting values', async () => {
  const entries = [];
  let calls = 0;
  const f = fixture({ record: entry => entries.push(entry), send: async () => ({ status: 200, text: '',
    usage: ++calls === 1 ? { prompt_tokens: -12, completion_tokens: Infinity, total_tokens: '1e309' }
      : { prompt_tokens: '12.9', completion_tokens: '2', total_tokens: -1 } }) });
  try {
    f.manager.schedule(1, settings); f.due();
    await f.manager.tick(); await f.manager.tick();
    assert.deepEqual(entries.map(({ promptTokens, completionTokens, totalTokens }) => ({ promptTokens, completionTokens, totalTokens })), [
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      { promptTokens: 12, completionTokens: 2, totalTokens: 14 }
    ]);
    assert.ok(entries.every(entry => [entry.promptTokens, entry.completionTokens, entry.totalTokens].every(Number.isSafeInteger)));
  } finally { f.close(); }
});

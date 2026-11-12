'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

// Every dependency, credential, account and fetch is local to the fixture.
const root = path.resolve(process.env.AI_EN_PROVIDER_TEST_ROOT || path.join(__dirname, '..'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(file, dependencies, globals = {}, append = '') {
  const module = { exports: {} };
  vm.runInNewContext(read(file) + append, {
    module, exports: module.exports, Buffer, URL, AbortController, AbortSignal,
    setTimeout, clearTimeout, setInterval, clearInterval, process: { env: {} }, ...globals,
    require(id) {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id.startsWith('node:')) return require(id);
      throw new Error(`Unexpected dependency ${id}`);
    }
  }, { filename: file });
  return module.exports;
}
const turn = () => new Promise(resolve => setImmediate(resolve));
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(fetch, workerOptions = {}) {
  const events = [], calls = [], writes = [], errors = [];
  let closed = false, claimed = false;
  const ensureOpen = () => assert.equal(closed, false, 'write after database closed');
  const transport = evaluate('server/services/proxy.js', { '../config': { PROXY_TIMEOUT: 10000 } }, {
    fetch: (url, options) => { calls.push({ url, options }); return fetch(url, options); }
  });
  const upstream = { id: 'aihub8', base: 'https://primary.invalid', key: 'fixture-key', configured: true, personal: true, defaultModel: 'fixture-model' };
  const routes = evaluate('server/routes/proxy.js', {
    '../helpers': { readBody: async req => { const parts = []; for await (const part of req) parts.push(Buffer.from(part)); return Buffer.concat(parts); }, corsHeaders: () => ({}) },
    '../config': { MINIMAX_KEY: () => 'fixture-fallback', MINIMAX_BASE: () => 'https://fallback.invalid', AIHUB8_KEY: () => 'fixture-primary', AIHUB8_BASE: () => upstream.base, AIHUB8_MODEL: () => 'fixture-model' },
    '../services/proxy': transport, '../services/anki': {}, '../validation': {}, '../services/logger': {},
    '../services/providers': { resolveProvider: () => upstream, sanitizeModel: model => model || upstream.defaultModel },
    '../services/usage': {
      reserveGiftCall: () => { ensureOpen(); return { allowed: true, reservationId: 'fixture-reservation' }; },
      finishGiftCall: () => { ensureOpen(); events.push('quota-finished'); },
      recordUsage: () => { ensureOpen(); events.push('usage-recorded'); }, parseChatUsage: () => null
    },
    '../db': { db: { prepare: () => ({ get: () => ({ username: 'fixture-learner' }) }) } }
  });
  const job = { id: 'fixture-job', user_id: 1, kind: 'feedback', provider: 'aihub8', input: { text: 'I heard the harbor bell.' }, dependencies: [] };
  const store = {
    claimJob() { if (claimed) return null; claimed = true; return job; },
    completeJob(...args) { ensureOpen(); writes.push(['complete', ...args]); },
    failJob(...args) { ensureOpen(); writes.push(['fail', ...args]); }
  };
  const workers = evaluate('server/services/world-game-worker.js', {
    './world-game-store': { getDefaultStore: () => store },
    './world-game-provider-probes': { startDefaultProbes() {}, stopDefaultProbes: () => Promise.resolve() },
    '../routes/proxy': routes
  });
  return { worker: workers.createFeedbackWorker({ store, onError: error => errors.push(error), ...workerOptions }), calls, writes, events, errors,
    close() { closed = true; events.push('db-closed'); } };
}
function pendingFetch(releaseAbort) {
  return (url, { signal }) => new Promise((resolve, reject) => {
    const abort = () => { void (releaseAbort?.promise || Promise.resolve()).then(() => reject(signal.reason)); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

test('stop aborts the actual primary fetch, suppresses fallback and drains accounting before DB close', async () => {
  const release = gate();
  const f = fixture(pendingFetch(release));
  const tick = f.worker.tick(); await turn();
  assert.equal(f.calls.length, 1);
  let drained = false;
  const stop = f.worker.stop().then(() => { drained = true; f.close(); });
  assert.equal(f.calls[0].options.signal.aborted, true);
  await turn(); assert.equal(drained, false);
  release.resolve(); await Promise.all([tick, stop]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.worker.busy, false);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.events, ['quota-finished', 'usage-recorded', 'db-closed']);
  assert.equal(await f.worker.tick(), false);
});

test('stop reaches a running fallback fetch without starting any additional request', async () => {
  let count = 0;
  const f = fixture((url, options) => ++count === 1
    ? Promise.resolve({ status: 503, headers: {}, arrayBuffer: async () => Buffer.from('{}') })
    : pendingFetch()(url, options));
  const tick = f.worker.tick(); await turn();
  // The HEAD release path intentionally has no unrelated fallback feature.
  const hasFallback = read('server/routes/proxy.js').includes('async function chatUpstreamWithFallback');
  if (hasFallback) {
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[1].url, /fallback.invalid/);
    await f.worker.stop(); await tick;
    assert.equal(f.calls[1].options.signal.aborted, true);
    assert.deepEqual(f.writes, []);
  } else {
    await tick; await f.worker.stop(); assert.equal(f.calls.length, 1);
    assert.equal(f.writes[0][0], 'fail');
  }
});

test('job total deadline aborts transport and records one retryable failure', async () => {
  const f = fixture(pendingFetch(), { timeoutMs: 15 });
  await f.worker.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], 'fail');
  assert.equal(f.writes[0].at(-1), true);
  await f.worker.stop();
});

test('a completion that ignores abort cannot write a late result after stop', async () => {
  const release = gate(); let signal;
  const f = fixture(() => { throw new Error('unexpected fetch'); }, { complete: (job, messages, options) => { signal = options.signal; return release.promise; } });
  const tick = f.worker.tick();
  const stop = f.worker.stop();
  assert.equal(signal.aborted, true);
  release.resolve('A late coaching result.');
  await Promise.all([tick, stop]); f.close();
  assert.deepEqual(f.writes, []);
});

test('legacy proxy callers without a signal still complete normally', async () => {
  let passed;
  const transport = evaluate('server/services/proxy.js', { '../config': { PROXY_TIMEOUT: 1000 } }, {
    fetch: async (url, options) => { passed = options; return { status: 200, headers: {}, arrayBuffer: async () => Buffer.from('ok') }; }
  });
  const result = await transport.proxyRequest('https://fixture.invalid', Buffer.from('{}'), {});
  assert.equal(result.status, 200); assert.equal(result.data.toString(), 'ok');
  assert.equal(passed.signal.aborted, false);
});

test('an already aborted caller never starts transport and preserves its cancellation reason', async () => {
  let calls = 0;
  const transport = evaluate('server/services/proxy.js', { '../config': { PROXY_TIMEOUT: 1000 } }, {
    fetch: async () => { calls++; throw new Error('unexpected fetch'); }
  });
  const controller = new AbortController();
  const reason = new Error('already stopped'); controller.abort(reason);
  await assert.rejects(transport.proxyRequest('https://fixture.invalid', Buffer.from('{}'), {}, undefined, 'POST', controller.signal), error => error === reason);
  assert.equal(calls, 0);
});

test('provider probe stop awaits aborted transport, accounting and job state before DB close', async () => {
  const { createProviderProbes } = evaluate('server/services/world-game-provider-probes.js', {
    './providers': { normalizeProviderBase: base => base.replace(/\/+$/, '') }
  });
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1)');
  const release = gate(), events = [];
  let clock = 100000, signal;
  const probes = createProviderProbes({ db, now: () => clock, random: () => .9,
    resolve: () => ({ configured: true, id: 'custom', base: 'https://fixture.invalid', key: 'fixture', defaultModel: 'fixture' }),
    validate() {}, record() { events.push('accounted'); },
    send: options => { signal = options.signal; return pendingFetch(release)('', options); }
  });
  assert.equal(probes.schedule(1, { provider: 'custom' }), true);
  clock += 200000;
  const tick = probes.tick();
  let drained = false;
  const stop = probes.stop().then(() => { drained = true; assert.equal(db.prepare("SELECT status FROM world_game_probe_jobs WHERE attempts=1").get().status, 'retry'); db.close(); events.push('closed'); });
  assert.equal(signal.aborted, true);
  await turn(); assert.equal(drained, false);
  release.resolve(); await Promise.all([tick, stop]);
  assert.deepEqual(events, ['accounted', 'closed']);
});

test('app graceful shutdown and finalizer await worker drain before checkpoint and close', async () => {
  const source = read('server/app.js');
  const lifecycle = source.slice(source.indexOf('let shuttingDown = false;'), source.indexOf("process.on('SIGINT'"));
  const release = gate(), events = [];
  let callback;
  const context = {
    worldGameRoutes: { stopWorker: () => release.promise },
    server: { close: fn => { callback = fn; } },
    db: { exec: () => events.push('checkpoint'), close: () => events.push('close') },
    logger: { info() {}, warn() {}, error: error => { throw new Error(error); } },
    process: { exit: code => events.push(`exit-${code}`) },
    sessionTimer: 1, checkpointTimer: 2, backupTimer: undefined, clearInterval() {},
    setTimeout: () => ({ unref() {} })
  };
  vm.runInNewContext(lifecycle + '\nthis.shutdownForTest = shutdown; this.finalizeForTest = finalizeDb;', context);
  context.shutdownForTest('TEST');
  const pending = callback(); await turn();
  assert.deepEqual(events, []);
  release.resolve(); await pending;
  assert.deepEqual(events, ['checkpoint', 'close', 'exit-0']);
  await context.finalizeForTest();
  assert.equal(events.filter(item => item === 'close').length, 1);
});

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { APP_DIR, startServer, request, login } = require('./helpers');

describe('Bellweather world game boundaries', () => {
  let server, token;
  test('the browser bundle contains no judge truth or NPC private worldbook', () => {
    const frontend = fs.readFileSync(path.join(APP_DIR, 'js/world-game.js'), 'utf8');
    assert.doesNotMatch(frontend, /saltwater reached the lower switch box|privateFacts|judgeOnly|answer:\s*1/i);
  });

  test('NPC model context contains only global, current-stage, and owner-private facts', async () => {
    const route = require('../server/routes/world-game');
    const proxy = require('../server/routes/proxy');
    const original = proxy.chatStream;
    let captured;
    proxy.chatStream = async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk.toString('utf8');
      captured = JSON.parse(raw);
      res.writeHead(200);
      res.end('data: [DONE]\n\n');
    };
    try {
      const req = new PassThrough();
      req.headers = { 'content-length': '0' };
      req.uid = 'test-user';
      req.username = 'test';
      req.id = 'test-request';
      const result = { statusCode: 0, writeHead(status) { this.statusCode = status; }, end() {} };
      const from = { x: 1.2, z: -10.5 }, to = { x: 5, z: 4 };
      for (let index = 0; index <= 50; index++) {
        const t = index / 50;
        const position = [from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t];
        if (index) await new Promise(resolve => setTimeout(resolve, 85));
        const moveReq = new PassThrough();
        moveReq.headers = { 'content-length': '0' };
        moveReq.uid = 'test-user'; moveReq.username = 'test'; moveReq.id = 'move-request-' + index;
        const moveResult = { statusCode: 0, writeHead(status) { this.statusCode = status; }, end() {} };
        const moved = route.move(moveReq, moveResult);
        moveReq.end(JSON.stringify({ stageId: 'low-tide', position: { x: position[0], z: position[1] }, dt: 1 }));
        await moved;
        assert.equal(moveResult.statusCode, 200);
      }
      const finished = route.npc(req, result);
      req.end(JSON.stringify({ stageId: 'low-tide', npcId: 'mara', text: 'What happened?', provider: 'aihub8' }));
      await finished;

      assert.equal(result.statusCode, 200);
      assert.equal(captured.reasoning_effort, 'low');
      const system = captured.messages[0].content;
      assert.match(system, /Bellweather is a small fishing town/);
      assert.match(system, /Mara found the wet fuse beside the east pier/);
      assert.match(system, /Mara believes the storm surge reached the lower switch box/);
      assert.doesNotMatch(system, /Saltwater from the storm surge entered the lower switch box/);
      assert.doesNotMatch(system, /Eli keeps a dry ceramic fuse/);
      assert.doesNotMatch(system, /judge_only|feedback|runtime/i);
      assert.equal(route.providerPayload({ provider: 'aihub8' }, [], false, 'medium').reasoning_effort, 'medium');
      assert.deepEqual(route.providerPayload({ provider: 'minimax' }, [], true, 'low').thinking, { type: 'disabled' });
      assert.deepEqual(route.providerPayload({ provider: 'minimax' }, [], false, 'medium').thinking, { type: 'enabled' });
    } finally {
      proxy.chatStream = original;
    }
  });

  test('authenticated quiz responses omit the answer key and keep judging on the server', async () => {
    server = await startServer({ tag: 'world-game', env: { AIHUB8_API_KEY: '', MINIMAX_API_KEY: '' } });
    token = await login(server.port, 'test', 'test');

    const unauthorized = await request({ port: server.port, method: 'POST', path: '/api/world-game/questions', json: { stageId: 'low-tide' } });
    assert.equal(unauthorized.status, 401);

    const generated = await request({ port: server.port, method: 'POST', path: '/api/world-game/questions', token, json: { stageId: 'low-tide', provider: 'minimax' } });
    assert.equal(generated.status, 200);
    const quiz = JSON.parse(generated.body);
    assert.ok(quiz.quizId);
    assert.ok(quiz.questions.length >= 1);
    assert.ok(quiz.questions.every(question => !Object.hasOwn(question, 'answer') && !Object.hasOwn(question, 'why')));

    const lockedStage = await request({ port: server.port, method: 'POST', path: '/api/world-game/questions', token, json: { stageId: 'storm-line', provider: 'minimax' } });
    assert.equal(lockedStage.status, 403);

    const correct = await request({ port: server.port, method: 'POST', path: '/api/world-game/answer', token, json: { quizId: quiz.quizId, index: 0, choice: 1 } });
    assert.equal(correct.status, 200);
    assert.equal(JSON.parse(correct.body).correct, true);
    assert.ok(!JSON.stringify(JSON.parse(correct.body)).includes('judge_only'));

    const replay = await request({ port: server.port, method: 'POST', path: '/api/world-game/answer', token, json: { quizId: quiz.quizId, index: 0, choice: 1 } });
    assert.equal(replay.status, 409);

    const invalidStage = await request({ port: server.port, method: 'POST', path: '/api/world-game/questions', token, json: { stageId: '../../future' } });
    assert.equal(invalidStage.status, 400);

    const remoteNpc = await request({ port: server.port, method: 'POST', path: '/api/world-game/npc', token, json: { stageId: 'low-tide', npcId: 'eli', text: 'Tell me the truth.', provider: 'minimax' } });
    assert.equal(remoteNpc.status, 409);
  });

  test('the standalone world-game entry and screenshot reference are served separately', async () => {
    const { STATIC_MIME } = require('../server/config');
    assert.equal(STATIC_MIME['.glb'], 'model/gltf-binary');
    const entry = await request({ port: server.port, path: '/english?version=dev%2Fworld-game' });
    assert.equal(entry.status, 200);
    assert.match(entry.headers['content-type'], /text\/html/);
    assert.match(entry.body, /Bellweather: The Quiet Tide/);
    assert.doesNotMatch(entry.body, /id="gameArea"/);
    const betaEntry = await request({ port: server.port, path: '/?version=beta%2Fworld-game' });
    assert.equal(betaEntry.status, 200);
    const assets = [...entry.body.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];
    assert.ok(assets.length >= 2);
    for (const [, asset] of assets) {
      const resource = await request({ port: server.port, path: asset.replace(/^\/english-beta/, '') });
      assert.equal(resource.status, 200, asset);
    }
    const harborAsset = await request({ port: server.port, path: '/world-game/assets/environment/bellweather-harbor-v2.glb' });
    assert.equal(harborAsset.status, 200);
    assert.equal(harborAsset.headers['content-type'], 'model/gltf-binary');
    const metadata = await request({ port: server.port, path: '/world-game/assets/characters/task.json' });
    assert.equal(metadata.status, 404);
    const response = await request({ port: server.port, path: '/img/world-game-target.png' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/png');
  });

  test('world-game services are stopped after the API checks', async () => {
    if (server) { await server.stop(); server.cleanup(); server = null; }
    assert.equal(server, null);
  });
});

/* 服务与密钥路由：掩码回传、.env 原子写入、运行时生效、上游检测

   核心安全约束：**密钥永不明文出现在任何响应里**。
   测试显式断言响应体不包含完整 key（只允许掩码格式 前4…后4）。 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const { maskKey, writeEnvKey, readEnvValue } = require('../server/services/envfile');

/* 与真实进程一致的注入值（helpers 会把空串传给子进程，表示「未配置」） */
const KEY_MINIMAX = 'sk-test-minimax-0123456789abcdef';

describe('maskKey 掩码规则', () => {
  test('长 key 只露前4后4', () => {
    assert.strictEqual(maskKey('sk-abcdefgh12345678'), 'sk-a…5678');
  });
  test('空与过短 key 完全遮蔽', () => {
    assert.strictEqual(maskKey(''), '');
    assert.strictEqual(maskKey('short'), '****');
    assert.strictEqual(maskKey('12345678'), '****');
  });
});

describe('.env 原子写入（对临时文件）', () => {
  test('原位替换已有行，保留注释与其他行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-env-'));
    const f = path.join(dir, '.env');
    fs.writeFileSync(f, '# comment line\nMINIMAX_API_KEY=old-key-1111\nOTHER=1\n', 'utf8');
    writeEnvKey(f, 'MINIMAX_API_KEY', 'new-key-2222');
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(txt.includes('MINIMAX_API_KEY=new-key-2222'), '应原位替换');
    assert.ok(txt.includes('# comment line') && txt.includes('OTHER=1'), '不应破坏其他行');
    assert.strictEqual((txt.match(/MINIMAX_API_KEY=/g) || []).length, 1, '不应出现重复行');
    assert.strictEqual(readEnvValue(f, 'MINIMAX_API_KEY'), 'new-key-2222');
  });

  test('目标行不存在时追加到末尾', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-env-'));
    const f = path.join(dir, '.env');
    fs.writeFileSync(f, 'A=1\n', 'utf8');
    writeEnvKey(f, 'ELEVEN_API_KEY', 'el-3333');
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(txt.includes('ELEVEN_API_KEY=el-3333'));
    assert.strictEqual(readEnvValue(f, 'ELEVEN_API_KEY'), 'el-3333');
    assert.strictEqual(readEnvValue(f, 'A'), '1');
  });

  test('对不存在的文件：创建并写入', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-env-'));
    const f = path.join(dir, 'fresh.env');
    writeEnvKey(f, 'MINIMAX_API_KEY', 'fresh-0000');
    assert.strictEqual(readEnvValue(f, 'MINIMAX_API_KEY'), 'fresh-0000');
  });
});

describe('GET /api/keys/status（真实进程）', () => {
  test('返回掩码与来源，绝不含明文 key', async () => {
    const { startServer, request, login } = require('./helpers');
    const s = await startServer({ tag: 'keys', env: { MINIMAX_API_KEY: KEY_MINIMAX, ELEVEN_API_KEY: '' } });
    try {
      const token = await login(s.port, 'test', 'test');
      const r = await request({ port: s.port, path: '/api/keys/status', token });
      assert.strictEqual(r.status, 200);
      const d = JSON.parse(r.body);
      assert.strictEqual(d.minimax.configured, true);
      assert.strictEqual(d.minimax.masked, 'sk-t…cdef');
      assert.strictEqual(d.minimax.source, 'env');
      assert.strictEqual(d.eleven.configured, false);
      assert.strictEqual(d.eleven.masked, '');
      // 安全断言：注入的完整 key 不得出现在任何响应里
      assert.ok(!r.body.includes(KEY_MINIMAX), '响应泄露了明文 key');
      // 未登录拒绝
      const noAuth = await request({ port: s.port, path: '/api/keys/status' });
      assert.strictEqual(noAuth.status, 401);
    } finally {
      await s.stop();
      s.cleanup();
    }
  });
});

describe('POST /api/keys/rotate（写入隔离的临时 .env，端到端）', () => {
  test('rotate 后 status 掩码更新、运行时立即生效、写入不碰仓库 .env', async () => {
    const { startServer, request, login } = require('./helpers');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-en-env-'));
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, '# smoke\n', 'utf8');
    const s = await startServer({
      tag: 'keys-e2e',
      env: { MINIMAX_API_KEY: KEY_MINIMAX, ELEVEN_API_KEY: '', AI_EN_ENV_FILE: envFile }
    });
    try {
      const token = await login(s.port, 'test', 'test');
      const NEW = 'sk-brand-new-key-abcdef123456';
      const r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate', token, json: { service: 'minimax', key: NEW } });
      assert.strictEqual(r.status, 200);
      const body = JSON.parse(r.body);
      assert.strictEqual(body.status, 'rotated');
      assert.strictEqual(body.masked, 'sk-b…3456');
      assert.ok(!r.body.includes(NEW), 'rotate 响应不得包含明文新 key');
      // .env 被写入（且保留原有注释行）
      const txt = fs.readFileSync(envFile, 'utf8');
      assert.ok(txt.includes('MINIMAX_API_KEY=' + NEW), '新 key 应写入临时 .env');
      assert.ok(txt.includes('# smoke'), '应保留原文件内容');
      // status 立即反映新值（运行时生效，无需重启）
      const st = JSON.parse((await request({ port: s.port, path: '/api/keys/status', token })).body);
      assert.strictEqual(st.minimax.masked, 'sk-b…3456');
      assert.strictEqual(st.minimax.source, 'file');
      // 全部响应都不得含明文
      assert.ok(!r.body.includes(NEW) && !(await request({ port: s.port, path: '/api/keys/status', token })).body.includes(NEW));
    } finally {
      await s.stop();
      s.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('未知 service / 空 key / 过短 key / 未登录 全部拒绝', async () => {
    const { startServer, request, login } = require('./helpers');
    const s = await startServer({ tag: 'keys-rot', env: { MINIMAX_API_KEY: '', ELEVEN_API_KEY: '' } });
    try {
      const token = await login(s.port, 'test', 'test');
      let r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate', token, json: { service: 'openai', key: 'sk-xxxx' } });
      assert.strictEqual(r.status, 400);
      r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate', token, json: { service: 'minimax', key: '' } });
      assert.strictEqual(r.status, 400);
      r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate', token, json: { service: 'minimax', key: 'abc' } });
      assert.strictEqual(r.status, 400);
      r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate', json: { service: 'minimax', key: 'sk-abcdefgh12345678' } });
      assert.strictEqual(r.status, 401);
    } finally {
      await s.stop();
      s.cleanup();
    }
  });

  test('rotate-base：非法 URL 400、合法 URL 通过后 status 反映新值', async () => {
    const { startServer, request, login } = require('./helpers');
    const s = await startServer({ tag: 'keys-base', env: { MINIMAX_API_KEY: '', ELEVEN_API_KEY: '' } });
    try {
      const token = await login(s.port, 'test', 'test');
      let r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate-base', token, json: { base: 'not-a-url' } });
      assert.strictEqual(r.status, 400);
      r = await request({ port: s.port, method: 'POST', path: '/api/keys/rotate-base', token, json: { base: 'http://127.0.0.1:9999' } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.body).base, 'http://127.0.0.1:9999');
      // 进程内立即生效（status 返回新 base）
      const st = JSON.parse((await request({ port: s.port, path: '/api/keys/status', token })).body);
      assert.strictEqual(st.minimax.base, 'http://127.0.0.1:9999');
    } finally {
      await s.stop();
      s.cleanup();
    }
  });
});

describe('POST /api/keys/test/:service（最小成本真实请求）', () => {
  test('未配置的 key 返回 ok:false 而不是 500；未知 service 400', async () => {
    const { startServer, request, login } = require('./helpers');
    const s = await startServer({ tag: 'keys-test', env: { ELEVEN_API_KEY: '' } });
    try {
      const token = await login(s.port, 'test', 'test');
      const r = await request({ port: s.port, method: 'POST', path: '/api/keys/test/eleven', token });
      assert.strictEqual(r.status, 200);
      const d = JSON.parse(r.body);
      assert.strictEqual(d.ok, false);
      assert.match(d.detail, /未配置/);
      const r2 = await request({ port: s.port, method: 'POST', path: '/api/keys/test/nope', token });
      assert.strictEqual(r2.status, 400);
    } finally {
      await s.stop();
      s.cleanup();
    }
  });
});

/* 静态文件服务安全：路径穿越必须被拒绝，公开资源必须可访问 */
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { startServer, rawGet, request } = require('./helpers');

describe('静态文件服务', () => {
  let srv;

  before(async () => { srv = await startServer({ tag: 'static' }); });
  after(async () => { if (srv) { await srv.stop(); srv.cleanup(); } });

  test('路径穿越一律 404/400，不得泄露 .env / 数据库 / 备份 / 源码', async () => {
    const attacks = [
      '/js/../.env',
      '/js/../server.js',
      '/css/../.env',
      '/css/../data/app.db',
      '/vendor/../data/app.db',
      '/music/../.env',
      '/js/%2e%2e/.env',
      '/js/..%2f.env',
      '/js/%2e%2e%2f.env',
      '/js/%2e%2e%5c.env',
      '/js/..\\.env',
      '/js/....//.env',
      '/js/./../.env',
      '/js/a/../../.env',
      '/js/../data/backups/x_chat.db',
      '/js//../.env',
      '/vendor/katex/../../.env',
      '/img/../.env',
      '/img/icons/../../.env',
      '/img/%2e%2e/.env'
    ];
    for (const p of attacks) {
      const r = await rawGet(srv.port, p);
      assert.ok(r.status === 404 || r.status === 400, `${p} 应被拒绝，实际 ${r.status}`);
      assert.ok(!/MINIMAX_API_KEY|ELEVEN_API_KEY/.test(r.body), `${p} 响应体疑似包含密钥`);
      assert.ok(!/SQLite format/.test(r.body), `${p} 响应体疑似包含 SQLite 数据`);
    }
  });

  test('NUL 字节被拒绝', async () => {
    const r = await rawGet(srv.port, '/js/%00.env');
    assert.strictEqual(r.status, 400);
  });

  test('公开资源可正常访问', async () => {
    for (const p of ['/', '/index.html', '/js/app.js', '/js/storage.js', '/js/config.js', '/css/style.css', '/vendor/katex/katex.min.js', '/img/icons/chat.jpg']) {
      const r = await request({ port: srv.port, path: p });
      assert.strictEqual(r.status, 200, `${p} 应为 200，实际 ${r.status}`);
    }
  });

  test('index.html 引用的本地静态资源全部可访问（防止漏加白名单前缀）', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { APP_DIR } = require('./helpers');
    const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
    const refs = new Set();
    // 前置 \s 是必要的：否则 data-src="presets" 里的 src= 也会被当成资源引用
    for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|data:|mailto:|#|\/\/)/.test(u)) continue;
      refs.add('/' + u.replace(/^\.?\//, '').split('?')[0]);
    }
    assert.ok(refs.size >= 5, `解析到的本地资源太少 (${refs.size})`);
    for (const p of refs) {
      const r = await request({ port: srv.port, path: encodeURI(p) });
      assert.strictEqual(r.status, 200, `${p} 被 index.html 引用但返回 ${r.status}（可能缺少静态前缀白名单）`);
    }
  });

  test('非白名单扩展名不返回 octet-stream 兜底', async () => {
    // data 目录不在任何公开前缀下，任何形式都取不到
    const r = await request({ port: srv.port, path: '/data/app.db' });
    assert.strictEqual(r.status, 404);
  });

  test('静态响应带 nosniff', async () => {
    const r = await request({ port: srv.port, path: '/js/app.js' });
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  });

  test('/api/health 不泄露数据库绝对路径', async () => {
    const r = await request({ port: srv.port, path: '/api/health' });
    assert.strictEqual(r.status, 200);
    const j = JSON.parse(r.body);
    assert.strictEqual(j.status, 'ok');
    assert.strictEqual(j.db, undefined, 'health 不应返回 db 路径');
  });
});

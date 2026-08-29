/* 前后端 API 契约：前端调用的每个 /api/* 路径都必须有对应后端路由

   本轮修复暴露过一个真实缺陷：前端 storage.js 调用
   POST /api/auth/change-password，而后端根本没有这条路由，
   于是设置面板里的「修改密码」必然 404。
   这类漂移只靠人工 review 很难发现，所以做成自动化契约检查。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { APP_DIR, appPartFiles, readAppSource, serverSource } = require('./helpers');

/* app.js 已拆分到 js/app/，这里把切片与其他前端脚本一并纳入扫描 */
const FRONTEND_FILES = [
  ...appPartFiles().map((p) => path.relative(APP_DIR, p).replace(/\\/g, '/')),
  'js/storage.js',
  'js/config.js'
];
const serverSrc = serverSource();
const appSrc = readAppSource();

/* 从前端源码里抽出所有 /api/... 字面量。
   覆盖 '/api/db/' + key 这类拼接：只取字面量前缀部分，再按前缀匹配路由。 */
function collectFrontendApiPaths() {
  const found = new Map();   // path -> [file:line]
  for (const rel of FRONTEND_FILES) {
    const abs = path.join(APP_DIR, rel);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const re = /['"`](\/api\/[A-Za-z0-9/_:.-]*)['"`]/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const p = m[1];
        if (!found.has(p)) found.set(p, []);
        found.get(p).push(`${rel}:${i + 1}`);
      }
    });
  }
  return found;
}

/* 后端所有路由的判定方式各不相同（=== 比较、正则 match、模板），
   这里用「路径前缀是否出现在 server.js 中」作为存在性判据，
   并对动态段做等价映射。 */
const DYNAMIC_ROUTES = [
  { prefix: '/api/db/', evidence: /\/api\\\/db\\\/\(\\w\+\)|\^\\\/api\\\/db\\\// },
  { prefix: '/api/gaokao/exam/', evidence: /\/api\\\/gaokao\\\/exam\\\// },
  { prefix: '/api/gaokao/question/', evidence: /\/api\\\/gaokao\\\/question\\\// },
  { prefix: '/api/proxy/tts/', evidence: /\/api\\\/proxy\\\/tts\\\// }
];

function routeExists(apiPath) {
  // 1) 直接出现字面量（静态路由）
  if (serverSrc.includes(`'${apiPath}'`) || serverSrc.includes(`"${apiPath}"`)) return true;
  // 2) 动态路由：前缀匹配 + server.js 里有对应正则
  for (const d of DYNAMIC_ROUTES) {
    if (apiPath === d.prefix || apiPath.startsWith(d.prefix)) {
      if (d.evidence.test(serverSrc)) return true;
    }
  }
  // 3) 前端写的是拼接前缀（如 '/api/db/'），后端用正则匹配
  const trimmed = apiPath.replace(/\/$/, '');
  if (serverSrc.includes(`'${trimmed}'`) || serverSrc.includes(`"${trimmed}"`)) return true;
  return false;
}

describe('前后端 API 契约', () => {
  const frontendPaths = collectFrontendApiPaths();

  test('前端引用了至少若干 API（确保扫描逻辑有效）', () => {
    assert.ok(frontendPaths.size >= 8, `扫描到的 API 太少 (${frontendPaths.size})，扫描逻辑可能失效`);
  });

  test('前端调用的每个 API 都有后端路由', () => {
    const missing = [];
    for (const [p, where] of frontendPaths) {
      if (!routeExists(p)) missing.push(`${p}  (${where.join(', ')})`);
    }
    assert.deepStrictEqual(missing, [], '以下前端 API 在 server.js 中找不到对应路由:\n' + missing.join('\n'));
  });

  test('关键路由存在（回归清单）', () => {
    const required = [
      '/api/health',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/sessions',
      '/api/auth/revoke-others',
      '/api/backup',
      '/api/music/list',
      '/api/gaokao/exams',
      '/api/gaokao/pushed',
      '/api/gaokao/push-to-anki',
      '/api/proxy/chat',
      '/api/proxy/chat/stream',
      '/api/proxy/websearch',
      '/api/proxy/anki'
    ];
    for (const r of required) {
      assert.ok(routeExists(r), `缺少路由 ${r}`);
    }
  });

  test('文档与代码中不再引用已删除的旧 Python 入口', () => {
    const targets = ['README.md', 'WIKI.md', 'js/config.js', 'js/storage.js', 'start.bat', ...FRONTEND_FILES];
    for (const rel of new Set(targets)) {
      const abs = path.join(APP_DIR, rel);
      if (!fs.existsSync(abs)) continue;
      const txt = fs.readFileSync(abs, 'utf8');
      assert.ok(!/server\.py/.test(txt), `${rel} 仍引用旧的 Python 入口`);
    }
  });

  test('前端配置不含任何 API key', () => {
    const cfg = fs.readFileSync(path.join(APP_DIR, 'js', 'config.js'), 'utf8');
    // 常见 key 前缀 / 明显的长凭据串
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(cfg), 'config.js 疑似含 sk- 开头的 key');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(cfg), 'config.js 疑似含 JWT');
    assert.ok(!/MINIMAX_API_KEY\s*[:=]\s*['"][^'"]{8,}/.test(cfg), 'config.js 疑似含 MiniMax key');
    assert.ok(!/ELEVEN_API_KEY\s*[:=]\s*['"][^'"]{8,}/.test(cfg), 'config.js 疑似含 ElevenLabs key');
  });

  test('Anki 牌组前缀在前后端保持一致', () => {
    const cfg = fs.readFileSync(path.join(APP_DIR, 'js', 'config.js'), 'utf8');
    const fm = cfg.match(/ANKI_DECK_PREFIX\s*=\s*'([^']+)'/);
    const bm = serverSrc.match(/ANKI_DECK_PREFIX\s*=\s*'([^']+)'/);
    assert.ok(fm, 'config.js 未定义 ANKI_DECK_PREFIX');
    assert.ok(bm, 'server.js 未定义 ANKI_DECK_PREFIX');
    assert.strictEqual(fm[1], bm[1], '前后端 Anki 牌组前缀不一致，会导致归属校验误拒');
  });

  test('前端使用的 Anki action 全部在后端白名单内', () => {
    // 只取 ankiPostCall / ankiCall 语境下的 action
    const used = new Set();
    const re = /action:\s*'([a-zA-Z]+)'\s*,\s*version:\s*6/g;
    let m;
    while ((m = re.exec(appSrc)) !== null) used.add(m[1]);
    assert.ok(used.size >= 10, `识别到的 Anki action 太少 (${used.size})`);

    // 后端白名单集合
    const setLiteral = (name) => {
      const mm = serverSrc.match(new RegExp(name + '\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)'));
      if (!mm) return [];
      return Array.from(mm[1].matchAll(/'([^']+)'/g)).map(x => x[1]);
    };
    const allowed = new Set([
      ...setLiteral('ANKI_READONLY_ACTIONS'),
      ...setLiteral('ANKI_GUI_ACTIONS'),
      ...setLiteral('ANKI_GUARDED_ACTIONS')
    ]);
    assert.ok(allowed.size >= 15, `后端白名单解析失败 (${allowed.size})`);

    const blocked = [...used].filter(a => !allowed.has(a));
    assert.deepStrictEqual(blocked, [], '前端会用到但后端白名单未放行的 Anki action: ' + blocked.join(', '));
  });

  test('前端使用的笔记类型在后端模型白名单内', () => {
    const cfg = fs.readFileSync(path.join(APP_DIR, 'js', 'config.js'), 'utf8');

    const mm = serverSrc.match(/ANKI_ALLOWED_MODELS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(mm, '未找到 ANKI_ALLOWED_MODELS');
    const allowed = new Set(Array.from(mm[1].matchAll(/'([^']+)'/g)).map(x => x[1]));

    const models = new Set();
    const vm = appSrc.match(/VOCAB_MODEL\s*=\s*'([^']+)'/);
    if (vm) models.add(vm[1]);
    const qm = cfg.match(/ANKI_QUIZ_MODEL\s*=\s*'([^']+)'/);
    if (qm) models.add(qm[1]);
    for (const m2 of appSrc.matchAll(/modelName:\s*'([^']+)'/g)) models.add(m2[1]);

    const blocked = [...models].filter(x => !allowed.has(x));
    assert.deepStrictEqual(blocked, [], '前端使用但后端未允许的笔记类型: ' + blocked.join(', '));
  });

  test('user_data key 前后端一致', () => {
    const storage = fs.readFileSync(path.join(APP_DIR, 'js', 'storage.js'), 'utf8');
    const front = new Set();
    for (const src of [storage, appSrc]) {
      for (const m of src.matchAll(/api(?:Save|Load)\(\s*'([a-z_]+)'/g)) front.add(m[1]);
    }
    assert.ok(front.size >= 5, `识别到的 user_data key 太少 (${front.size})`);

    const km = serverSrc.match(/USER_DATA_KEYS\s*=\s*\{([\s\S]*?)\n\};/);
    assert.ok(km, '未找到 USER_DATA_KEYS');
    const allowed = new Set(Array.from(km[1].matchAll(/^\s*([a-z_]+)\s*:/gm)).map(x => x[1]));

    const blocked = [...front].filter(k => !allowed.has(k));
    assert.deepStrictEqual(blocked, [], '前端读写但后端未允许的 user_data key: ' + blocked.join(', '));
  });
});

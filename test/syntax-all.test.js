/* ============================================================
   全量语法检查：把 scripts/check-syntax.js 纳入 npm test。
   ------------------------------------------------------------
   此前 npm test 只跑 test/*.test.js，而 app-split.test.js 只对
   js/app/NN-*.js 做 node --check —— js/storage.js、js/config.js、
   js/shgaoka_bank.js、scripts/*.js 从未被解析过，语法错误能带病发布。
   这里直接调用唯一的检查脚本，避免文件清单在两处漂移。
   ============================================================ */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { APP_DIR } = require('./helpers');

describe('全量语法检查（scripts/check-syntax.js）', () => {
  test('server.js + server/** + js/** + test/** + scripts/** 全部通过 node --check', () => {
    const script = path.join(APP_DIR, 'scripts', 'check-syntax.js');
    let out = '';
    try {
      out = execFileSync(process.execPath, [script], { cwd: APP_DIR, stdio: 'pipe' }).toString('utf8');
    } catch (e) {
      const stdout = (e.stdout || Buffer.from('')).toString('utf8');
      const stderr = (e.stderr || Buffer.from('')).toString('utf8');
      const failed = stdout.split('\n').filter((l) => l.includes('FAIL')).join('\n');
      assert.fail('语法检查未通过:\n' + (failed || stdout.slice(-800)) + '\n' + stderr.slice(0, 500));
    }
    // 确认脚本真的检查了东西，而不是空跑通过
    const m = out.match(/(\d+)\/(\d+) 个文件语法检查通过/);
    assert.ok(m, 'check-syntax.js 输出格式变了，未找到统计行:\n' + out.slice(-400));
    assert.strictEqual(m[1], m[2], '有文件未通过');
    assert.ok(Number(m[2]) >= 50, '被检查的文件数偏少 (' + m[2] + ')，清单可能收集失败');

    // 关键的「此前漏检」文件必须在清单里
    for (const rel of ['js/storage.js', 'js/config.js', 'js/shgaoka_bank.js', 'scripts/check-syntax.js']) {
      assert.ok(out.includes(rel), rel + ' 未被语法检查覆盖');
    }
  });
});

/* app.js 拆分完整性
   ------------------------------------------------------------
   js/app.js 已按领域顺序切片到 js/app/01-*.js … 19-*.js。
   这是「顺序切片」而非「重构」：原文件含顶层 IIFE、事件绑定、const 声明，
   重排会改变执行顺序与 TDZ 行为，所以必须保证：

   1. index.html 按 01→19 顺序、且只加载这些切片
   2. 每个切片单独语法合法（括号/字符串/模板未被切断）
   3. 拼接结果整体语法合法
   4. 顶层声明不重复（切片间没有复制粘贴导致的重复定义）
   5. 关键函数与全局状态齐全（防止切分时漏掉整块）
   6. 不残留旧的单体 js/app.js 引用
*/
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { APP_DIR, APP_PARTS_DIR, appPartFiles, readAppSource } = require('./helpers');

const parts = appPartFiles();
const partNames = parts.map((p) => path.basename(p));
const indexHtml = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');

/* 从 index.html 中按出现顺序取出 js/app/*.js 引用 */
function scriptRefsInOrder() {
  const out = [];
  for (const m of indexHtml.matchAll(/<script\s+src="js\/app\/([^"?]+)(?:\?[^"]*)?"\s*>\s*<\/script>/g)) {
    out.push(m[1]);
  }
  return out;
}

/* 逐字符扫描，返回每行「起始处」的括号深度与注释/模板状态 */
function lineStates(text) {
  const states = [{ depth: 0, inBlock: false, inTemplate: false }];
  let depth = 0;
  let inStr = null;
  let inTemplate = false;
  const tstack = [];
  let inLine = false;
  let inBlock = false;
  let inRegex = false;
  let prev = '';

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '\n') {
      inLine = false;
      inRegex = false;
      if (inStr === "'" || inStr === '"') inStr = null;
      states.push({ depth, inBlock, inTemplate });
      continue;
    }
    if (inLine) continue;
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (inTemplate) {
      if (c === '\\') { i++; continue; }
      if (c === '`') { inTemplate = false; continue; }
      if (c === '$' && n === '{') { tstack.push(depth); depth++; i++; continue; }
      if (c === '}' && tstack.length) { depth = tstack.pop(); continue; }
      continue;
    }
    if (inRegex) { if (c === '\\') { i++; continue; } if (c === '/') inRegex = false; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^<>\s]/.test(prev)) { inRegex = true; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    if (!/\s/.test(c)) prev = c;
  }
  return states;
}

/* 收集一份源码里的顶层声明（depth===0、行首非空白） */
function topLevelDecls(src) {
  const lines = src.split('\n');
  const states = lineStates(src);
  const funcs = [];
  const vars = [];
  for (let i = 0; i < lines.length; i++) {
    const st = states[i];
    if (!st || st.depth !== 0 || st.inBlock || st.inTemplate) continue;
    const raw = lines[i];
    if (!raw.trim() || /^\s/.test(raw)) continue;
    let m = raw.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) { funcs.push(m[1]); continue; }
    m = raw.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (m) vars.push(m[1]);
  }
  return { funcs, vars };
}

describe('app.js 拆分完整性', () => {
  test('切片文件存在且命名规范（NN-name.js）', () => {
    assert.ok(parts.length >= 10, `切片文件太少 (${parts.length})`);
    for (const n of partNames) {
      assert.match(n, /^\d{2}-[a-z0-9-]+\.js$/, `文件名不规范: ${n}`);
    }
    // 序号连续、无重复
    const nums = partNames.map((n) => Number(n.slice(0, 2)));
    assert.deepStrictEqual(nums, [...nums].sort((a, b) => a - b), '序号未按升序排列');
    assert.strictEqual(new Set(nums).size, nums.length, '存在重复序号');
    for (let i = 0; i < nums.length; i++) {
      assert.strictEqual(nums[i], i + 1, `序号不连续：期望 ${i + 1}，实际 ${nums[i]}`);
    }
  });

  test('index.html 按 01→19 顺序加载全部切片，且不多不少', () => {
    const refs = scriptRefsInOrder();
    assert.deepStrictEqual(refs, partNames, 'index.html 引用顺序或集合与 js/app/ 内容不一致');
  });

  test('index.html 不再引用旧的单体 js/app.js', () => {
    assert.ok(
      !/<script\s+src="js\/app\.js/.test(indexHtml),
      'index.html 仍引用 js/app.js，会导致所有函数被重复定义一遍'
    );
  });

  test('每个切片单独通过 node --check', () => {
    for (const p of parts) {
      try {
        execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
      } catch (e) {
        assert.fail(`${path.basename(p)} 语法错误:\n${(e.stderr || '').toString().slice(0, 500)}`);
      }
    }
  });

  test('按加载顺序拼接后整体语法合法', () => {
    const tmp = path.join(require('node:os').tmpdir(), `app-joined-${process.pid}.js`);
    fs.writeFileSync(tmp, readAppSource(), 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      assert.fail(`拼接后语法错误:\n${(e.stderr || '').toString().slice(0, 500)}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test('顶层函数与变量没有跨切片重复声明', () => {
    // 重复的 function 会静默覆盖，重复的 let/const 会直接抛 SyntaxError
    const seenFunc = new Map();
    const seenVar = new Map();
    const dupFunc = [];
    const dupVar = [];
    for (const p of parts) {
      const name = path.basename(p);
      const { funcs, vars } = topLevelDecls(fs.readFileSync(p, 'utf8'));
      for (const f of funcs) {
        if (seenFunc.has(f)) dupFunc.push(`${f} (${seenFunc.get(f)} & ${name})`);
        else seenFunc.set(f, name);
      }
      for (const v of vars) {
        if (seenVar.has(v)) dupVar.push(`${v} (${seenVar.get(v)} & ${name})`);
        else seenVar.set(v, name);
      }
    }
    assert.deepStrictEqual(dupFunc, [], '重复的顶层函数声明: ' + dupFunc.join(', '));
    assert.deepStrictEqual(dupVar, [], '重复的顶层变量声明（会抛 SyntaxError）: ' + dupVar.join(', '));
  });

  test('关键函数齐全（防止切分时漏掉整块）', () => {
    const src = readAppSource();
    const required = [
      // 渲染与工具
      'esc', 'renderMD', 'dbg', 'toastMsg',
      // API 与 Agent
      'callAPI', 'runStrategist', 'runResearch', 'streamChat', 'streamDict',
      // JSON 解析
      'smartParseJSON', 'parseAIResponse', 'extractChatReply',
      // 版本树
      'makeNode', 'activeVariant', 'getActivePath', 'appendToEnd', 'findNode', 'removeNodeFromTree',
      // 聊天主流程
      'sendMessage', 'callAnalysis', 'stopSending', 'finalizeAbortedReply', 'cancelAnalysisTasks',
      'resendFrom', 'startNewConversation', 'resumeConversation', 'renderSidebar', 'renderMessages',
      // 设置与存储
      'getSetting', 'setSetting', 'saveSettings', 'openSettings', 'logoutUser', 'changePassword',
      // Anki
      'ankiPostCall', 'ankiBaseDeck', 'ankiAddNotesBatch', 'processAnalysisForAnki',
      'syncAnkiReviewData', 'renderAnkiSidebar', 'startWebReview',
      // 词典 / 划词
      'queryDict', 'translateSelection', 'showTip', 'hideTip',
      // 题库
      'loadGaokaoList', 'openGaokaoExam', 'gaokaoPushOne', 'gaokaoPushAll',
      // 模式与首页
      'switchMode', 'showHome', 'switchGameTab',
      // 阅读
      'startReading', 'applyHighlights', 'addHighlight', 'readingTts', 'openReciteInMain',
      // 练习
      'submitWriting', 'submitTranslate', 'submitCharade', 'submitCloze', 'wlSubmit',
      'renderSegments', 'showModuleFeedback',
      // 音乐
      'musicInit', 'toggleMusic', 'musicPlayIdx',
      // 备份
      'backupNow', 'localStorageBackup'
    ];
    const missing = required.filter((fn) => !new RegExp(`^(?:async\\s+)?function\\s+${fn}\\s*\\(`, 'm').test(src));
    assert.deepStrictEqual(missing, [], '缺少关键函数: ' + missing.join(', '));
  });

  test('全局状态变量齐全', () => {
    const src = readAppSource();
    const required = [
      'conversation', 'currentLevel', 'currentTopic', 'isSending', 'selectedMsgId',
      'currentAbort', 'analysisAbort', 'analysisTimers', '_streamThrottle',
      'ankiAutoAdd', 'autoReadAloud', 'streamChatEnabled', 'strategistEnabled', 'executorEnabled',
      'currentMode', 'readingState', 'musicItems', 'webReviewState'
    ];
    const missing = required.filter((v) => !new RegExp(`^(?:const|let|var)\\s+${v}\\b`, 'm').test(src));
    assert.deepStrictEqual(missing, [], '缺少全局状态: ' + missing.join(', '));
  });

  test('切片体积合理（没有巨型残留文件）', () => {
    const sizes = parts.map((p) => ({
      name: path.basename(p),
      lines: fs.readFileSync(p, 'utf8').split('\n').length
    }));
    const tooBig = sizes.filter((s) => s.lines > 1000);
    assert.deepStrictEqual(
      tooBig.map((s) => `${s.name}(${s.lines}行)`),
      [],
      '存在超过 1000 行的切片，应继续拆分'
    );
    // 总行数应与原单体相当（8000+），确保没有整块丢失
    const total = sizes.reduce((a, s) => a + s.lines, 0);
    assert.ok(total > 7000, `切片总行数偏少 (${total})，可能有整块丢失`);
  });

  test('每个切片都有说明头注释', () => {
    for (const p of parts) {
      const head = fs.readFileSync(p, 'utf8').slice(0, 400);
      assert.match(head, /^\/\* =+/, `${path.basename(p)} 缺少头注释`);
      assert.match(head, /由 js\/app\.js 拆分而来/, `${path.basename(p)} 头注释缺少来源说明`);
    }
  });

  test('js/app/ 下没有非切片的游离 .js 文件', () => {
    const all = fs.readdirSync(APP_PARTS_DIR).filter((f) => f.endsWith('.js'));
    const stray = all.filter((f) => !/^\d{2}-[a-z0-9-]+\.js$/.test(f));
    assert.deepStrictEqual(stray, [], 'js/app/ 下存在未被 index.html 加载的游离文件: ' + stray.join(', '));
  });
});

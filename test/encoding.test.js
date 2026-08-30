/* 源文件编码完整性防回归
   ------------------------------------------------------------
   历史事故（2026-08）：在中文 Windows 上用默认 GBK 的工具
   （PowerShell 5.1 Get-Content/Set-Content、cp936 读写）反复
   处理 UTF-8 文件，造成两类不可逆损坏：
   1. 字节层：UTF-8 中文尾字节与紧跟的 ASCII 标点被 GBK 错配，
      失败对坍缩成 0x3F('?') 或 U+FFFD，直接吃掉 '"'、'<'、'/'
      —— 页面里出现 `新对?/button>`、`同步状? style=` 这种断标签。
   2. 显示层：合法的双重编码 mojibake（UTF-8 字节被按 GBK 解释），
      中文变成西里尔/拉丁扩展乱码字符（如 U+0467、U+03F0 等）。
   旧冒烟测试只断言 HTTP 200 / JSON，对字符串乱码全瞎；本测试把
   「字节合法 / 无替换字符 / HTML 标签闭合配平」变成永久红线。
*/
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* 扫描范围内的文本文件：前端 + 后端 + 测试 + 清单 */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (!/^(node_modules|\.git|backups|data)$/.test(name)) walk(p);
      } else if (/\.(js|css|html|json)$/.test(name)) {
        out.push(p);
      }
    }
  };
  out.push(path.join(ROOT, 'index.html'));
  for (const d of ['js', 'css', 'server', 'scripts', 'test']) {
    walk(path.join(ROOT, d));
  }
  out.push(path.join(ROOT, 'package.json'));
  return [...new Set(out)];
}

/* 逐字节做严格 UTF-8 校验，返回坏字节对数量（TextDecoder fatal 模式） */
function invalidUtf8Runs(buf) {
  let runs = 0;
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let need;
    if ((b & 0xe0) === 0xc0) need = 1;
    else if ((b & 0xf0) === 0xe0) need = 2;
    else if ((b & 0xf8) === 0xf0) need = 3;
    else { runs++; i++; continue; }
    let ok = true;
    for (let j = 1; j <= need; j++) {
      if (i + j >= buf.length || (buf[i + j] & 0xc0) !== 0x80) { ok = false; break; }
    }
    if (ok) i += need + 1;
    else { runs++; i++; }
  }
  return runs;
}

describe('源文件编码完整性（UTF-8 防回归）', () => {
  const files = sourceFiles();

  test('扫描范围覆盖前端/后端/测试/清单', () => {
    assert.ok(files.length >= 40, `扫描文件数异常偏少: ${files.length}`);
    assert.ok(files.some((f) => f.endsWith('index.html')));
    assert.ok(files.some((f) => f.replace(/\\/g, '/').includes('js/app/01-core.js')));
  });

  test('每个文件都是合法 UTF-8（无 GBK 坍缩坏字节）', () => {
    const bad = [];
    for (const f of files) {
      const runs = invalidUtf8Runs(fs.readFileSync(f));
      if (runs) bad.push(`${path.relative(ROOT, f)}: ${runs} 处坏字节`);
    }
    assert.deepStrictEqual(bad, [], bad.join('\n'));
  });

  test('任何文件不含 U+FFFD 替换字符', () => {
    const bad = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const n = (text.match(/\uFFFD/g) || []).length;
      if (n) bad.push(`${path.relative(ROOT, f)}: ${n} 处`);
    }
    assert.deepStrictEqual(bad, [], bad.join('\n'));
  });

  test('index.html 无 GBK 坍缩签名 ?/tag> （吃 < 的坏闭合标签）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const m = html.match(/\?\/[a-zA-Z][a-zA-Z0-9]*>/g);
    assert.ok(!m, '发现坍缩的闭合标签（应为 </tag>）: ' + (m || []).join(', '));
  });

  test('index.html 所有非 void 标签开闭数量配平（坏标签会导致不平衡）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, ''); // 去掉注释，避免注释里的 < 干扰
    const voidTags = new Set(['br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'col', 'area', 'base', 'embed', 'track', 'wbr']);
    const opens = {};
    const closes = {};
    for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g)) {
      const tag = m[1].toLowerCase();
      if (voidTags.has(tag)) continue;
      if (/\/>\s*$/.test(m[0])) continue; // 自闭合
      opens[tag] = (opens[tag] || 0) + 1;
    }
    for (const m of html.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g)) {
      const tag = m[1].toLowerCase();
      if (voidTags.has(tag)) continue;
      closes[tag] = (closes[tag] || 0) + 1;
    }
    const names = new Set([...Object.keys(opens), ...Object.keys(closes)]);
    const unbalanced = [];
    for (const tag of names) {
      if ((opens[tag] || 0) !== (closes[tag] || 0)) {
        unbalanced.push(`<${tag}>: 开 ${opens[tag] || 0} / 闭 ${closes[tag] || 0}`);
      }
    }
    assert.deepStrictEqual(unbalanced, [], '标签开闭不配平（通常是 GBK 坍缩吃掉了 < 或 >）:\n' + unbalanced.join('\n'));
  });

  test('中文文案不含 GBK 双重编码 mojibake 字符（Latin-1/Cyrillic 乱码段）', () => {
    // 典型 mojibake 指纹：中文 GBK 误解产生的西里尔字母 U+0467/U+03F0/U+046F、
    // 拉丁扩展 U+0123/U+02B5/U+02B7 等，正常中文源码里不应出现
    const mojibakeHints = [/\u0467/, /\u03F0/, /\u046F/, /\u01FF/, /\u0133/, /\u0123/, /\u02B5/, /\u02B7/];
    const bad = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const re of mojibakeHints) {
        const m = text.match(re);
        if (m) {
          const li = text.slice(0, m.index).split('\n').length;
          bad.push(`${path.relative(ROOT, f)}:${li} 含 mojibake 字符 ${m[0]}`);
          break;
        }
      }
    }
    assert.deepStrictEqual(bad, [], bad.join('\n'));
  });
});

/* 渲染安全：不可信文本（模型输出）不得注入可执行 HTML

   前端是浏览器脚本（无 module.exports），这里按函数名从源码里
   截取 esc / renderMD 的完整定义再求值，避免为了测试改动生产代码。
   源码来自 js/app/ 下所有切片按加载顺序拼接（见 helpers.readAppSource）。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { readAppSource } = require('./helpers');

/* 从源码中按大括号配对截取一个顶层函数定义 */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `未找到函数 ${name}`);
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, `函数 ${name} 缺少函数体`);
  let depth = 0;
  let inStr = null;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && src[i + 1] === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (inTemplate) { if (c === '\\') { i++; continue; } if (c === '`') inTemplate = false; continue; }
    if (inRegex) { if (c === '\\') { i++; continue; } if (c === '/') inRegex = false; continue; }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { inTemplate = true; continue; }
    // 粗略识别正则字面量：'/' 前是运算符/括号/逗号/return 等上下文
    if (c === '/' && /[=(,:[!&|?{};+\s]/.test(prev || '')) { inRegex = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`函数 ${name} 未闭合`);
}

const src = readAppSource();
const sandbox = { esc: null, renderMD: null };
// eslint-disable-next-line no-new-func
new Function('sandbox', `
  ${extractFunction(src, 'esc')}
  ${extractFunction(src, 'renderMD')}
  sandbox.esc = esc;
  sandbox.renderMD = renderMD;
`)(sandbox);

const { esc, renderMD } = sandbox;

describe('esc()', () => {
  test('转义 HTML 元字符', () => {
    assert.strictEqual(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.strictEqual(esc('a & b'), 'a &amp; b');
    assert.strictEqual(esc('"quoted"'), '&quot;quoted&quot;');
  });
});

describe('renderMD() 不得输出可执行 HTML', () => {
  // renderMD 自身会生成的标签（白名单之外出现的都视为注入）
  const ALLOWED_TAGS = new Set([
    'strong', 'em', 'del', 'code', 'pre', 'br', 'a', 'span',
    'h3', 'h4', 'h5', 'blockquote', 'ul', 'ol', 'li'
  ]);

  /* 只检查「真实标签」：所有来自不可信输入的 < 都应已转义成 &lt;，
     因此转义后文本里出现的 onerror= 属于纯文本，不构成执行风险。 */
  function realTags(html) {
    const out = [];
    const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      out.push({ name: m[1].toLowerCase(), attrs: m[2] || '', raw: m[0] });
    }
    return out;
  }

  function assertNoExecutable(html, label) {
    for (const tag of realTags(html)) {
      assert.ok(ALLOWED_TAGS.has(tag.name), `${label}: 出现非白名单标签 <${tag.name}>\n输出: ${html.slice(0, 300)}`);
      assert.ok(!/\son\w+\s*=/i.test(tag.attrs), `${label}: 标签含事件属性 ${tag.raw}\n输出: ${html.slice(0, 300)}`);
      assert.ok(!/javascript:/i.test(tag.attrs), `${label}: 标签含 javascript: ${tag.raw}`);
    }
  }

  test('fenced code block 内的 HTML 被转义（回归：此前未转义）', () => {
    const payloads = [
      '```html\n</pre><img src=x onerror="alert(1)">\n```',
      '```\n<script>alert(1)</script>\n```',
      '```js\n</pre><svg onload=alert(1)>\n```',
      '```\n</pre></div><iframe src="javascript:alert(1)"></iframe>\n```',
      '正常文字\n```\n<img src=x onerror=alert(1)>\n```\n后续文字'
    ];
    for (const p of payloads) {
      const html = renderMD(p);
      assertNoExecutable(html, 'fenced code');
      assert.match(html, /&lt;/, '代码块内容应被转义');
    }
  });

  test('普通正文中的 HTML 被转义', () => {
    for (const p of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<div onclick="alert(1)">click</div>',
      '<svg/onload=alert(1)>'
    ]) {
      assertNoExecutable(renderMD(p), 'plain text');
    }
  });

  test('inline code 中的 HTML 被转义', () => {
    assertNoExecutable(renderMD('这是 `<img src=x onerror=alert(1)>` 代码'), 'inline code');
  });

  test('链接只允许 http(s)，javascript: 不生成 href', () => {
    const bad = renderMD('[click](javascript:alert(1))');
    assert.ok(!/href="javascript:/i.test(bad), 'javascript: 不应成为 href');

    const good = renderMD('[example](https://example.com)');
    assert.match(good, /<a href="https:\/\/example\.com"/);
    assert.match(good, /rel="noopener"/);
  });

  test('数学公式内容被转义', () => {
    const html = renderMD('$<img src=x onerror=alert(1)>$');
    assertNoExecutable(html, 'math inline');
    const block = renderMD('$$\n<script>alert(1)</script>\n$$');
    assertNoExecutable(block, 'math block');
  });

  test('正常 Markdown 仍然渲染', () => {
    assert.match(renderMD('**粗体**'), /<strong>粗体<\/strong>/);
    assert.match(renderMD('# 标题'), /<h3>标题<\/h3>/);
    assert.match(renderMD('- 项目一\n- 项目二'), /<ul>/);
    assert.match(renderMD('```\ncode here\n```'), /<pre class="code-block"><code>/);
  });

  test('空值与非字符串输入不抛异常', () => {
    assert.strictEqual(renderMD(''), '');
    assert.strictEqual(renderMD(null), '');
    assert.strictEqual(renderMD(undefined), '');
    assert.doesNotThrow(() => renderMD(12345));
  });
});

describe('Cloze 句子渲染（回归：模型输出曾直接进 innerHTML）', () => {
  /* clRenderQuestions 依赖大量 DOM/全局状态，这里验证其核心拼接策略：
     按 ____ 切分后两侧都必须经过 esc()。 */
  test('模型返回 HTML 时被转义', () => {
    const raw = '<img src=x onerror=alert(1)> ____ </span><script>alert(2)</script>';
    const cut = raw.indexOf('____');
    const head = raw.slice(0, cut);
    const tail = raw.slice(cut + 4);
    const blank = '<span class="cloze-blank">____</span>';
    const out = esc(head) + '</span>' + blank + '<span>' + esc(tail);

    // 不可信部分必须全部转义；只有我们自己拼接的 span 是真实标签
    assert.ok(!/<img/i.test(out), '不应出现可执行 img');
    assert.ok(!/<script/i.test(out), '不应出现可执行 script');
    const tags = out.match(/<\/?[a-zA-Z][^>]*>/g) || [];
    for (const t of tags) {
      assert.match(t, /^<\/?span/i, `只应出现 span，实际 ${t}`);
      assert.ok(!/\son\w+\s*=/i.test(t), `标签不应含事件属性：${t}`);
    }
    assert.match(out, /&lt;img/);
    assert.ok(out.includes(blank), '空格标签应保留');
  });

  test('没有 ____ 时整体转义', () => {
    const raw = '<b>no blank</b>';
    assert.strictEqual(esc(raw), '&lt;b&gt;no blank&lt;/b&gt;');
  });
});

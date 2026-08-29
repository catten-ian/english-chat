/* ============================================================
   AI 英语对话教练 — 高容忍度 JSON 解析、AI 回复提取
   由 js/app.js 拆分而来（原 629-966 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- JSON Parsing ---------- */
function parseAIResponse(content) {
  if (!content) return { reply: '(empty response)', analysis: null, corrections: [], extensions: [], new_words: [] };
  // Direct parse: could be chat response (has "reply") or analysis response (has "analysis")
  let obj = tryParseJSON(content);
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Strip thinking and try again
  const cleaned = stripThinking(content);
  obj = tryParseJSON(cleaned);
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Extract JSON anchored on "reply" or "analysis"
  obj = extractJSONObject(cleaned, 'reply') || extractJSONObject(cleaned, 'analysis');
  if (obj) {
    if (obj.reply) return obj;
    if (obj.analysis) {
      return {
        reply: obj.reply || '',
        analysis: obj.analysis || null,
        corrections: obj.corrections || [],
        extensions: obj.extensions || [],
        new_words: obj.new_words || []
      };
    }
  }
  // Regex fallback
  const rm = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (rm) {
    const reply = rm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return { reply, analysis: null, corrections: [], extensions: [], new_words: [] };
  }
  return { reply: cleaned.trim() || '(no response)', analysis: null, corrections: [], extensions: [], new_words: [] };
}

function stripThinking(text) {
  if (!text) return '';
  let s = text;
  // Remove <thinking>...</thinking> blocks (with close tag)
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Remove <think>...</think> blocks (MiniMax-M3 emits <think> without "ing")
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove <thinking> prefix (no close tag)
  s = s.replace(/^<thinking>\s*/i, '');
  s = s.replace(/^<think>\s*/i, '');
  // Remove <Thought>...</Thought> blocks
  s = s.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/```(?:json)?[\s\S]*?```/g, '');
  // Strip thinking prefix: "thinking" or "Thought" followed by reasoning
  const thinkStart = s.match(/^\s*(?:thinking|Thought|Reasoning)\s*[:.-]?\s*/i);
  if (thinkStart) {
    let rest = s.slice(thinkStart[0].length);
    // If there's a JSON object, grab from first brace
    const fb = rest.indexOf('{');
    if (fb !== -1) {
      // Only strip up to brace if the prefix before it is long reasoning
      const prefix = rest.slice(0, fb).trim();
      if (prefix.length > 30 || /let me|the user|i should|analy/i.test(prefix)) {
        rest = rest.slice(fb);
      }
    }
    // Split by double newline and take the last meaningful part
    const parts = rest.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 10) {
          rest = parts[i].trim();
          break;
        }
      }
    }
    s = rest;
  }
  // Also handle the case where content starts with reasoning but no "thinking" keyword
  else {
    const fb = s.indexOf('{');
    if (fb > 30) {
      const prefix = s.slice(0, fb).trim();
      if (/^(the user|let me|i should|this is|here's)/i.test(prefix) || prefix.length > 60) {
        s = s.slice(fb);
      }
    }
  }
  return s.trim();
}

function extractJSONObject(text, anchorKey) {
  if (!text) return null;
  const key = anchorKey || 'reply';
  const keyIdx = text.indexOf('"' + key + '"');
  if (keyIdx !== -1) {
    const openBrace = text.lastIndexOf('{', keyIdx);
    const closeBrace = text.lastIndexOf('}');
    if (openBrace !== -1 && closeBrace > openBrace) {
      const obj = tryParseJSON(text.slice(openBrace, closeBrace + 1));
      if (obj && obj[key]) return obj;
    }
  }
  // Fallback: first { to last }
  const fb = text.indexOf('{');
  const lb = text.lastIndexOf('}');
  if (fb !== -1 && lb > fb) {
    const obj = tryParseJSON(text.slice(fb, lb + 1));
    if (obj && (obj[key] || obj.analysis || obj.reply)) return obj;
  }
  return null;
}

/* ============================================================
   高容忍度 JSON 解析：
   直接解析失败 → 剥离思维块/代码围栏/说明文字 → 提取平衡 JSON 块
   → 状态机修复常见不规范（尾逗号、注释、智能引号、单引号、
   未加引号的键、字符串内控制字符）→ 重试解析。
   全部失败时返回 null，调用方可选择重试。
============================================================ */
function tryJSON(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  try {
    const obj = JSON.parse(s);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch (e) { return null; }
}

// 以字符串感知方式提取文本中所有平衡的 JSON 块（{...} 或 [...]）
function extractBalancedBlocks(text) {
  const blocks = [];
  const n = text.length;
  let inStr = false, depth = 0, start = -1;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') {
      if (start === -1) start = i;
      depth++;
    } else if (c === '}' || c === ']') {
      if (start !== -1) {
        depth--;
        if (depth === 0) { blocks.push(text.slice(start, i + 1)); start = -1; depth = 0; }
      }
    }
  }
  if (start !== -1) blocks.push(text.slice(start));   // 未闭合：尽力而为
  return blocks;
}

// 状态机修复常见的不规范 JSON
function repairJSON(s) {
  if (typeof s !== 'string') return s;
  let src = s.replace(/^\uFEFF/, '');
  src = src.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  let out = '';
  let inStr = false;
  let prevSig = '';    // 上一个非空白字符
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') {
        const nx = src[i + 1];
        out += (nx === undefined) ? '\\\\' : ((nx === "'") ? "'" : ('\\' + nx));
        i += 2; continue;
      }
      if (c === '"') { inStr = false; out += c; i++; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); i++; continue; }
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; prevSig = '"'; i++; continue; }
    if (c === "'") {
      // 单引号字符串 → 双引号（带撇号启发式：don't 不当作字符串结束）
      inStr = true; out += '"'; i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') {
          const nx = src[i + 1];
          out += (nx === "'") ? "'" : ('\\' + nx);
          i += 2; continue;
        }
        if (d === "'") {
          const prevIsWord = i > 0 && /[A-Za-z0-9]/.test(src[i - 1]);
          const nextIsWord = i + 1 < n && /[A-Za-z0-9]/.test(src[i + 1]);
          if (prevIsWord && nextIsWord) { out += "'"; i++; continue; }   // 撇号
          inStr = false; out += '"'; i++; break;
        }
        if (d === '"') { out += '\\"'; i++; continue; }
        const dc = d.charCodeAt(0);
        if (dc < 0x20) { out += '\\u' + dc.toString(16).padStart(4, '0'); i++; continue; }
        out += d; i++;
      }
      prevSig = '"'; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === ',') {
      let j = i + 1; while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') { i++; continue; }   // 尾逗号
      out += c; prevSig = ','; i++; continue;
    }
    if (/\s/.test(c)) { out += c; i++; continue; }
    // 未加引号的键：{ 或 , 后紧跟标识符 + :
    if ((prevSig === '{' || prevSig === ',') && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const ident = src.slice(i, j);
      let k = j; while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === ':') { out += '"' + ident + '"'; i = j; prevSig = ident; continue; }
    }
    out += c; prevSig = c; i++;
  }
  return out.trim();
}

// 主入口：高容忍解析。
// 注意：这里用"温和清理"（思维块删除、代码围栏【提取内容而非删除】），
// 而不是 stripThinking（stripThinking 会整体删掉围栏内容，导致围栏内 JSON 丢失）。
function smartParseJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const direct = tryJSON(text);
  if (direct) return direct;
  let cleaned = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');   // 围栏 → 内容
  const direct2 = tryJSON(cleaned);
  if (direct2) return direct2;
  const blocks = extractBalancedBlocks(cleaned);
  // 优先对象块（dict/分析/策略师都是对象），再试数组块
  const ordered = [...blocks.filter(b => b.trim().startsWith('{')), ...blocks.filter(b => b.trim().startsWith('['))];
  for (const block of ordered) {
    const o = tryJSON(block);
    if (o) return o;
    const o2 = tryJSON(repairJSON(block));
    if (o2) return o2;
  }
  return null;
}

function tryParseJSON(s) { return smartParseJSON(s); }

// 调用模型并高容忍解析 JSON；解析失败时自动重试（最多 attempts 次，重试追加严格约束）
async function callAndParseJSON(messages, options, expectedCheck, attempts) {
  attempts = attempts || 3;
  let raw = '';
  const baseSystem = messages[0] ? messages[0].content : '';
  for (let i = 0; i < attempts; i++) {
    const msgs = i === 0 ? messages : [
      { role: 'system', content: baseSystem +
        '\n\nIMPORTANT (retry ' + i + '): Output ONLY a single valid strict JSON object. No markdown fences, no thinking tags, no extra prose, no trailing commas. Use double quotes everywhere.' },
      ...messages.slice(1)
    ];
    raw = await callAPI(msgs, {
      temperature: i === 0 ? (options.temperature ?? 0.4) : 0.15,
      maxTokens: options.maxTokens,
      signal: options.signal
    });
    const obj = smartParseJSON(raw);
    if (obj && (!expectedCheck || expectedCheck(obj))) return { obj, raw };
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 500));
  }
  return { obj: null, raw };
}

/* ---------- Chat Reply Extraction ---------- */
function extractChatReply(content) {
  if (!content) return '';
  let s = content;
  // Remove <thinking>...</thinking> blocks (with close tag)
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // Remove <think>...</think> blocks (MiniMax-M3 emits <think> without "ing")
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove <thinking> prefix (no close tag — MiniMax-M3 sometimes does this)
  s = s.replace(/^<thinking>\s*/i, '');
  s = s.replace(/^<think>\s*/i, '');
  // Remove <Thought>...</Thought> blocks
  s = s.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/```[\s\S]*?```/g, '');
  // If starts with "thinking" or "Thought" keyword, strip the reasoning section
  const thinkMatch = s.match(/^\s*(?:thinking|Thought|reasoning)\s*[:.-]?\s*([\s\S]*)/i);
  if (thinkMatch) {
    let rest = thinkMatch[1].trim();
    const parts = rest.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 10) {
          rest = parts[i].trim();
          break;
        }
      }
    }
    s = rest;
  } else {
    // No "thinking" keyword found — the content might be <thinking>tag + reasoning + answer
    // Split by double newline and take the last meaningful paragraph
    const parts = s.split(/\n\s*\n/);
    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim().length > 15) {
          s = parts[i].trim();
          break;
        }
      }
    }
  }
  // If it looks like JSON with a reply, extract it
  if (s.includes('"reply"')) {
    const obj = extractJSONObject(s);
    if (obj && obj.reply) return obj.reply;
  }
  return s.trim();
}

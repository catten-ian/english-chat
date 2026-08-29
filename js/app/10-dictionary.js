/* ============================================================
   AI 英语对话教练 — 词典 / 翻译查询与历史
   由 js/app.js 拆分而来（原 3829-4119 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Dictionary / Translator ---------- */
// 词典查询历史记录（最多 12 条，存 localStorage）
function saveDictHistory(text, feedbackHtml) {
  if (!text) return;
  const list = getSetting('dictHistory', []);
  const item = { text, t: Date.now() };
  if (feedbackHtml) item.feedback = feedbackHtml;
  const idx = list.findIndex(x => x.text === text);
  if (idx >= 0) {
    list.splice(idx, 1);
    // 旧的 feedback 也丢弃，让最新一次的结果生效
  }
  list.unshift(item);
  setSetting('dictHistory', list.slice(0, 12));
}

function renderDictHistory() {
  const el = document.getElementById('dictHistory');
  if (!el) return;
  const list = getSetting('dictHistory', []);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="font-size:10px;color:var(--text2);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">' +
    '🕘 查询历史（点击查看反馈）' +
    '<span data-action="clear-dict-history" style="cursor:pointer;color:var(--text2);font-size:10px" title="清空历史">🗑️ 清空</span>' +
    '</div>' +
    list.map((x, i) => {
      const tm = new Date(x.t || Date.now());
      const ts = (tm.getMonth() + 1) + '-' + tm.getDate() + ' ' + String(tm.getHours()).padStart(2, '0') + ':' + String(tm.getMinutes()).padStart(2, '0');
      const hasFeedback = !!x.feedback;
      return '<div style="padding:2px 4px;border-radius:4px;line-height:1.5">' +
        '<div data-action="query-dict-history" data-arg1="' + i + '" title="点击重新查询" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;white-space:nowrap">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;user-select:none">' + esc(x.text.length > 28 ? x.text.substring(0, 28) + '…' : x.text) + '</span>' +
        '<span style="color:var(--text3);font-size:10px;flex-shrink:0;margin-left:6px">' + ts + '</span></div>' +
        (hasFeedback ? '<div data-action="toggle-dict-feedback" data-arg1="' + i + '" style="font-size:10px;color:var(--primary);cursor:pointer;margin-top:2px;user-select:none">📋 查看上次反馈</div>' +
          '<div id="dictFb_' + i + '" style="display:none;margin-top:4px;padding:6px;background:var(--surface);border:1px solid var(--border);border-radius:6px;max-height:200px;overflow-y:auto;font-size:11px">' + x.feedback + '</div>' : '') +
        '</div>';
    }).join('');
}

function toggleDictFeedback(i) {
  const el = document.getElementById('dictFb_' + i);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function clearDictHistory() {
  setSetting('dictHistory', []);
  renderDictHistory();
}

function queryDictFromHistory(idx) {
  const list = getSetting('dictHistory', []);
  const item = list[idx];
  if (!item) return;
  const input = document.getElementById('dictInput');
  if (input) { input.value = item.text; input.focus(); }
  queryDict();
}

function updateDictContext() {
  const el = document.getElementById('dictContext');
  const lastMsgs = getActivePath().slice(-20).map(m => m.role === 'user' ? '我: ' + (m.content || '').substring(0, 100) : 'Alex: ' + (m.content || '').substring(0, 100));
  if (lastMsgs.length) el.textContent = '📌 对话上下文（最近' + lastMsgs.length + '条）';
  else el.textContent = '';
  el.title = lastMsgs.join(' | ');
}

async function queryDict() {
  const input = document.getElementById('dictInput');
  let text = input.value.trim();
  if (!text) return;
  // Detect /ask command
  const isAsk = text.startsWith('/ask ');
  if (isAsk) text = text.slice(5).trim();
  const btn = document.getElementById('dictBtn');
  const resultEl = document.getElementById('dictResult');
  btn.disabled = true;
  btn.textContent = '查询中...';
  resultEl.innerHTML = '<div class="loading">⏳ 查询中...</div>';

  // Add conversation context for dictionary
  let contextText = '';
  const ctxMsgs = getActivePath().slice(-20);
  if (ctxMsgs.length) {
    contextText = '\n\nConversation context (recent messages for reference):\n' + ctxMsgs.map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '').substring(0, 200)).join('\n');
  }

  // Detect mode
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  const isQuestion = /[?？]/.test(text) || /^(如何|怎么|什么|为什么|能不能|what|how|why|can|is|does)/i.test(text.trim());
  const isEnglishWord = /^[a-zA-Z\s'-]+$/.test(text) && text.split(/\s+/).length <= 3 && !isQuestion;
  const isEnglishSentence = /^[a-zA-Z\s',.!?;-]+$/.test(text) && text.split(/\s+/).length > 3 && !isQuestion;

  try {
    let systemPrompt, maxTokens = 4500;
    // Add conversation context for all queries
    const context = getActivePath().slice(-20).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
    const contextBlock = context ? '\n\nConversation context (for reference):\n' + context : '';

    if (isAsk) {
      // /ask: answer a question about English with structured output
      systemPrompt = 'You are an English tutor. Answer the user\'s question about English in detail. Provide structured output with vocabulary, phrases, and learning points. Return ONLY valid JSON:\n{\n  "type": "ask",\n  "question": "the question",\n  "answer": "detailed answer in Chinese, with explanations and examples",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "knowledge point", "suggestion": "how to improve"}]\n}' + contextBlock;
    } else if (hasChinese && !isEnglishWord) {
      // Chinese → English translation with multiple expressions
      systemPrompt = 'You are a professional translator and English teacher. Translate the Chinese input into English, providing MULTIPLE expression options at different levels. Return ONLY valid JSON:\n{\n  "type": "zh2en",\n  "original": "the Chinese input",\n  "translations": [{"level": "基础/自然/地道/高级", "text": "English expression", "note": "brief usage note in Chinese"}],\n  "key_phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "generalizable knowledge point", "suggestion": "how to improve"}]\n}';
    } else if (isEnglishWord) {
      // English word dictionary
      systemPrompt = 'You are a dictionary assistant. For the given English word/phrase, provide a detailed dictionary entry in Chinese. If the word is a morphological variant (plural, past tense, -ing, etc.), show the base/lemma form as the main entry and list all variants. Return ONLY valid JSON:\n{\n  "type": "dict",\n  "word": "base form",\n  "input": "the original selected text",\n  "phonetic": "/IPA/",\n  "part": "词性",\n  "variants": {"plural": "forms", "past": "forms", "present": "forms", "comparative": "forms"} as applicable,\n  "meanings": ["释义1", "释义2"],\n  "examples": [{"en": "English sentence", "zh": "中文翻译"}],\n  "collocations": ["搭配1 (翻译)", "搭配2 (翻译)"],\n  "synonyms": [{"word": "同义词", "note": "辨析说明"}],\n  "etymology": "word origin explanation in Chinese",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}]\n}';
    } else if (isEnglishSentence || isQuestion) {
      // English sentence analysis or question
      systemPrompt = 'You are an English tutor. Analyze the given English text or answer the question. Provide translation, breakdown, key vocabulary, and learning points. Return ONLY valid JSON:\n{\n  "type": "analysis",\n  "original": "the input",\n  "translation": "Chinese translation (if applicable)",\n  "answer": "answer to the question (if applicable)",\n  "breakdown": "analysis in Chinese",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning"}],\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point in Chinese"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "generalizable knowledge point", "suggestion": "how to improve"}]\n}';
    } else {
      systemPrompt = 'You are an English assistant. Answer the user\'s query about English, providing clear explanations in Chinese. Return ONLY valid JSON:\n{\n  "type": "query",\n  "answer": "detailed answer in Chinese",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "...", "content": "learning point"}],\n  "weak_points": [{"category": "grammar|collocation|vocabulary", "point": "knowledge point", "suggestion": "how to improve"}]\n}';
    }

    const messages = [
      { role: 'system', content: systemPrompt + '\n\nIMPORTANT: No markdown, no thinking, no extra text. Only valid JSON.' },
      { role: 'user', content: text }
    ];
    let accText = '';
    let obj = null;
    const seenFields = new Set();
    // 手动超时控制器（60s）
    const timeoutCtrl = new AbortController();
    const timeoutId2 = setTimeout(() => timeoutCtrl.abort(), 60000);
    try {
      const full = await streamDict(messages, { temperature: 0.4, maxTokens: maxTokens }, (d) => {
        accText += d;
        const cleanAcc = stripThinking(accText);
        if (cleanAcc === accText && !accText.includes('"')) {
          resultEl.innerHTML = '<pre style="font-size:12px;white-space:pre-wrap;max-height:30vh;overflow-y:auto;margin:0;color:var(--text2);background:var(--bg);padding:8px;border-radius:8px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
        } else {
          let incrementalHtml = '';
          const fieldsToCheck = ['type', 'word', 'input', 'phonetic', 'part', 'original', 'translation', 'breakdown', 'meaning', 'answer', 'question_suggestion'];
          for (const k of fieldsToCheck) {
            if (seenFields.has(k)) continue;
            const rawVal = extractBalancedValue(cleanAcc, k);
            if (rawVal) {
              seenFields.add(k);
              try { incrementalHtml += renderDictField(k, JSON.parse(rawVal), ''); } catch (e) { incrementalHtml += renderDictField(k, rawVal, ''); }
            }
          }
          const rawHtml = '<pre style="font-size:12px;white-space:pre-wrap;max-height:30vh;overflow-y:auto;margin:6px 0 0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
          resultEl.innerHTML = (incrementalHtml || '<div class="loading" style="padding:8px">⏳ 查询中...</div>') + rawHtml;
        }
      }, timeoutCtrl.signal);
      clearTimeout(timeoutId2);
      obj = smartParseJSON(full);
    } catch (e) {
      clearTimeout(timeoutId2);
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      dbg('DICT_STREAM_ERR', e.message);
    }
    if (!obj) {
      const retried = await callAndParseJSON(messages, { temperature: 0.4, maxTokens: maxTokens }, (o) => o && typeof o.type === 'string');
      obj = retried.obj;
      if (retried.raw) accText = retried.raw;
    }
    const cleaned = stripThinking(accText);

    // Track weak points
    if (obj && obj.weak_points) {
      obj.weak_points.forEach(wp => addWeakPoint(wp.category || '词汇', wp.point || ''));
    }

    let html = '';
    if (obj && obj.type === 'zh2en') {
      html += '<div class="dict-section"><h4>📝 翻译</h4><div style="font-size:13px;color:var(--text2);margin-bottom:8px">' + esc(obj.original) + '</div>';
      if (obj.translations) {
        obj.translations.forEach(t => {
          const level = t.level || '';
          const cls = level.includes('基础') ? 'basic' : level.includes('自然') ? 'natural' : 'advanced';
          const w = esc((t.text || '').replace(/'/g, "\\'"));
          const m = esc((t.note || level || '翻译').replace(/'/g, "\\'"));
          html += '<div class="dict-level ' + cls + '"><div class="dl-label">' + esc(level) + '</div><div class="dl-text">' + esc(t.text) + '</div>';
          if (t.note) html += '<div class="dl-note">' + esc(t.note) + '</div>';
          html += '<button data-action="quick-add-anki" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="margin-top:4px;border:none;background:var(--green);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚 Anki</button><button data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="margin-top:4px;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer">+ 加入生词本</button></div>';
        });
      }
      if (obj.key_phrases) {
        html += '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">';
        obj.key_phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, "\\'"));
          const m = esc((p.meaning || '').replace(/'/g, "\\'"));
          html += '<span class="dict-phrase" data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2"><span class="dp-add">+</span> ' + esc(p.phrase) + ' <span style="font-size:10px;color:var(--text2)">' + esc(p.meaning) + '</span></span>';
        });
        html += '</div>';
      }
      html += '</div>';
    } else if (obj && obj.type === 'dict') {
      html += '<div class="dict-section"><h4>📖 词典</h4>';
      html += '<div style="font-weight:700;font-size:16px;margin-bottom:4px">' + esc(obj.word) + '</div>';
      if (obj.phonetic) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">' + esc(obj.phonetic) + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      if (obj.variants && typeof obj.variants === 'object') {
        const v = Object.entries(obj.variants).filter(([k, val]) => val);
        if (v.length) {
          html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>变形:</strong> ' + v.map(([k, val]) => esc(val)).join(' · ');
          html += '</div>';
        }
      }
      if (obj.meanings) html += obj.meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m) + '</div>').join('');
      if (obj.examples) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>常见搭配</strong></div>';
        obj.collocations.forEach(c => html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>');
      }
      if (obj.synonyms) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)"><strong>同义词辨析</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.word) + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
      if (obj.etymology) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📜 词源</strong><div style="line-height:1.6;margin-top:2px">' + esc(obj.etymology) + '</div></div>';
      }
      html += '</div>';
    } else if (obj && (obj.type === 'analysis' || obj.type === 'query')) {
      if (obj.original) html += '<div class="dict-section"><h4>📝 ' + (obj.type === 'analysis' ? '分析' : '回答') + '</h4>';
      if (obj.original) html += '<div style="font-size:13px;color:var(--text2);margin-bottom:6px">' + esc(obj.original) + '</div>';
      if (obj.translation) html += '<div style="font-size:13px;color:var(--green);margin-bottom:6px"><strong>翻译</strong> ' + esc(obj.translation) + '</div>';
      if (obj.answer) html += '<div style="font-size:13px;line-height:1.6;margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px" class="md-content">' + renderMD(obj.answer, 'markdown') + '</div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:8px;padding:8px;background:var(--bg);border-radius:8px">' + esc(obj.breakdown) + '</div>';
      html += '</div>';
      if (obj.vocab && obj.vocab.length) {
        html += '<div class="dict-section"><h4>📖 词汇</h4>';
        obj.vocab.forEach(v => {
          const w = esc((v.word || '').replace(/'/g, "\\'"));
          const m = esc((v.meaning || '').replace(/'/g, "\\'"));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>' + esc(v.word) + '</strong>';
          if (v.part) html += ' <span style="font-size:10px;color:var(--text2)">' + esc(v.part) + '</span>';
          html += ' — ' + esc(v.meaning || '');
          if (v.note) html += '<br><span style="color:var(--text2)">' + esc(v.note) + '</span>';
          html += '<button data-action="quick-add-anki" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
        html += '</div>';
      }
      if (obj.phrases && obj.phrases.length) {
        html += '<div class="dict-section"><h4>🔤 常用搭配</h4>';
        obj.phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, "\\'"));
          const m = esc((p.meaning || '').replace(/'/g, "\\'"));
          html += '<span class="dict-phrase" data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2"><span class="dp-add">+</span> ' + esc(p.phrase) + ' <span style="font-size:10px;color:var(--text2)">' + esc(p.meaning) + '</span></span>';
        });
        html += '</div>';
      }
    } else if (obj && obj.answer) {
      html += '<div style="font-size:13px;line-height:1.6;padding:8px;background:var(--primary-bg);border-radius:8px" class="md-content">' + renderMD(obj.answer, 'markdown') + '</div>';
    } else {
      html = esc(cleaned || raw);
    }

    // Extensions
    if (obj && obj.extensions && obj.extensions.length) {
      html += '<div class="dict-section"><h4>💡 拓展知识</h4>';
      obj.extensions.forEach(e => {
        html += '<div class="dict-ext" style="background:var(--green-bg);padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.6">';
        html += '<span class="ext-type" style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--green)">' + esc(e.type || 'knowledge') + '</span>';
        if (e.title) html += ' <strong>' + esc(e.title) + '</strong>';
        html += '<div style="margin-top:2px">' + esc(e.content) + '</div></div>';
      });
      html += '</div>';
    }

    resultEl.innerHTML = html;
    saveDictHistory(text, html);
    // Track weak points from dict
    if (obj && obj.weak_points) {
      obj.weak_points.forEach(wp => addWeakPoint(wp.category || '词汇', wp.point || ''));
    }
  } catch (err) {
    resultEl.innerHTML = '<div style="color:var(--red);font-size:13px;padding:12px">⚠️ 查询失败: ' + esc(err.message.substring(0, 100)) + '</div>';
    dbg('DICT_ERR', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '查询';
  }
}

/* ============================================================
   AI 英语对话教练 — TTS、划词翻译浮层、调试导出、右侧面板页签
   由 js/app.js 拆分而来（原 2943-3642 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- TTS ---------- */
async function speakText(btn) {
  // 同一按钮正在播放 → 停止；在别处朗读时点击 → 发起新朗读，AudioManager 会替换旧的并复位旧按钮
  if (btn.classList.contains('playing')) { AudioManager.stopSpeech(); return; }
  const text = btn.getAttribute('data-text');
  if (!text) return;
  btn.classList.add('loading');
  btn.innerHTML = '⏳ 生成中...';
  try {
    // Use backend TTS proxy (same-origin, avoids CORS)
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/tts/' + ELEVEN_VOICE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch(e) {}
      throw new Error('TTS ' + res.status + ': ' + detail.substring(0, 100));
    }
    const blob = await res.blob();
    btn.classList.remove('loading');
    btn.classList.add('playing');
    btn.innerHTML = '🔊 播放中...';
    // 统一走 AudioManager：替换上一段朗读、朗读期间压低背景音乐、结束后恢复
    AudioManager.speakBlob(blob, function () {
      btn.classList.remove('playing');
      btn.innerHTML = '🔊 朗读';
    });
  } catch (err) {
    btn.classList.remove('loading');
    btn.innerHTML = '🔊 失败';
    dbg('TTS_ERR', err.message);
    console.error('TTS error:', err);
    setTimeout(() => { btn.innerHTML = '🔊 朗读'; }, 3000);
  }
}

/* ---------- Translation ---------- */
document.getElementById('messages').addEventListener('mouseup', function(e) {
  if (document.body.classList.contains('floating-panel-open') || sidebarOpen) return;
  const selection = window.getSelection();
  const selected = selection.toString().trim();
  if (!selected || selected.length > 200) return;
  const bubble = e.target.closest('.ai-bubble');
  if (!bubble) return;
  tipSelected = selected;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  showTip(rect, selected);
  // Detect mode: word, phrase, or sentence
  const wordCount = selected.trim().split(/\s+/).length;
  const hasSentencePunct = /[,.!?;:。！？]/.test(selected);
  const hasChinese = /[\u4e00-\u9fff]/.test(selected);
  const isPhrase = wordCount >= 2 && wordCount <= 4 && !hasSentencePunct && !hasChinese;
  const isSentence = wordCount > 4 || hasSentencePunct || hasChinese;
  // Add 6 conversation context messages
  const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
  const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
  translateSelection(selected, isSentence, isPhrase, contextBlock);
});

/* ---------- 点击单词 → 划词翻译（无需手动拖动选择） ---------- */
function wordAtPoint(x, y) {
  if (!document.caretRangeFromPoint) return null;
  const rng = document.caretRangeFromPoint(x, y);
  if (!rng) return null;
  const node = rng.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent || '';
  let off = rng.startOffset;
  let start = off, end = off;
  while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--;
  while (end < text.length && /[A-Za-z']/.test(text[end])) end++;
  const word = text.substring(start, end);
  if (!/[A-Za-z]/.test(word)) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return { word, range };
}

document.getElementById('messages').addEventListener('click', function(e) {
  if (document.body.classList.contains('floating-panel-open') || sidebarOpen) return;
  if (e.target.closest('button, a, .msg-actions, .variant-switcher, .msg-btn, #translateTip')) return;
  const bubble = e.target.closest('.ai-bubble, .user-bubble');
  if (!bubble) return;
  const sel = window.getSelection();
  if (sel && sel.toString().trim().length > 0) return;   // 有划选时交给 mouseup 流程
  const hit = wordAtPoint(e.clientX, e.clientY);
  if (!hit) return;
  sel.removeAllRanges();
  sel.addRange(hit.range);          // 视觉高亮该单词
  tipSelected = hit.word;
  showTip(hit.range.getBoundingClientRect(), hit.word);
  const ctx = getActivePath().slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Alex: ') + (m.content || '')).join('\n');
  const contextBlock = ctx ? '\n\nRelevant conversation context:\n' + ctx : '';
  translateSelection(hit.word, false, false, contextBlock);
});

async function translateSelection(text, isSentence, isPhrase, contextBlock) {
  const wordEl = document.getElementById('tipWord');
  const meanEl = document.getElementById('tipMeaning');
  const tipAdd = document.getElementById('tipAdd');
  wordEl.textContent = text;
  if (translateCache[text]) {
    meanEl.innerHTML = translateCache[text];
    repositionTip();
    return;
  }
  meanEl.innerHTML = '<span class="loading">翻译中...</span>';
  try {
    let systemPrompt, maxTokens;
    if (isPhrase) {
      tipAdd.textContent = '选词添加';
      systemPrompt = 'You are a dictionary assistant. For the given English phrase/collocation, provide a detailed entry. If the phrase is a phrasal verb or collocation, treat it as a whole unit. Return ONLY valid JSON:\n{\n  "type": "phrase",\n  "phrase": "the full phrase",\n  "meaning": "Chinese meaning of the phrase",\n  "part": "phrase type (phrasal verb / collocation / idiom)",\n  "breakdown": "explanation of each word\'s role in the phrase, in Chinese",\n  "examples": [{"en": "English sentence using the phrase", "zh": "中文翻译"}],\n  "collocations": ["related phrases"],\n  "synonyms": [{"phrase": "similar phrase", "note": "difference in Chinese"}]\n}' + contextBlock;
      maxTokens = 1200;
    } else if (isSentence) {
      tipAdd.textContent = '选词添加';
      systemPrompt = 'You are an English tutor. Analyze the given English sentence and provide: 1) Chinese translation, 2) Grammar/structure breakdown, 3) Key vocabulary with explanations, 4) Useful phrases. Return ONLY valid JSON (no markdown, no thinking):\n{\n  "type": "sentence",\n  "original": "the sentence",\n  "translation": "Chinese translation",\n  "breakdown": "Grammar/structure analysis in Chinese",\n  "vocab": [{"word": "word", "meaning": "Chinese meaning", "part": "part of speech", "note": "usage note in Chinese"}],\n  "phrases": [{"phrase": "phrase", "meaning": "Chinese meaning", "usage": "how to use it"}]\n}' + contextBlock;
      maxTokens = 4500;
    } else {
      tipAdd.textContent = '加入生词本';
      systemPrompt = 'You are a dictionary assistant. For the given English word/phrase, provide a detailed dictionary entry in Chinese. If the word is a morphological variant (plural, past tense, -ing, etc.), show the base/lemma form as the main entry and list all variants. Return ONLY valid JSON (no markdown, no thinking):\n{\n  "word": "base form",\n  "input": "the original selected text",\n  "phonetic": "/IPA/",\n  "part": "词性 (n./v./adj./adv.)",\n  "variants": {"plural": "forms", "past": "forms", "present": "forms", "comparative": "forms"} as applicable,\n  "meanings": ["释义1", "释义2"],\n  "examples": [{"en": "English sentence", "zh": "中文翻译"}],\n  "collocations": ["搭配1 (翻译)", "搭配2 (翻译)"],\n  "synonyms": [{"word": "同义词", "note": "辨析说明"}],\n  "etymology": "word origin explanation in Chinese"\n}' + contextBlock;
      maxTokens = 1000;
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];
    // 流式输出 → 增量渲染字段，完成后解析；失败时非流式重试
    let accText = '';
    let obj = null;
    const seenFields = new Set();   // 已渲染的字段名
    // 手动超时控制器（60s）
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
    try {
      const full = await streamDict(messages, { temperature: 0.3, maxTokens: maxTokens, thinking: { type: 'disabled' } }, (d) => {
        accText += d;
        const cleanAcc = stripThinking(accText);   // 去掉 thinking 前缀，避免干扰字段检测
        if (cleanAcc === accText && !accText.includes('"')) {
          // 模型还在思考，只显示原始文本
          meanEl.innerHTML = '<pre style="font-size:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin:0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
        } else {
          // 增量渲染：检测已完成的字段并显示
          let incrementalHtml = '';
          const fieldsToCheck = ['type', 'word', 'input', 'phonetic', 'part', 'phrase', 'original', 'translation', 'breakdown', 'meaning', 'question_suggestion'];
          for (const k of fieldsToCheck) {
            if (seenFields.has(k)) continue;
            const rawVal = extractBalancedValue(cleanAcc, k);
            if (rawVal) {
              seenFields.add(k);
              try { incrementalHtml += renderDictField(k, JSON.parse(rawVal), ''); } catch (e) { incrementalHtml += renderDictField(k, rawVal, ''); }
            }
          }
          const rawHtml = '<pre style="font-size:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin:6px 0 0;color:var(--text2);background:var(--bg);padding:4px 6px;border-radius:6px;font-family:inherit;font-size:11px;line-height:1.4">' + esc(accText) + '</pre>';
          meanEl.innerHTML = (incrementalHtml || '<span class="loading">翻译中...</span>') + rawHtml;
        }
        repositionTip();
      }, timeoutController.signal);
      clearTimeout(timeoutId);
      obj = smartParseJSON(full);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      dbg('TIPS_STREAM_ERR', e.message);
    }
    if (!obj) {
      const retried = await callAndParseJSON(messages, { temperature: 0.3, maxTokens: maxTokens }, (o) => o && (o.type || o.word));
      obj = retried.obj;
      if (retried.raw) accText = retried.raw;
    }
    let html;
    if (obj && obj.type === 'sentence') {
      html = '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--primary)">📝 句子分析</div>';
      html += '<div style="font-size:13px;margin-bottom:4px"><strong>原文</strong><br>' + esc(obj.original) + '</div>';
      html += '<div style="font-size:13px;margin-bottom:8px;color:var(--green)"><strong>翻译</strong><br>' + renderMD(obj.translation, 'markdown') + '</div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px;line-height:1.6" class="md-content">' + renderMD(obj.breakdown, 'markdown') + '</div>';
      if (obj.vocab && obj.vocab.length) {
        html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📖 词汇</strong></div>';
        obj.vocab.forEach(v => {
          const w = esc((v.word || '').replace(/'/g, '\\\''));
          const m = esc((v.meaning || '').replace(/'/g, '\\\''));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong style="color:var(--text)">' + esc(v.word) + '</strong>';
          if (v.part) html += ' <span style="font-size:10px;color:var(--text2)">' + esc(v.part) + '</span>';
          html += ' — ' + esc(v.meaning || '');
          if (v.note) html += '<br><span style="color:var(--text2)">' + esc(v.note) + '</span>';
          html += '<button data-action="quick-add-anki" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--primary);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
      }
      if (obj.phrases && obj.phrases.length) {
        html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>🔤 常用搭配</strong></div>';
        obj.phrases.forEach(p => {
          const w = esc((p.phrase || '').replace(/'/g, '\\\''));
          const m = esc((p.meaning || '').replace(/'/g, '\\\''));
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px;padding:6px 8px;background:var(--green-bg);border-radius:6px">';
          html += '<strong style="color:var(--green)">' + esc(p.phrase) + '</strong> — ' + esc(p.meaning || '');
          if (p.usage) html += '<br><span style="color:var(--text2)">' + esc(p.usage) + '</span>';
          html += '<button data-action="quick-add-anki" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px" title="添加到 Anki">📚</button><button data-action="quick-add-vocab" data-arg1="' + w + '" data-arg2="' + m + '" data-argc="2" style="float:right;border:none;background:var(--green);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer">+</button>';
          html += '</div>';
        });
      }
    } else if (obj && obj.type === 'phrase') {
      html = '<div style="font-weight:700;font-size:16px;margin-bottom:6px;color:var(--primary)">' + esc(obj.phrase || obj.original || '') + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      if (obj.meaning) html += '<div style="font-size:14px;margin-bottom:6px;color:var(--green)"><strong>' + esc(obj.meaning) + '</strong></div>';
      if (obj.breakdown) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--primary-bg);border-radius:8px;line-height:1.6">' + esc(obj.breakdown) + '</div>';
      if (obj.examples && obj.examples.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations && obj.collocations.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>相关搭配</strong></div>';
        obj.collocations.forEach(c => html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>');
      }
      if (obj.synonyms && obj.synonyms.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>近义表达</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.phrase || s.word || '') + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
    } else if (obj && obj.word) {
      html = '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(obj.word) + '</div>';
      if (obj.phonetic) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.phonetic) + '</div>';
      if (obj.part) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(obj.part) + '</div>';
      // Show variants
      if (obj.variants && typeof obj.variants === 'object') {
        const v = Object.entries(obj.variants).filter(([k, val]) => val);
        if (v.length) {
          html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;padding:6px 8px;background:var(--bg);border-radius:6px">';
          html += '<strong>变形:</strong> ' + v.map(([k, val]) => esc(val)).join(' · ');
          html += '</div>';
        }
      }
      if (obj.meanings && obj.meanings.length) {
        html += '<div style="margin-bottom:6px">' + obj.meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m) + '</div>').join('') + '</div>';
      }
      if (obj.examples && obj.examples.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>例句</strong></div>';
        obj.examples.forEach(ex => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:4px">';
          if (ex.en) html += '<div style="color:var(--text)">' + esc(ex.en) + '</div>';
          if (ex.zh) html += '<div style="color:var(--text2)">' + esc(ex.zh) + '</div>';
          html += '</div>';
        });
      }
      if (obj.collocations && obj.collocations.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>常见搭配</strong></div>';
        obj.collocations.forEach(c => {
          html += '<div style="font-size:12px;line-height:1.6">• ' + esc(c) + '</div>';
        });
      }
      if (obj.synonyms && obj.synonyms.length) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>同义词辨析</strong></div>';
        obj.synonyms.forEach(s => {
          html += '<div style="font-size:12px;line-height:1.6;margin-top:3px"><strong>' + esc(s.word || '') + '</strong>';
          if (s.note) html += ' — ' + esc(s.note);
          html += '</div>';
        });
      }
      if (obj.etymology) {
        html += '<div style="font-size:12px;color:var(--text2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong>📜 词源</strong><div style="line-height:1.6;margin-top:2px">' + esc(obj.etymology) + '</div></div>';
      }
    } else {
      // Fallback: try to extract readable content from the response
      html = renderDictFallback(stripThinking(accText), text);
    }
    // Only cache single-word lookups; sentence/phrase meanings are context-dependent
    if (!isPhrase && !isSentence) translateCache[text] = html;
    meanEl.innerHTML = html;
    repositionTip();
  } catch (err) {
    meanEl.innerHTML = '<span style="color:var(--red)">翻译失败: ' + esc(err.message.substring(0, 60)) + '</span>';
  }
}

function quickAddVocab(word, meaning) {
  const v = getVocab();
  if (!v.some(i => i.word && i.word.toLowerCase() === word.toLowerCase())) {
    // 提取原句作为语境
    const selection = window.getSelection();
    let context = word;
    if (selection && selection.rangeCount) {
      const rng = selection.getRangeAt(0);
      const container = rng.startContainer;
      if (container && container.textContent && container.textContent !== word) {
        const fullText = container.textContent;
        const idx = fullText.indexOf(word);
        if (idx >= 0) {
          const start = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
          const end = fullText.indexOf('.', idx + word.length);
          context = fullText.slice(start, end >= 0 ? end + 1 : undefined).trim();
        }
      }
    }
    v.push({ word: word, translation: meaning || '', context: context, added: new Date().toISOString().slice(0, 10) });
    saveVocab(v);
    renderVocab();
  }
}

/* 快速添加到 Anki（词典模式用） */
async function quickAddToAnki(word, meaning) {
  if (!word) return;
  const ctx = window.getSelection()?.toString() || word;
  try {
    await ensureQuizModelAndDeck();
    // 默写题型：Front=中文释义，Back=英文单词+语境
    const frontText = meaning || word;
    const backText = word + '\n\n💬 语境：' + ctx.substring(0, 120);
    const res = await ankiAddNotesBatch([{
      deckName: ankiVocabDeck(), modelName: VOCAB_MODEL,
      fields: { Front: frontText, Back: backText },
      tags: [ankiUserTag(), 'vocabulary']
    }]);
    if (res.added > 0) toastMsg('📚 已添加到 Anki 词汇牌组');
    else toastMsg('📚 卡片已存在，已跳过');
  } catch (e) { toastMsg('❌ 添加到 Anki 失败：' + (e.message || '')); }
}

/* ---------- Fallback render for unparseable JSON ---------- */
function renderDictFallback(text, inputWord) {
  // Try to extract key fields with regex
  let html = '';
  // 如果文本是 JSON，格式化显示
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      html += '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">⚠️ 解析为结构化数据失败，以下为原始JSON</div>';
      html += '<pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;max-height:50vh;overflow-y:auto;margin:0;line-height:1.5">' + esc(JSON.stringify(parsed, null, 2)) + '</pre>';
      return html;
    } catch (e) { /* fall through to regex */ }
  }
  // Extract word
  const wm = text.match(/"word"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (wm) {
    html += '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(wm[1]) + '</div>';
  } else {
    html += '<div style="font-weight:700;font-size:16px;margin-bottom:6px">' + esc(inputWord) + '</div>';
  }
  // Extract phonetic
  const pm = text.match(/"phonetic"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (pm) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(pm[1]) + '</div>';
  // Extract part of speech
  const ptm = text.match(/"part"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (ptm) html += '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc(ptm[1]) + '</div>';
  // Extract meanings
  const mm = text.match(/"meanings"\s*:\s*\[([\s\S]*?)\]/);
  if (mm) {
    const meanings = mm[1].match(/"((?:[^"\\]|\\.)*)"/g);
    if (meanings) {
      html += '<div style="margin-bottom:6px">' + meanings.map(m => '<div style="font-size:13px;line-height:1.6">• ' + esc(m.replace(/^"|"$/g, '')) + '</div>').join('') + '</div>';
    }
  }
  // If nothing was extracted, show the text in a code block
  if (!html) {
    html = '<pre style="font-size:11px;color:var(--text2);white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px;max-height:200px;overflow-y:auto">' + esc(text) + '</pre>';
  }
  return html;
}

function repositionTip() {
  const tip = document.getElementById('translateTip');
  if (tip.style.display !== 'flex' && !tip.classList.contains('tip-visible')) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  let x = parseInt(tip.style.left) || 0;
  let y = parseInt(tip.style.top) || 0;
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  // Clamp to viewport
  if (x + tipW > vw - margin) x = vw - tipW - margin;
  if (x < margin) x = margin;
  if (y + tipH > vh - margin) y = vh - tipH - margin;
  if (y < margin) y = margin;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function showTip(rect, word) {
  const tip = document.getElementById('translateTip');
  // Reset position to measure actual size
  tip.style.display = 'flex';
  tip.classList.add('tip-visible');
  tip.style.left = '-9999px';
  tip.style.top = '-9999px';
  tip.style.width = '300px';
  tip.style.height = '500px';
  const tipW = 300, tipH = 500;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 10;

  // 尝试四个方向：正上 → 正下 → 正左 → 正右，以优先选择能完整显示的方向
  const candidates = [
    // 上：正上方居中
    { x: rect.left + rect.width / 2 - tipW / 2, y: rect.top - tipH - margin },
    // 下：正下方居中
    { x: rect.left + rect.width / 2 - tipW / 2, y: rect.bottom + margin },
    // 左：正左侧垂直居中
    { x: rect.left - tipW - margin, y: rect.top + rect.height / 2 - tipH / 2 },
    // 右：正右侧垂直居中
    { x: rect.right + margin, y: rect.top + rect.height / 2 - tipH / 2 },
  ];

  let best = null;
  for (const c of candidates) {
    if (c.x + tipW <= vw - margin && c.x >= margin && c.y + tipH <= vh - margin && c.y >= margin) {
      best = c;
      break;
    }
  }
  if (!best) {
    // 没有方向能完整显示 → 右下方贴近
    best = { x: Math.max(margin, Math.min(rect.right - tipW / 2, vw - tipW - margin)), y: Math.min(rect.bottom + margin, vh - tipH - margin) };
  }
  tip.style.left = Math.round(best.x) + 'px';
  tip.style.top = Math.round(best.y) + 'px';
}

function hideTip() {
  const tip = document.getElementById('translateTip');
  tip.style.display = 'none';
  tip.classList.remove('tip-visible');
  tip.style.width = '';
  tip.style.height = '';
}

/* ---------- 翻译浮层拖拽 + 右下角缩放 ---------- */
(function initTipDragResize() {
  const tip = document.getElementById('translateTip');
  const dragBar = document.getElementById('tipDragBar');
  const resizeH = document.getElementById('tipResize');
  if (!tip || !dragBar || !resizeH) return;

  dragBar.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origLeft = parseInt(tip.style.left) || tip.offsetLeft;
    const origTop = parseInt(tip.style.top) || tip.offsetTop;
    function onMove(ev) {
      tip.style.left = (origLeft + ev.clientX - startX) + 'px';
      tip.style.top = (origTop + ev.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      repositionTip();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizeH.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = tip.offsetWidth, startH = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    function onMove(ev) {
      let w = Math.max(220, Math.min(startW + ev.clientX - startX, vw - 40));
      let h = Math.max(90, Math.min(startH + ev.clientY - startY, vh - 40));
      tip.style.width = w + 'px';
      tip.style.height = h + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      repositionTip();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

function addFromTip() {
  const v = getVocab();
  if (!v.some(i => i.word && i.word.toLowerCase() === tipSelected.toLowerCase())) {
    // Try to parse the rich translation data
    const meanEl = document.getElementById('tipMeaning');
    let word = tipSelected;
    let translation = meanEl.textContent || '';
    let part = '';
    let example = '';
    // Extract from the inner HTML if it's structured
    const html = meanEl.innerHTML || '';
    const partMatch = html.match(/<div[^>]*>([^<]*)<\/div>/);
    // Simple extraction: use the first line as translation
    const lines = translation.split('\n').filter(l => l.trim());
    translation = lines[0] || translation;
    // 提取原句作为语境：从选中的文本所在的消息中提取整个句子
    const selection = window.getSelection();
    let context = tipSelected;
    if (selection && selection.rangeCount) {
      const rng = selection.getRangeAt(0);
      const container = rng.startContainer;
      if (container && container.textContent) {
        const fullText = container.textContent;
        const idx = fullText.indexOf(tipSelected);
        if (idx >= 0) {
          const start = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
          const end = fullText.indexOf('.', idx + tipSelected.length);
          context = fullText.slice(start, end >= 0 ? end + 1 : undefined).trim();
        }
      }
    }
    v.push({
      word: word,
      translation: translation.substring(0, 100),
      part: part,
      example: example,
      context: context,
      added: new Date().toISOString().slice(0, 10)
    });
    saveVocab(v);
    renderVocab();
  }
  hideTip();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#translateTip') && !e.target.closest('.ai-bubble') && !e.target.closest('.user-bubble')) {
    hideTip();
  }
});

/* ---------- Debug Export ---------- */
/* 后台 Agent（策略师/执行者）运行情况 —— 仅在调试面板展示 */
function buildAgentDebugHTML() {
  let html = '<div style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:8px">' +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px">🧠 后台 Agent 运行记录（本次会话）</div>';
  if (!agentRuntimeLog.length) {
    html += '<div class="empty" style="padding:8px 0">暂无后台活动</div>';
  } else {
    html += '<div style="max-height:180px;overflow-y:auto;background:#0f172a;color:#cbd5e1;border-radius:8px;padding:8px;font-size:11px;line-height:1.7;font-family:Consolas,monospace">';
    for (const e of agentRuntimeLog) {
      const t = (new Date(e.t)).toLocaleTimeString('zh-CN', { hour12: false });
      const label = e.agent === 'strategist' ? '策略师' : e.agent === 'executor' ? '执行者' : e.agent;
      const color = e.agent === 'strategist' ? '#f59e0b' : '#22c55e';
      html += '<div><span style="color:#64748b">' + t + '</span> <span style="color:' + color + '">[' + label + ']</span> ' + esc(e.msg) + '</div>';
    }
    html += '</div>';
  }
  // 按消息归纳
  html += '<div style="margin-top:8px;max-height:180px;overflow-y:auto">';
  let hasPerMsg = false;
  for (const item of getActivePath()) {
    if (item.role !== 'user' || (!item.strategy && !item.research)) continue;
    hasPerMsg = true;
    html += '<div style="border-top:1px dashed var(--border);padding:6px 0;font-size:12px">' +
      '<div style="font-weight:600">👤 ' + esc((item.content || '').substring(0, 50)) + '</div>';
    if (item.strategy) {
      html += '<div style="margin-top:2px;color:#b45309">🧠 策略师: ' + esc(JSON.stringify(item.strategy)) + '</div>';
    }
    if (item.research) {
      html += '<div style="margin-top:2px;color:#15803d">🔎 执行者研究（' + (item.research.rounds || []).length + ' 轮）:</div>';
      for (const r of (item.research.rounds || [])) {
        html += '<div style="margin-left:10px;color:var(--text2)">第' + r.round + '轮「' + esc(r.query) + '」→ ' + (r.organic || []).length + ' 条</div>';
      }
      html += '<div style="margin-left:10px;color:var(--text2);white-space:pre-wrap;max-height:120px;overflow-y:auto">' + esc(item.research.summary || '') + '</div>';
    }
    html += '</div>';
  }
  if (!hasPerMsg) html += '<div class="empty" style="padding:6px 0">尚无消息级 Agent 元数据</div>';
  html += '</div></div>';
  // LLM 调用日志
  html += '<div style="border-bottom:1px solid var(--border);padding:8px 0;">' +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px">🤖 大模型调用日志（请求 + 完整响应，含思考）</div>';
  if (!llmRuntimeLog.length) {
    html += '<div class="empty" style="padding:8px 0">暂无 LLM 调用</div>';
  } else {
    html += '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px">';
    for (const e of llmRuntimeLog.slice(-30).reverse()) {
      const t = (new Date(e.t)).toLocaleTimeString('zh-CN', { hour12: false });
      const req = e.request;
      const typeColor = e.type === 'call' ? '#2563eb' : '#0891b2';
      html += '<details style="border:1px solid var(--border);border-radius:6px;padding:4px 6px;margin-bottom:4px;font-size:11px">' +
        '<summary style="cursor:pointer;color:var(--text)"><span style="color:' + typeColor + '">' + esc(e.type) + '</span> ' + t +
        ' · ' + esc(Boolean(req && req.model) ? req.model : MODEL) + ' · ' + (req ? req.messages : 0) + ' 条消息 · 响应 ' + (e.response || '').length + ' 字</summary>' +
        (req ? '<div style="margin-top:4px;max-height:300px;overflow-y:auto;background:var(--bg);border-radius:6px;padding:6px"><b>请求消息:</b>' + esc(dbgReqDetail(req)) + '</div>' : '') +
        (e.thinking ? '<div style="margin-top:2px;color:#b45309;max-height:160px;overflow-y:auto"><b>思考:</b>' + esc(e.thinking) + '</div>' : '') +
        '<div style="margin-top:2px;color:var(--text);white-space:pre-wrap;max-height:200px;overflow-y:auto"><b>响应:</b>' + esc(e.response || '(空)') + '</div>' +
        '</details>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function dbgObjSummary(obj) {
  let s = '';
  try { s = JSON.stringify(obj, null, 1); } catch (e) { s = String(obj); }
  return (s || '').substring(0, 300);
}
function dbgReqDetail(req) {
  // 格式化请求消息列表，显示每条消息的 role + content(前200字)
  if (!req || !req.messages || !Array.isArray(req.messages)) {
    try { return JSON.stringify(req, null, 1).substring(0, 1000); } catch (e) { return String(req).substring(0, 1000); }
  }
  return req.messages.map(m => {
    const role = m.role || '?';
    const content = (m.content || '').substring(0, 1000);
    const roleColor = role === 'system' ? '#2563eb' : role === 'user' ? '#059669' : '#d97706';
    return '<div style="margin-bottom:6px;border-bottom:1px dashed #e2e8f0;padding-bottom:4px">' +
      '<span style="color:' + roleColor + ';font-weight:700">' + esc(role) + '</span> ' +
      '<span style="color:var(--text2);font-size:10px">' + ((m.content || '').length) + '字</span><br>' +
      '<span style="white-space:pre-wrap;word-break:break-word">' + esc(content) + (m.content && m.content.length > 1000 ? '...' : '') + '</span></div>';
  }).join('');
}

function exportDebug() {
  // Remove all stuck overlays/modals first
  removeAllModals();
  const snapshot = {
    time: new Date().toISOString(),
    config: { difficulty: currentLevel, topic: currentTopic, api_model: MODEL, api_url: API_URL },
    conversation: getActivePath().map(m => ({
      role: m.role,
      content: (m.content || '').substring(0, 200) + ((m.content || '').length > 200 ? '...' : ''),
      hasFeedback: !!m.feedback && !!m.feedback.analysis
    })),
    lastRawResponse: lastRawResponse ? lastRawResponse.substring(0, 500) + (lastRawResponse.length > 500 ? '...' : '') : '(none)',
    lastThinking: lastThinking ? lastThinking.substring(0, 300) + (lastThinking.length > 300 ? '...' : '') : '(none)',
    lastApiError: lastApiError,
    debugLog: debugLog.slice(-30),
    vocabulary: getVocab().slice(0, 20),
    weakPoints: Object.values(getWeak()).sort((a, b) => b.count - a.count).slice(0, 20),
    userAgent: navigator.userAgent,
  };
  const text = JSON.stringify(snapshot, null, 2);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '调试快照');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:20px;max-width:700px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  modal.id = 'snapModal';
  modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="font-size:16px;font-weight:700">🔧 调试</h3><div style="display:flex;gap:8px"><button id="snapCopyBtn" style="padding:6px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:13px;cursor:pointer">复制快照</button><button data-action="close-overlay" style="padding:6px 14px;border-radius:8px;border:1px solid #ddd;background:#fff;font-size:13px;cursor:pointer">关闭</button></div></div>' +
    buildAgentDebugHTML() +
    '<div style="font-weight:600;font-size:13px;color:var(--text2);margin:10px 0 4px">📄 调试快照 (JSON)</div>' +
    '<pre style="flex:1;overflow:auto;background:#f8fafc;border-radius:8px;padding:16px;font-size:12px;line-height:1.5;white-space:pre-wrap;margin:0">' + esc(text) + '</pre>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.getElementById('snapCopyBtn').onclick = function() {
    navigator.clipboard.writeText(text).then(function() {
      const btn = document.getElementById('snapCopyBtn');
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = '复制到剪贴板'; }, 2000);
    }).catch(function() {
      const pre = modal.querySelector('pre');
      const range = document.createRange();
      range.selectNode(pre);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
  };
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

/* ---------- Right Panel Tabs ---------- */
function switchRightTab(tab) {
  document.querySelectorAll('.right-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.right-tab-content').forEach(c => c.style.display = c.id === 'tab-' + tab ? '' : 'none');
  if (tab === 'dict') { updateDictContext(); renderDictHistory(); }
  if (tab === 'gaokao') {
    const mode = document.getElementById('bankModeSel');
    if (mode && mode.value === 'translate') renderTrBankPanel();
    else loadGaokaoList();
  }
  if (tab === 'feedback') { switchFeedbackTab('current'); }
}

/* ---------- Feedback Inner Tabs (本次反馈 / 生词本 / 薄弱点) ---------- */
function switchFeedbackTab(tab) {
  document.querySelectorAll('#feedbackTabs .right-tab').forEach(b => b.classList.toggle('active', b.dataset.ftab === tab));
  document.querySelectorAll('[data-ftab-pane]').forEach(p => p.style.display = (p.dataset.ftabPane === tab ? '' : 'none'));
}

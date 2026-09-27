/* ============================================================
   AI 英语对话教练 — Anki 集成：卡片推送、自动出题、复习统计、网页复习
   由 js/app.js 拆分而来（原 1467-2291 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Anki Integration ----------
   多用户隔离：牌组为 英语学习::<username>::子牌组
   自动出题：弱项 → AI 生成题目 → 推送到 Anki 薄弱点牌组
   网页答题：通过 AnkiConnect GUI 动作驱动 Anki FSRS 排程
   复习数据回流：拉取 Anki 卡片排程 → 更新 weak points 掌握状态
*/
// ---- 牌组/标签工具 ----
function ankiBaseDeck() { return ANKI_DECK_PREFIX + '::' + (currentUser() || 'default'); }
function ankiWeakDeck() { return ankiBaseDeck() + '::薄弱点'; }
function ankiVocabDeck() { return ankiBaseDeck() + '::词汇'; }
function ankiCorrDeck() { return ankiBaseDeck() + '::纠错'; }
function ankiExtDeck() { return ankiBaseDeck() + '::拓展'; }
function ankiUserTag() { return 'ai-english'; }
function wpTag(id) { return 'wp_' + (currentUser() || 'default') + '_' + id; }

/* 词汇卡正面统一为「中文释义 + 作答形式提示」。历史数据里有些释义
   是完整词典条目（把英文词头、音标、词性也一起存进了 Front），这里在
   写卡和修复旧卡时都归一化，避免答案泄露到正面。 */
function normalizeVocabMeaning(raw, answer) {
  let text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return '';
  const word = String(answer || '').trim();
  if (word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const head = new RegExp('^\\s*' + escaped + '(?=\\s|/|$)', 'i');
    text = text.replace(head, '').trim();
  }
  // 迁移脚本/旧版本可能已经写过答案形式提示；归一化时先去掉它，保证
  // 重复同步不会把「答案形式」一层层追加到正面。
  text = text.replace(/(?:^|\n)\s*答案形式\s*[:：][^\n]*/g, '').trim();
  // 去掉词头后的音标、英/美音标记、词性和「变形」元信息。历史词典文本
  // 的音标可能有多个（`/uk/ (英) /us/ (美)`），所以这里全部清掉。
  text = text
    .replace(/\/[^\/\n]{1,120}\//g, ' ')
    .replace(/\s*\((?:英音|美音|英|美|英式|美式|UK|US)\)\s*/gi, ' ')
    .replace(/(^|[\s/])(?:adj|adv|vt|vi|n|v|prep|pron|conj|interj|det|phrase)\.(?=\s|$)/gi, '$1')
    // 「变形」后面可能没有项目符号，直到中文释义才开始；保留中文起点。
    .replace(/变形\s*[:：]?\s*[^•\n]*?(?=[\u3400-\u9fff]|•|\n|$)/gi, '')
    .replace(/^\s*[•;；,，]+\s*/, '')
    .trim();

  const chunks = text.split(/[•\n]+/)
    .map(s => s.replace(/^\s*[;；,，]+\s*/, '').trim())
    .filter(Boolean);
  if (!chunks.length) return '';
  // 词典条目通常同时包含英文头信息和中文释义；中文学习卡只保留中文片段。
  const chinese = chunks.filter(s => /[\u3400-\u9fff]/.test(s));
  // 没有中文时宁可暂不生成默写正面，也不把英文词头/英文解释当成“中文释义”。
  if (!chinese.length) return '';
  const kept = chinese;
  const answerRe = word ? new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi') : null;
  return kept.map(s => {
    let value = s;
    if (answerRe) value = value.replace(answerRe, '').replace(/[ \t]{2,}/g, ' ').trim();
    return value;
  }).filter(Boolean).join('\n');
}

function vocabAnswerFormat(answer) {
  const text = String(answer || '').trim();
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || text.split(/\s+/).filter(Boolean);
  const count = words.length || 1;
  return count === 1 ? '答案形式：1 个单词' : '答案形式：词组（' + count + ' 个单词）';
}

function vocabFrontText(meaning, answer) {
  const clean = normalizeVocabMeaning(meaning, answer);
  return clean ? clean + '\n\n' + vocabAnswerFormat(answer) : '';
}

function extensionAnswerHint(extension) {
  const raw = extension && (Array.isArray(extension.answers) ? extension.answers : extension.answer ? [extension.answer] : []);
  const answers = raw.map(s => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!answers.length) return '答案形式：背面英文表达';
  if (answers.length === 1) return vocabAnswerFormat(answers[0]);
  const kinds = answers.map(s => (s.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || s.split(/\s+/).filter(Boolean)).length === 1 ? '单词' : '词组');
  const kind = kinds.every(k => k === '单词') ? '单词' : kinds.every(k => k === '词组') ? '词组' : '单词/词组';
  return '答案形式：' + answers.length + ' 条' + kind + '（见背面）';
}

// 旧 Anki 卡如果只保存了英文答案、本地生词本又没有对应释义，不能把英文
// 再写回默写正面。同步时用一次批量 AI 查询补齐中文释义，失败则保留卡片
// 不动，等待下次同步重试（不会生成“暂无中文释义”这种无效线索）。
async function generateMissingVocabMeanings(words) {
  const unique = [...new Set((words || []).map(w => String(w || '').trim()).filter(Boolean))];
  if (!unique.length || typeof callAPI !== 'function') return new Map();
  const result = new Map();
  try {
    for (let i = 0; i < unique.length; i += 40) {
      const batch = unique.slice(i, i + 40);
      const raw = await callAPI([
        { role: 'system', content: 'You are an English-Chinese dictionary. Return ONLY valid JSON: {"items":[{"word":"English word or phrase","meaning":"concise Chinese meaning"}]}. Include every requested item, do not include English headwords, phonetics, part-of-speech labels, or explanations in meaning.' },
        { role: 'user', content: 'Provide concise Chinese meanings for: ' + batch.join(', ') }
      ], { temperature: 0.2, maxTokens: Math.max(800, batch.length * 80), thinking: { type: 'disabled' } });
      const obj = smartParseJSON(raw);
      const rows = obj && (Array.isArray(obj.items) ? obj.items : Array.isArray(obj.meanings) ? obj.meanings : []);
      for (const row of rows) {
        if (!row || !row.word || !row.meaning) continue;
        const clean = normalizeVocabMeaning(row.meaning, row.word);
        if (clean) result.set(String(row.word).trim().toLowerCase(), clean);
      }
    }
    return result;
  } catch (e) {
    dbg('ANKI_VOCAB_MEANING', e.message);
    return new Map();
  }
}

// ---- 添加单张卡片（兼容旧调用） ----
async function addToAnki(front, back, tags, deckName) {
  try {
    deckName = deckName || ankiBaseDeck();
    await ensureQuizModelAndDeck();
    const data = await ankiPostCall({
      action: 'addNote', version: 6,
      params: { note: {
        deckName: deckName,
        modelName: ANKI_BASIC_MODEL,
        fields: { Front: front, Back: back },
        tags: tags || [ankiUserTag()]
      } }
    });
    if (!data.ok) throw new Error(data.error || 'anki error');
    if (data.result && data.result.error) throw new Error(data.result.error);
    // AnkiConnect 忽略 deckName 的兜底
    const nid = data.result && data.result.result;
    if (nid) ensureDeckPlacement([{ noteId: nid, deckName }]).catch(() => {});
    return data.result;  // note id
  } catch (e) {
    dbg('ANKI_ADD_ERR', e.message);
    return false;
  }
}

// ---- 批量添加（去重 + 批量） ----
// AnkiConnect 的 addNote/addNotes 忽略 deckName 参数，所有卡片落到"系统默认"牌组。
// 此兜底：添加后立即用 changeDeck 移到目标牌组。
async function ensureDeckPlacement(pairs) {
  // pairs: [{noteId, deckName}, ...]
  if (!pairs || !pairs.length) return;
  const byDeck = {};
  for (const { noteId, deckName } of pairs) {
    if (!noteId || !deckName) continue;
    if (!byDeck[deckName]) byDeck[deckName] = [];
    byDeck[deckName].push(noteId);
  }
  for (const [deck, nids] of Object.entries(byDeck)) {
    try {
      const query = nids.map(n => 'nid:' + n).join(' OR ');
      const res = await ankiPostCall({ action: 'findCards', version: 6, params: { query } });
      const cardIds = res && res.result && res.result.result;
      if (cardIds && cardIds.length) {
        await ankiPostCall({ action: 'changeDeck', version: 6, params: { cards: cardIds, deck } });
      }
    } catch (e) { dbg('DECK_FIX', e.message); }
  }
}

async function ankiAddNotesBatch(notes) {
  if (!notes || !notes.length) return { added: 0, skipped: 0, noteIds: [] };
  try {
    await ensureQuizModelAndDeck();
    // 预检去重
    const canAdd = await ankiPostCall({ action: 'canAddNotes', version: 6, params: { notes } });
    const canResults = canAdd && canAdd.result && canAdd.result.result;
    if (Array.isArray(canResults) && canResults.length) {
      // 过滤掉重复的（记录原索引映射）
      const toAdd = [];
      const idxMap = [];
      notes.forEach((n, i) => { if (canResults[i] !== false) { toAdd.push(n); idxMap.push(i); } });
      const skipped = notes.length - toAdd.length;
      if (!toAdd.length) return { added: 0, skipped, noteIds: [] };
      // 批量添加
      const added = await ankiPostCall({ action: 'addNotes', version: 6, params: { notes: toAdd } });
      const addedResults = added && added.result && added.result.result;
      if (Array.isArray(addedResults)) {
        const noteIds = [];
        const valid = [];
        addedResults.forEach((nid, j) => { if (nid != null && nid !== false) { noteIds.push(nid); valid.push(nid); } });
        // 映射回原始索引对应的 note id（用于关联 weak point）：
        // addedResults 与去重后的 toAdd 对齐，调用方按原始 notes 的下标取用，
        // 必须经 idxMap 还原，否则一旦有重复卡被过滤，后续 note id 会绑到错误的薄弱点上。
        const order = new Array(notes.length).fill(null);
        toAdd.forEach((n, j) => {
          const nid = addedResults[j];
          order[idxMap[j]] = (nid != null && nid !== false) ? nid : null;
        });
        // AnkiConnect 忽略 deckName 的兜底：用 changeDeck 移到正确牌组
        const deckPlacement = [];
        toAdd.forEach((n, j) => {
          const nid = addedResults[j];
          if (nid != null && nid !== false && n.deckName) deckPlacement.push({ noteId: nid, deckName: n.deckName });
        });
        if (deckPlacement.length) ensureDeckPlacement(deckPlacement).catch(() => {});
        return { added: valid.length, skipped: skipped + (addedResults.length - valid.length), noteIds, order };
      }
      return { added: toAdd.length, skipped, noteIds: [], order: new Array(notes.length).fill(null) };
    }
    // fallback: 逐条添加
    let added = 0, skipped = 0;
    const noteIds = [];
    const deckPlacement = [];
    // order 与传入的 notes 一一对齐（失败的位置为 null），供调用方按原始下标关联薄弱点
    const order = new Array(notes.length).fill(null);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      try {
        const d = await ankiPostCall({
          action: 'addNote', version: 6,
          params: { note: { deckName: n.deckName, modelName: n.modelName || ANKI_BASIC_MODEL, fields: n.fields, tags: n.tags || [] } }
        });
        if (d && d.result && d.result.result && !d.result.error) {
          added++;
          noteIds.push(d.result.result);
          order[i] = d.result.result;
          deckPlacement.push({ noteId: d.result.result, deckName: n.deckName });
        }
        else skipped++;
      } catch (e) { skipped++; }
    }
    if (deckPlacement.length) ensureDeckPlacement(deckPlacement).catch(() => {});
    return { added, skipped, noteIds, order };
  } catch (e) {
    dbg('ANKI_BATCH_ERR', e.message);
    return { added: 0, skipped: notes.length, noteIds: [], order: new Array(notes.length).fill(null) };
  }
}

// ---- 创建/确保笔记类型 + 牌组 ----

async function ensureQuizModelAndDeck() {
  const [models, decks] = await Promise.all([
    ankiPostCall({ action: 'modelNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null),
    ankiPostCall({ action: 'deckNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null)
  ]);
  const modelSpecs = [
    { name: ANKI_BASIC_MODEL, fields: ANKI_BASIC_FIELDS, css: ANKI_BASIC_CSS, templates: ankiBasicTemplates() },
    { name: VOCAB_MODEL, fields: ['Front', 'Back'], css: ANKI_VOCAB_CSS, templates: ankiVocabTemplates() },
    { name: ANKI_QUIZ_MODEL, fields: ANKI_QUIZ_FIELDS, css: ANKI_QUIZ_CSS, templates: ankiQuizTemplates() }
  ];
  for (const spec of modelSpecs) {
    try {
      if (Array.isArray(models) && !models.includes(spec.name)) {
        await ankiPostCall({ action: 'createModel', version: 6, params: {
          modelName: spec.name,
          inOrderFields: spec.fields,
          css: spec.css,
          cardTemplates: Object.entries(spec.templates).map(([Name, t]) => ({ Name, Front: t.Front, Back: t.Back }))
        }});
      } else {
        await ankiPostCall({ action: 'updateModelStyling', version: 6, params: {
          model: { name: spec.name, css: spec.css }
        }});
        await ankiPostCall({ action: 'updateModelTemplates', version: 6, params: {
          model: { name: spec.name, templates: spec.templates }
        }});
      }
    } catch (e) { dbg('ANKI_MODEL_' + spec.name, e.message || e); }
  }

  // 确保牌组存在
  if (Array.isArray(decks)) {
    for (const d of [ankiBaseDeck(), ankiWeakDeck(), ankiVocabDeck(), ankiCorrDeck(), ankiExtDeck()]) {
      if (!decks.includes(d)) {
        try { await ankiPostCall({ action: 'createDeck', version: 6, params: { deck: d } }); } catch (e) {}
      }
    }
  }
}

// ---- 处理分析结果 → 自动推送到 Anki ----
// 卡片不再直接推送，而是先入「Anki 任务中心」队列（21-anki-tasks.js）：
// Anki 没开 / AnkiConnect 报错时任务保留为 pending，可在 Practice 模块重试，不再静默丢失。
async function processAnalysisForAnki(parsed, userText) {
  if (!parsed) return;
  const masterOn = ankiAutoAdd;
  const vocabOn = masterOn && getSetting('ankiAutoVocab', true) !== false;
  const corrOn = masterOn && getSetting('ankiAutoCorr', true) !== false;
  const extOn = masterOn && getSetting('ankiAutoExt', true) !== false;
  const weakOn = masterOn && getSetting('ankiAutoWeak', true) !== false;
  const useQueue = typeof enqueueAnkiTask === 'function';
  let total = 0, added = 0;

  // 生词卡片（默写题型：中文释义→默写英文）
  if (vocabOn && parsed.new_words && parsed.new_words.length) {
    const notes = [];
    for (const w of parsed.new_words) {
      let word, meaning, example;
      if (typeof w === 'string') { word = w; const p = w.split(/[—\-–]/); meaning = p.length > 1 ? p[1].trim() : ''; }
      else { word = w.word || ''; meaning = w.meaning || ''; example = w.example || ''; }
      if (!word) continue;
      const ctx = userText ? '\n\n💬 语境：' + (userText.substring(0, 120) || '') : '';
      // 默写题型的正面只放中文线索，并明确答案是单词还是词组。
      const frontText = vocabFrontText(meaning, word);
      if (!frontText) continue;
      let backText = word;
      if (getSetting('ankiAutoAudio', false)) {
        const sound = await ankiAttachAudio(word);
        if (sound) backText = word + '<br>' + sound;
      }
      if (example) backText += '\n\n' + example;
      if (ctx) backText += '\n' + ctx;
      notes.push({ deckName: ankiVocabDeck(), modelName: VOCAB_MODEL, fields: { Front: frontText, Back: backText }, tags: [ankiUserTag(), 'vocabulary'] });
    }
    total += notes.length;
    if (notes.length) {
      if (useQueue) enqueueAnkiTask('notes', { notes }, '生词 ' + notes.length + ' 张');
      else { const r = await ankiAddNotesBatch(notes); added += r.added; }
    }
  }

  // 纠错卡片
  if (corrOn && parsed.corrections && parsed.corrections.length) {
    const notes = [];
    for (const c of parsed.corrections) {
      const front = c.original || '';
      const back = (c.corrected ? '→ ' + c.corrected + '\n' : '') + (c.rule ? '规则：' + c.rule + '\n' : '') + (c.explanation || '');
      if (!front) continue;
      notes.push({ deckName: ankiCorrDeck(), modelName: ANKI_BASIC_MODEL, fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'correction'] });
    }
    total += notes.length;
    if (notes.length) {
      if (useQueue) enqueueAnkiTask('notes', { notes }, '纠错 ' + notes.length + ' 张');
      else { const r = await ankiAddNotesBatch(notes); added += r.added; }
    }
  }

  // 拓展知识卡片
  if (extOn && parsed.extensions && parsed.extensions.length) {
    const notes = [];
    for (const e of parsed.extensions) {
      const answers = Array.isArray(e.answers) ? e.answers.map(s => String(s || '').trim()).filter(Boolean) : [];
      const front = '💡 ' + (e.title || e.type || 'Knowledge') + '\n\n' + extensionAnswerHint(e);
      const back = (e.content || '') + (e.type ? '\n\n类型：' + e.type : '') + (answers.length ? '\n\n参考表达：' + answers.join(' / ') : '');
      notes.push({ deckName: ankiExtDeck(), modelName: ANKI_BASIC_MODEL, fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'extension'] });
    }
    total += notes.length;
    if (notes.length) {
      if (useQueue) enqueueAnkiTask('notes', { notes }, '拓展知识 ' + notes.length + ' 张');
      else { const r = await ankiAddNotesBatch(notes); added += r.added; }
    }
  }

  // 薄弱点 → 触发自动出题（实际出题在 maybeGenerateQuizQuestions 中处理）
  if (weakOn && parsed.weak_points && parsed.weak_points.length) {
    // weak_points 已通过 trackWeakPoints 存入存储，这里只需触发出题策略
  }

  if (useQueue) {
    if (total > 0) {
      toastMsg('📋 已加入 Anki 队列：' + total + ' 张卡片');
      // 立即尝试消费一次；Anki 没开则原地排队，不报错
      processAnkiQueue().catch(() => {});
    }
  } else if (total > 0) {
    toastMsg('📚 Anki: 已添加 ' + added + ' / ' + total + ' 张卡片');
  }
}

// ---- AI 出题 prompt ----
function buildQuizPrompt(wpList) {
  const multiWp = getSetting('ankiQuizMultiWp', true) !== false;
  return `You are an ENGLISH quiz generator for a Chinese-speaking learner of English.
The learner is studying ENGLISH (vocabulary, grammar, collocations, usage). Generate
quiz questions that drill their ENGLISH.

Weak points to cover (each has a Chinese hint describing the English point to drill):
${wpList.map(w => `- [${w.id}] (${w.category}) ${w.point}${w.suggestion ? '\n  Tip: ' + w.suggestion.substring(0, 80) : ''}`).join('\n')}

Requirements:
${multiWp ? '- One question should test AS MANY weak points as possible (ideally 2-3 at a time), as long as it stays natural.' : '- Each question should test exactly ONE weak point.'}
- Cover ALL given weak points across the questions.
- Generate ${Math.max(1, Math.ceil(wpList.length * (parseInt(getSetting('ankiQuizPerWp', 2)) || 2) / 1.6))} questions.
- Question types: multiple_choice (4 options A/B/C/D), fill_blank (English sentence with one or more
  blanks, each blank written as ___ at the exact spot), or error_correction.
- A fill_blank sentence may contain MORE THAN ONE blank. Put one ___ at each exact spot (so any
  comma/semicolon/word between blanks stays in the sentence). For multiple blanks, write the
  "answer" as the English answers separated by ", " in blank order (e.g. "word1, word2").
- Follow Shanghai Gaokao grammar-fill conventions for fill_blank: when a blank is based on a
  supplied root word (verb, adjective, adverb, noun, etc.), show that root in parentheses right
  after the blank, for example "The work ___ (complete) by Friday." with answer
  "is to be completed". Return the same roots in a "blank_hints" array in blank order. Use an
  empty string for blanks with no supplied root (articles, prepositions, pronouns, conjunctions,
  modal verbs, and similar no-prompt blanks). One blank may require several written words; keep
  it as one ___ and put the complete phrase in answer.
- ALL question stems, options and answers MUST be in ENGLISH. The learner is Chinese, but
  they are learning ENGLISH — never write questions in Chinese and never ask them to choose
  between Chinese characters/words (e.g. do NOT write "Which sentence uses 方位 correctly?"
  with Chinese sentences).
- If a weak-point hint is a Chinese distinction (e.g. 方位 vs 方向), turn it into the
  ENGLISH equivalent: test the English words it maps to (position/direction/orientation...)
  in natural English sentences, e.g. a fill-in-the-blank or "choose the correct English word".
- Use natural English at an appropriate level (CET-4/6 ~ IELTS). Sentences must be realistic.
- For error_correction, the question MUST contain a real, objectively incorrect English sentence.
  Never mark a grammatical sentence as wrong just to test an alternative word order or style.
  In particular, "enough experience" and "experience enough" can both be grammatical in
  suitable contexts; do not create an error-correction item by changing one to the other.
- The error_correction answer MUST genuinely correct the error, and its explanation MUST NOT
  say that the original sentence is correct, has no grammar error, or should be retained.
- The "explanation" field MAY be in Chinese to help the learner understand, but everything the
  learner reads as the question/options/answer must be English.

Return ONLY valid JSON (no markdown, no thinking):
{
  "questions": [
    {
      "type": "multiple_choice|fill_blank|error_correction",
      "question": "English question text (use ___ for blanks, or the erroneous English sentence)",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],   // only for multiple_choice, all in English
      "answer": "for MC: the option letter only (A/B/C/D); for fill: the missing English word/phrase; for error: the corrected English",
      "blank_hints": ["complete", ""], // fill_blank only; one item per ___, root word or ""
      "explanation": "Chinese explanation with reasons, referencing each tested weak point",
      "weak_point_ids": ["id1", "id2"]
    }
  ]
}`;
}

// 旧模型没有 blank_hints 字段，且模型偶尔只输出了 ___。新卡片尽量依据
// AI 给出的提示插入括号；对历史题只做保守的词形还原，避免把冠词/介词
// 这类无提示词题误标成有词根提示。
function inferFillBlankHint(answer, question) {
  const ignored = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'by', 'with', 'from', 'and', 'or', 'but', 'if', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'can', 'could', 'may', 'might', 'must', 'will', 'would', 'should']);
  const words = String(answer || '').match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const hasAuxiliary = /\b(?:am|is|are|was|were|be|been|being|has|have|had|will|would|can|could|may|might|must|should|to)\b/i.test(String(answer || ''));
  const asksForForm = /\b(?:correct|proper|appropriate)\s+(?:form|tense|word)|\bform\s+of\b|\bchange\s+the\s+word\b/i.test(String(question || ''));
  // 没有明确的助动词/不定式结构时，无法判断这是词形变化还是普通词汇/复数；
  // 不强行猜括号，避免把「years/cities/seatmates」等无提示词题误标记。
  if (!hasAuxiliary && !asksForForm) return '';
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].toLowerCase();
    if (ignored.has(w) || w.length < 4) continue;
    if (/ied$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
    if (/(?:ated|eted|ited|oted|uted|aved|oved|ived|ased|osed|used|ized|ised)$/.test(w) && w.length > 5) return w.slice(0, -2) + 'e';
    if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2).replace(/([bcdfghjklmnpqrstvwxyz])\1$/i, '$1');
    if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3).replace(/([bcdfghjklmnpqrstvwxyz])\1$/i, '$1');
    if (asksForForm && /ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
    if (asksForForm && /(?:ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (asksForForm && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  }
  return '';
}

function decorateFillBlankQuestion(q) {
  if (!q || String(q.type || '').toLowerCase() !== 'fill_blank') return q;
  const question = String(q.question || '');
  if (!question || !/_{2,}/.test(question)) return q;
  const supplied = Array.isArray(q.blank_hints) ? q.blank_hints : [];
  const answers = String(q.answer || '').split(/\s*[,;]\s*/);
  let blankIndex = 0;
  const decorated = question.replace(/_{2,}/g, (blank, offset, whole) => {
    const following = whole.slice(offset + blank.length).match(/^\s*\(([^()\n]{1,80})\)/);
    const next = supplied[blankIndex];
    const hint = String(next == null ? '' : next).replace(/^\s*[([{]|[)\]}]\s*$/g, '').trim();
    const answerHint = following ? '' : (hint || (supplied.length ? '' : inferFillBlankHint(answers[blankIndex] || q.answer, question)));
    blankIndex++;
    return following || !answerHint ? blank : blank + ' (' + answerHint + ')';
  });
  if (decorated === question) return q;
  return { ...q, question: decorated };
}

// ---- AI 题目质量校验 ----
function isQuizQuestionUsable(q) {
  if (!q || typeof q !== 'object') return false;
  const type = String(q.type || '').trim().toLowerCase();
  const question = String(q.question || '').trim();
  const answer = String(q.answer || '').trim();
  const explanation = String(q.explanation || '').trim();
  if (!question || !answer || !['multiple_choice', 'fill_blank', 'error_correction'].includes(type)) return false;
  if (type === 'multiple_choice') {
    return Array.isArray(q.options) && q.options.length === 4 && /^[A-D]$/i.test(answer);
  }
  if (type === 'fill_blank') return /_{2,}/.test(question);

  // Reject self-contradictory “corrections” that admit the original is already valid.
  const contradiction = /(原句|原文|本题)[^。！？\n]{0,40}(正确|无语法错误|没有语法错误|保留原句)|(original sentence|original|sentence)[^.!?\n]{0,40}(correct|no grammar error|grammatically correct|should be retained)/i.test(explanation);
  return !contradiction && answer !== question;
}

// ---- 解析 AI 出题响应 ----
function parseQuizResponse(raw) {
  if (!raw) return null;
  const obj = smartParseJSON(raw);
  if (obj && Array.isArray(obj.questions)) return obj.questions;
  // fallback: extract from larger JSON
  const obj2 = smartParseJSON('{"questions":' + raw + '}');
  if (obj2 && Array.isArray(obj2.questions)) return obj2.questions;
  // fallback: 模型可能在 content 里输出 <think>...</think> 思考块（未禁用思考时），
  // 剥掉思考块后再解析。
  try {
    const stripped = (typeof stripThinking === 'function') ? stripThinking(raw) : raw;
    if (stripped && stripped !== raw) {
      const obj3 = smartParseJSON(stripped);
      if (obj3 && Array.isArray(obj3.questions)) return obj3.questions;
      const obj4 = smartParseJSON('{"questions":' + stripped + '}');
      if (obj4 && Array.isArray(obj4.questions)) return obj4.questions;
    }
  } catch (e) {}
  return null;
}

// ---- 自动生成薄弱点题目 → 推送到 Anki ----
async function autoGenerateQuizQuestions(wpList) {
  if (!wpList || !wpList.length) return;
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  const needs = wpList.filter(w => w && !w.archived && (w.anki_notes || []).length < perWp);
  // 没有需要补题的薄弱点（都已达标）不是失败：返回空结果，避免任务被误标 failed。
  if (!needs.length) return { added: 0, skipped: 0, note: 'all covered' };
  const batch = needs.slice(0, 12);
  // 多轮 API 调用，每轮 6 个薄弱点，以强化多对多关系
  const maxPerCall = 6;
  const rounds = [];
  for (let i = 0; i < batch.length; i += maxPerCall) rounds.push(batch.slice(i, i + maxPerCall));
  const allQuestions = [];
  for (const round of rounds) {
    try {
      const raw = await callAPI([
        { role: 'system', content: buildQuizPrompt(round) },
        { role: 'user', content: 'Generate quiz questions for these weak points.' }
      ], { temperature: 0.7, maxTokens: 5000, thinking: { type: 'disabled' } });
      const qs = parseQuizResponse(raw);
      if (qs && qs.length) allQuestions.push(...qs);
    } catch (e) { dbg('QUIZ_GEN', e.message); }
  }
  const validQuestions = allQuestions.map(decorateFillBlankQuestion).filter(isQuizQuestionUsable);
  if (!validQuestions.length) {
    dbg('QUIZ_QUALITY', 'AI returned no usable quiz questions');
    return;
  }
  // 构建 Anki 笔记
  const notes = validQuestions.map(q => {
    const qText = ankiQuizQuestionFieldHTML(q);
    return {
      deckName: ankiWeakDeck(),
      modelName: ANKI_QUIZ_MODEL,
      fields: { Question: qText, Answer: esc(q.answer || ''), Explanation: esc(q.explanation || '') },
      tags: [ankiUserTag(), 'weak-point', ...(q.weak_point_ids || []).map(wpTag)]
    };
  });
  const res = await ankiAddNotesBatch(notes);
  // 将实际添加的 note ID 关联回对应的薄弱点（按 order 一一对应）
  if (res.noteIds && res.noteIds.length && Array.isArray(res.order)) {
    const w = getWeak();
    let changed = false;
    validQuestions.forEach((q, qi) => {
      const nid = res.order[qi];
      if (!nid) return;
      (q.weak_point_ids || []).forEach(id => {
        if (w[id]) {
          if (!w[id].anki_notes) w[id].anki_notes = [];
          if (!w[id].anki_notes.includes(nid)) w[id].anki_notes.push(nid);
          changed = true;
        }
      });
    });
    if (changed) saveWeak(w);
  }
  toastMsg('📚 薄弱点出题: 已添加 ' + res.added + ' 道题到 Anki' + (res.skipped ? ' (跳过' + res.skipped + '道重复)' : ''));
  return res;
}

// 将已有薄弱点牌组中的旧填空题补成上海高考式的括号提示。只更新 Question
// 字段，不触碰 Answer/Explanation，因此不会影响 Anki 的排程或用户已有答案。
async function repairExistingQuizQuestions() {
  try {
    const found = await ankiPostCall({ action: 'findNotes', version: 6, params: { query: 'deck:' + ankiWeakDeck() + ' tag:weak-point' } });
    const ids = found && found.result && found.result.result;
    if (!Array.isArray(ids) || !ids.length) return 0;
    const info = await ankiPostCall({ action: 'notesInfo', version: 6, params: { notes: ids.slice(0, 500) } });
    const notes = info && info.result && info.result.result;
    if (!Array.isArray(notes)) return 0;
    let repaired = 0;
    for (const note of notes) {
      if (!note || note.modelName !== ANKI_QUIZ_MODEL) continue;
      const field = note.fields && note.fields.Question;
      const answerField = note.fields && note.fields.Answer;
      const question = String(field && field.value || '');
      if (!question || !/_{2,}/.test(question)) continue;
      const answer = String(answerField && answerField.value || '').replace(/<[^>]*>/g, '');
      const next = decorateFillBlankQuestion({ type: 'fill_blank', question, answer }).question;
      if (next === question) continue;
      const result = await ankiPostCall({ action: 'updateNoteFields', version: 6, params: { note: { id: note.noteId, fields: { Question: next } } } });
      if (result && result.ok !== false) repaired++;
    }
    return repaired;
  } catch (e) {
    dbg('ANKI_QUIZ_REPAIR', e.message);
    return 0;
  }
}

// ---- 出题策略调度 ----
// 出题同样走「Anki 任务中心」队列：AI 出题失败 / Anki 没开都可在 Practice 模块重试。
function maybeGenerateQuizQuestions(newWpList) {
  if (!newWpList || !newWpList.length) return;
  const masterOn = ankiAutoAdd && getSetting('ankiAutoWeak', true) !== false;
  if (!masterOn) return;
  const useQueue = typeof enqueueAnkiTask === 'function';
  const strategy = getSetting('ankiQuizStrategy', 'instant');
  const enqueue = (list) => {
    if (!list || !list.length) return;
    if (useQueue) {
      enqueueAnkiTask('quiz', { weakPointIds: list.map(w => w.id).filter(Boolean) }, '薄弱点出题 ' + list.length + ' 个');
      processAnkiQueue().catch(() => {});
    } else {
      autoGenerateQuizQuestions(list);
    }
  };
  if (strategy === 'instant') {
    // 即时出题：对新发现的薄弱点立即出题
    enqueue(newWpList);
  } else {
    // 积攒模式：统计所有未满 2 道的薄弱点
    const w = getWeak();
    const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
    const batchSize = parseInt(getSetting('ankiQuizBatchSize', 5)) || 5;
    const pending = Object.values(w).filter(wp => !wp.archived && (wp.anki_notes || []).length < perWp);
    if (pending.length >= batchSize) {
      enqueue(pending.slice(0, batchSize));
    }
  }
}

// ---- TTS 音频附着到 Anki 卡片 ----
async function ankiAttachAudio(text) {
  // 通过 ElevenLabs TTS 生成音频 → storeMediaFile → 返回 [sound:filename] 字符串
  try {
    if (!text || !getSetting('ankiAutoAudio', false)) return '';
    const res = await fetch((BACKEND_URL || '') + '/api/proxy/tts/' + ANKI_TTS_VOICE_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 } })
    });
    if (!res.ok) return '';
    const blob = await res.blob();
    // 转 base64
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    if (!b64) return '';
    const filename = 'ai_en_' + Date.now() + '.mp3';
    const result = await ankiPostCall({ action: 'storeMediaFile', version: 6, params: { filename, data: b64, deleteExisting: true } });
    if (result && result.ok) return '[sound:' + filename + ']';
    return '';
  } catch (e) { dbg('ANKI_AUDIO', e.message); return ''; }
}

// ---- 批量同步生词本 + 薄弱点到 Anki 卡组 ----
// 生词：用英语学习-词汇 默写卡（Front=中文释义，Back=英文单词）
// 薄弱点：调用 autoGenerateQuizQuestions 生成 薄弱点问答 题目卡
async function pushAllToAnki() {
  if (!isAuthed()) { toastMsg('请先登录'); return; }
  toastMsg('📚 正在准备同步...');
  // 1. 检查 Anki 连接
  const ver = await ankiPostCall({ action: 'version', version: 6 });
  if (!ver || !ver.ok) { toastMsg('❌ Anki 未运行或 AnkiConnect 未连接'); return; }
  await ensureQuizModelAndDeck();
  // 先修复已经存在的薄弱点填空卡，再生成新题；这样旧卡也会得到括号词根提示。
  const quizRepaired = await repairExistingQuizQuestions();

  // 2. 同步生词
  const vocab = getVocab();
  let vocabAdded = 0, vocabSkipped = 0, vocabRepaired = 0;
  if (vocab && vocab.length) {
    // 过滤掉已经在 anki 中的（按英文单词去重：notesInfo 读 Back 字段）
    const existingWords = new Set();
    const vocabByWord = new Map(vocab.filter(v => v && v.word).map(v => [v.word.trim().toLowerCase(), v]));
    const repairCandidates = [];
    try {
      const allNotes = await ankiPostCall({ action: 'findNotes', version: 6, params: { query: 'deck:' + ankiVocabDeck() + ' tag:vocabulary' } });
      if (allNotes && allNotes.ok && allNotes.result && allNotes.result.result) {
        const ids = allNotes.result.result;
        if (ids.length) {
          const info = await ankiPostCall({ action: 'notesInfo', version: 6, params: { notes: ids.slice(0, 1000) } });
          if (info && info.ok && info.result && info.result.result) {
            for (const n of info.result.result) {
              const back = String(n && n.fields && n.fields.Back && n.fields.Back.value || '');
              const front = String(n && n.fields && n.fields.Front && n.fields.Front.value || '').trim();
              const word = back
                .replace(/\[sound:[^\]]*\]/gi, '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
              const key = word.toLowerCase();
              if (!key) continue;
              existingWords.add(key);

              // 历史版本会在缺少释义时把英文答案原样写到 Front。
              // 用当前生词本中的释义原位修复，保留原卡片的学习进度与排程。
              const local = vocabByWord.get(key);
              const meaning = local && String(local.translation || local.meaning || '').trim();
              const localFrontMeaning = normalizeVocabMeaning(meaning || front, word);
              if (!localFrontMeaning) {
                repairCandidates.push({ note: n, word, front });
                continue;
              }
              const desiredFront = vocabFrontText(localFrontMeaning, word);
              // 不只修复「Front=英文答案」：旧版本也可能把完整词典条目存进 Front，
              // 只要能从本地释义得到规范正面，就原位更新并保留 Anki 排程。
              if (desiredFront && front !== desiredFront && Number.isSafeInteger(n.noteId)) {
                const updated = await ankiPostCall({
                  action: 'updateNoteFields', version: 6,
                  params: { note: { id: n.noteId, fields: { Front: desiredFront } } }
                });
                if (updated && updated.ok && updated.result && !updated.result.result?.error) vocabRepaired++;
              }
            }
          }
        }
      }
    } catch (e) { dbg('ANKI_VOCAB_FETCH', e.message); }
    if (repairCandidates.length) {
      const generated = await generateMissingVocabMeanings(repairCandidates.map(c => c.word));
      for (const candidate of repairCandidates) {
        const meaning = generated.get(candidate.word.toLowerCase());
        if (!meaning) continue;
        const desiredFront = vocabFrontText(meaning, candidate.word);
        if (!desiredFront || desiredFront === candidate.front || !Number.isSafeInteger(candidate.note.noteId)) continue;
        const updated = await ankiPostCall({
          action: 'updateNoteFields', version: 6,
          params: { note: { id: candidate.note.noteId, fields: { Front: desiredFront } } }
        });
        if (updated && updated.ok && updated.result && !updated.result.result?.error) vocabRepaired++;
      }
    }
    const notes = [];
    for (const v of vocab) {
      if (!v.word) continue;
      const meaning = v.translation || v.meaning || '';
      const example = v.example || '';
      if (existingWords.has(v.word.trim().toLowerCase())) { vocabSkipped++; continue; }
      // 没有释义的条目无法形成有效默写题，也不能用英文答案充当正面。
      const front = vocabFrontText(meaning, v.word);
      if (!front) continue;
      let back = v.word;
      if (getSetting('ankiAutoAudio', false)) {
        const sound = await ankiAttachAudio(v.word);
        if (sound) back = v.word + '<br>' + sound;
      }
      if (example) back += '\n\n' + example.replace(/\n/g, ' ').slice(0, 200);
      if (v.context && v.context !== example && v.context.trim().toLowerCase() !== v.word.trim().toLowerCase()) back += '\n\n💬 语境：' + v.context.replace(/\n/g, ' ').slice(0, 200);
      notes.push({ deckName: ankiVocabDeck(), modelName: VOCAB_MODEL, fields: { Front: front, Back: back }, tags: [ankiUserTag(), 'vocabulary'] });
    }
    if (notes.length) {
      const r = await ankiAddNotesBatch(notes);
      vocabAdded = r.added || 0;
      toastMsg('📚 生词本：已添加 ' + vocabAdded + ' / ' + notes.length + '（已存在 ' + vocabSkipped + '，修复旧卡 ' + vocabRepaired + '）');
    } else {
      toastMsg('📚 生词本：无新词可加（已存在 ' + vocabSkipped + '，修复旧卡 ' + vocabRepaired + '）');
    }
  } else {
    toastMsg('📚 生词本为空，跳过');
  }

  // 3. 同步薄弱点题目（autoGenerateQuizQuestions 单次最多 12 个薄弱点，循环覆盖全部）
  const weak = getWeak();
  const wpList = Object.values(weak).filter(w => w && !w.archived);
  const perWp = parseInt(getSetting('ankiQuizPerWp', 2)) || 2;
  let needs = wpList.filter(w => (w.anki_notes || []).length < perWp);
  if (!needs.length) {
    toastMsg('✅ 同步完成：生词 +' + vocabAdded + '，薄弱点题目无需新增' + (quizRepaired ? '，修复填空 ' + quizRepaired + ' 道' : ''));
    return;
  }
  let quizAdded = 0;
  let prevCount = needs.length + 1; // 防止 AI 生成失败导致死循环
  while (needs.length) {
    if (needs.length >= prevCount) { toastMsg('⚠️ 出题未推进（可能 API 失败），已出 ' + quizAdded + ' 道，其余请稍后重试'); break; }
    prevCount = needs.length;
    toastMsg('🎯 正在为 ' + needs.length + ' 个薄弱点生成题目（已 +' + quizAdded + '）...');
    const chunk = needs.slice(0, 12);
    const r = await autoGenerateQuizQuestions(chunk);
    quizAdded += (r && r.added) || 0;
    // 重新计算仍未满的薄弱点，进入下一轮
    const w2 = getWeak();
    needs = Object.values(w2).filter(w => w && !w.archived && (w.anki_notes || []).length < perWp);
  }
  toastMsg('✅ 同步完成：生词 +' + vocabAdded + '，薄弱点题目 +' + quizAdded + (quizRepaired ? '，修复填空 ' + quizRepaired + ' 道' : ''));
  // 刷新统计
  if (typeof renderAnkiSidebar === 'function') renderAnkiSidebar();
}

// ---- 从 Anki 拉取复习数据 → 更新 weak points 掌握状态 ----
async function syncAnkiReviewData() {
  try {
    // 检查连接
    const ver = await ankiPostCall({ action: 'version', version: 6 });
    if (!ver || !ver.ok) return;
    // 拉取薄弱点牌组中所有卡片的信息
    const cardIds = await ankiPostCall({ action: 'findCards', version: 6, params: { query: 'deck:' + ankiWeakDeck() } });
    const ids = cardIds && cardIds.result && cardIds.result.result;
    if (!Array.isArray(ids) || !ids.length) return;
    const cardsInfo = await ankiPostCall({ action: 'cardsInfo', version: 6, params: { cards: ids.slice(0, 200) } });
    const cards = cardsInfo && cardsInfo.result && cardsInfo.result.result;
    if (!Array.isArray(cards)) return;
    // 按 tag 归类到 weak point
    const w = getWeak();
    let changed = false;
    for (const card of cards) {
      if (!card || !card.note) continue;
      // 从 tags 中提取 wp 前缀
      const tags = card.tags || [];
      const wpTagPrefix = 'wp_' + (currentUser() || 'default') + '_';
      const wpIds = tags.filter(t => t.startsWith(wpTagPrefix)).map(t => t.slice(wpTagPrefix.length));
      for (const wpId of wpIds) {
        if (w[wpId]) {
          const wp = w[wpId];
          // 更新排程信息
          const prevInterval = wp.interval || 1;
          wp.interval = Math.max(1, card.interval || prevInterval);
          wp.ease = (card.factor || 2500) / 1000;
          wp.streak = Math.max(0, wp.interval > 1 ? card.reps || 0 : 0);
          wp.last_quizzed = new Date().toISOString();
          // 如果 lapses 过高（反复遗忘），增加 count
          if (card.lapses > 2 && wp.count < 20) {
            wp.count = Math.min(20, (wp.count || 0) + 1);
          }
          // 如果 interval > 21 天且 reps >= 3，趋向掌握
          if (card.interval > 21 && card.reps >= 3 && (wp.count || 0) > 0) {
            wp.count = Math.max(0, (wp.count || 0) - 1);
          }
          if ((wp.count || 0) <= 0 && card.interval > 21) {
            wp.archived = true;
          }
          changed = true;
        }
      }
    }
    if (changed) saveWeak(w);
  } catch (e) { dbg('ANKI_SYNC', e.message); }
}

// ---- 侧边栏 Anki 统计面板 ----
async function renderAnkiSidebar() {
  const el = document.getElementById('ankiSidebar');
  if (!el) return;
  try {
    const ver = await ankiPostCall({ action: 'version', version: 6 }).then(d => d.result && d.result.result).catch(() => null);
    if (!ver) {
      el.innerHTML = '<div class="anki-sidebar-section"><div class="anki-sidebar-header">📚 Anki</div><div class="anki-sidebar-stat" style="color:var(--text2)">❌ 未连接</div></div>';
      return;
    }
    const [stats, today, byDay] = await Promise.all([
      ankiPostCall({ action: 'getDeckStats', version: 6, params: { decks: [ankiWeakDeck()] } }).then(d => d.result && d.result.result).catch(() => null),
      ankiPostCall({ action: 'getNumCardsReviewedToday', version: 6 }).then(d => d.result && d.result.result).catch(() => 0),
      ankiPostCall({ action: 'getNumCardsReviewedByDay', version: 6 }).then(d => d.result && d.result.result).catch(() => [])
    ]);
    const deckStat = stats && Object.values(stats)[0];
    const reviewCount = deckStat ? deckStat.review_count || 0 : 0;
    const newCount = deckStat ? deckStat.new_count || 0 : 0;
    const learnCount = deckStat ? deckStat.learn_count || 0 : 0;
    const total = deckStat ? deckStat.total_in_deck || 0 : 0;
    // 连续学习天数（本地持久化）
    let streak = parseInt(getSetting('ankiStreak', 0)) || 0;
    const todayStr = new Date().toDateString();
    const lastStudy = getSetting('ankiLastStudy', '');
    if (todayStr !== lastStudy && today > 0) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (lastStudy === yesterday) streak++;
      else if (lastStudy && lastStudy !== todayStr) streak = 1;
      else if (!lastStudy) streak = 1;
      setSetting('ankiStreak', streak);
      setSetting('ankiLastStudy', todayStr);
    }
    if (todayStr === lastStudy && today > 0 && streak === 0) streak = 1;
    // 7 天柱状图（日期统一为 M月D日 格式）
    const fmtDay = (s) => {
      const p = String(s || '').split('-');
      return p.length >= 3 ? (parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日') : String(s);
    };
    let barHtml = '';
    if (Array.isArray(byDay) && byDay.length) {
      const recent = byDay.slice(-7);
      const max = Math.max(1, ...recent.map(d => d[1]));
      barHtml = recent.map(d => {
        const pct = (d[1] / max) * 100;
        return `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0"><span style="font-size:9px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${fmtDay(d[0])}</span><span style="width:100%;height:${Math.max(3, pct * 0.6)}px;background:var(--primary);border-radius:2px;min-height:3px"></span><span style="font-size:9px;color:var(--text2)">${d[1]}</span></span>`;
      }).join('');
    }
    el.innerHTML = `<div class="anki-sidebar-section">
      <div class="anki-sidebar-header">
        <span>📚 Anki 复习</span>
        <button data-action="anki-sync" title="同步" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--text2)">🔄</button>
      </div>
      <div class="anki-sidebar-stat"><span>🗂️ 薄弱点牌组</span><span style="color:var(--text2);font-size:11px">总计 ${total}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
        <span class="anki-badge" style="background:#e0f2fe;color:#0369a1">📝 待复习 ${reviewCount}</span>
        <span class="anki-badge" style="background:#fef3c7;color:#92400e">🆕 新卡 ${newCount}</span>
        <span class="anki-badge" style="background:#fce7f3;color:#9d174d">📖 学习中 ${learnCount}</span>
      </div>
      <div style="font-size:11px;color:var(--text2);margin:4px 0">📊 今日复习: ${today || 0}  &nbsp;|&nbsp; 🔥 连续 ${streak} 天</div>
      ${barHtml ? '<div style="display:flex;gap:2px;margin:6px 0;align-items:flex-end;height:48px">' + barHtml + '</div>' : ''}
      <button data-action="start-web-review" style="width:100%;padding:6px 0;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer;margin-top:4px">▶ 开始复习</button>
    </div>`;
  } catch (e) {
    el.innerHTML = '<div class="anki-sidebar-section"><div class="anki-sidebar-header">📚 Anki</div><div class="anki-sidebar-stat" style="color:var(--text2)">❌ 连接失败</div></div>';
  }
}

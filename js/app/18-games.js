/* ============================================================
   AI 英语对话教练 — Game 模块：Charade / Cloze / Wordle
   由 js/app.js 拆分而来（原 7345-8023 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
// ---- Charade ----
// 状态：{word, hint, revealed, rounds, guessResult}
let chState = null;
let chScore = { correct: 0, total: 0 };

function charadeSource(src) {
  chSource = src;
  document.getElementById('chBankBtn').classList.toggle('active', src === 'bank');
  document.getElementById('chAiBtn').classList.toggle('active', src === 'ai');
  charadeNext();
}

function chRenderScore() {
  const el = document.getElementById('chScore');
  if (el) el.textContent = '✅ ' + chScore.correct + '/' + chScore.total;
}

async function charadeNext() {
  document.getElementById('chDesc').value = '';
  document.getElementById('chGuess').style.display = 'none';
  document.getElementById('chHintBtn').style.display = 'none';
  chState = { word: null, hint: '', revealed: false, rounds: 0, guessResult: null };
  const wordEl = document.getElementById('chWord');
  wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2);margin-bottom:8px">只有你能看到这个词，描述它让 AI 猜</div><button class="send-btn" data-action="charade-reveal" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
  document.getElementById('chSubmitBtn').disabled = true;

  if (chSource === 'bank') {
    const idx = Math.floor(Math.random() * CHARADE_BANK.length);
    chState.word = CHARADE_BANK[idx].word;
    chState.hint = CHARADE_BANK[idx].hint;
  } else {
    wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2)">🤖 AI 生成词汇中...</div>';
    try {
      const raw = await callAPI([
        { role: 'system', content: 'You are a vocabulary teacher. Generate a single English word (common but interesting, suitable for a charades game). Return ONLY the word and a one-line hint separated by |. Example: "volcano|a mountain that erupts with hot lava". No JSON, no extra text.' },
        { role: 'user', content: 'Generate a word for charades.' }
      ], { temperature: 0.7, maxTokens: 100 });
      const parts = raw.split('|').map(s => s.trim());
      chState.word = parts[0] || 'apple';
      chState.hint = parts[1] || 'a common fruit';
      wordEl.innerHTML = '<div style="font-size:14px;color:var(--text2);margin-bottom:8px">只有你能看到这个词，描述它让 AI 猜</div><button class="send-btn" data-action="charade-reveal" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
    } catch (e) {
      chState.word = 'library';
      chState.hint = 'a place with many books';
      wordEl.innerHTML = '<div style="font-size:14px;color:var(--orange);margin-bottom:8px">AI 出题失败，使用备用词</div><button class="send-btn" data-action="charade-reveal" style="padding:8px 24px;font-size:16px">🎯 显示单词</button>';
    }
  }
}

function charadeReveal() {
  if (!chState || !chState.word) return;
  chState.revealed = true;
  const wordEl = document.getElementById('chWord');
  wordEl.innerHTML = '<div class="ch-revealed">' + esc(chState.word) + '</div><div style="font-size:13px;color:var(--text2);margin-top:8px">现在用英文描述它 —— 不要说出这个单词本身！</div>';
  document.getElementById('chSubmitBtn').disabled = false;
  if (chState.hint) document.getElementById('chHintBtn').style.display = '';
  document.getElementById('chDesc').focus();
}

function charadeShowHint() {
  if (!chState || !chState.hint) return;
  const guessEl = document.getElementById('chGuess');
  guessEl.style.display = 'block';
  guessEl.style.background = 'var(--amber-bg)';
  guessEl.style.border = '1px solid var(--amber)';
  guessEl.innerHTML = '💡 <b>提示</b>：' + esc(chState.hint);
}

function chNormalize(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
}
function chIsMatch(guess, target) {
  const g = chNormalize(guess), t = chNormalize(target);
  if (!g || !t) return false;
  if (g === t) return true;
  // 单复数容忍
  const strip = s => s.replace(/(es|s)$/, '');
  if (strip(g) === strip(t)) return true;
  // 包含关系（短语）
  if (g.length >= 4 && t.includes(g)) return true;
  if (t.length >= 4 && g.includes(t)) return true;
  return false;
}

async function submitCharade() {
  const desc = document.getElementById('chDesc').value.trim();
  if (!desc) { toastMsg('Please write your description first.'); return; }
  if (!chState || !chState.revealed) { toastMsg('Click "显示单词" first.'); return; }
  chState.rounds++;
  const guessEl = document.getElementById('chGuess');
  guessEl.style.display = 'block';
  guessEl.style.background = 'var(--bg)';
  guessEl.style.border = '1px solid var(--border)';
  guessEl.innerHTML = '<div class="loading">🤔 AI 正在猜 + 评分中...</div>';
  document.getElementById('chSubmitBtn').disabled = true;

  try {
    // 多维度评分 prompt（接近 Chat 的四维度评分：clarity/grammar/vocabulary/creativity + 综合）
    const prompt = 'You are playing a charades game and acting as a strict English teacher. The player described an English word in English WITHOUT saying the target word. Your jobs: (1) GUESS the target word. (2) Score the description on multiple dimensions.\n\nTarget word: "' + chState.word + '"\nPlayer\'s description: "' + desc + '"\n\nReturn ONLY valid JSON (no markdown, no thinking):\n{\n  "guess": "your single best guess of the word (English, lowercase)",\n  "guess_correct": "true if your guess matches the target word (case-insensitive, allow plural/inflection), else false",\n  "ai_guess_reasoning": "1-2 sentences in English explaining what clues in the description led you to your guess",\n  "score_overall": "overall score 0-100 with grade (e.g. 78/100 — Good)",\n  "score_clarity": 1,\n  "score_grammar": 1,\n  "score_vocabulary": 1,\n  "score_creativity": 1,\n  "score_comprehensibility": 1,\n  "dimensions_comment": "in Chinese: brief overall comment on the description (2-3 sentences)",\n  "strengths": ["in Chinese: 2-4 specific strengths of the description (what was done well)"],\n  "improvements": ["in Chinese: 2-4 specific, actionable improvements (what to change and how)"],\n  "grammar_issues": [{"error": "the original problematic phrase (empty array if no errors)", "correction": "the corrected version", "explanation": "in Chinese: brief grammar rule"}],\n  "vocabulary_upgrade": [{"basic": "basic word/phrase used", "better": "more natural/advanced alternative", "note": "in Chinese: when to use the better one"}],\n  "better_description": "a 1-2 sentence English version that would clearly describe the target word without saying it",\n  "extensions": [{"type": "synonym|idiom|knowledge|grammar", "title": "short title", "content": "in Chinese: 1-2 sentence learning point"}]\n}\nAll score_* values must be integers 1-10.';
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Analyze the description and respond with the JSON.' }
    ], { temperature: 0.3, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    const aiGuess = (obj && obj.guess) || '(no guess)';
    // 双向判断猜对：AI 说自己猜对 + 字符串匹配
    const stringMatch = chIsMatch(aiGuess, chState.word);
    const aiSaysCorrect = obj && obj.guess_correct === 'true' || obj && obj.guess_correct === true;
    const correct = stringMatch && aiSaysCorrect;
    chState.guessResult = { aiGuess, correct, desc, rounds: chState.rounds, obj };

    chScore.total++;
    if (correct) chScore.correct++;
    chRenderScore();

    if (correct) {
      guessEl.style.background = 'var(--green-bg)';
      guessEl.style.border = '1px solid var(--green)';
      guessEl.innerHTML = '<div style="font-size:22px;font-weight:800;color:var(--green)">🎉 AI 猜中了！</div>' +
        '<div style="margin-top:6px">AI 的猜测：<b>' + esc(aiGuess) + '</b> = 目标词 <b>' + esc(chState.word) + '</b></div>' +
        (obj && obj.ai_guess_reasoning ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💭 推理：' + esc(obj.ai_guess_reasoning) + '</div>' : '') +
        (chState.hint ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💡 参考提示：' + esc(chState.hint) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px"><button class="send-btn" data-action="charade-next" style="padding:6px 18px;font-size:14px">下一个 →</button></div>';
    } else {
      guessEl.style.background = 'var(--red-bg)';
      guessEl.style.border = '1px solid var(--red)';
      guessEl.innerHTML = '<div style="font-size:18px;font-weight:800;color:var(--red)">❌ AI 没猜中（第 ' + chState.rounds + ' 轮）</div>' +
        '<div style="margin-top:6px">AI 猜成了：<b>' + esc(aiGuess) + '</b>，正确答案是 <b>' + esc(chState.word) + '</b></div>' +
        (obj && obj.ai_guess_reasoning ? '<div style="margin-top:6px;font-size:12px;color:var(--text2)">💭 推理：' + esc(obj.ai_guess_reasoning) + '</div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px">' +
        '<button class="send-btn" data-action="charade-improve" style="padding:6px 18px;font-size:14px;background:var(--primary)">✏️ 改进描述</button>' +
        '<button class="dict-btn" data-action="charade-skip" style="font-size:13px;padding:6px 14px">跳过 →</button></div>';
    }
    document.getElementById('chSubmitBtn').disabled = correct;

    // 完整评价送右侧边栏（多维度，类似 Chat 反馈）
    showCharadeDetailedFeedback(obj, correct);
  } catch (e) {
    guessEl.innerHTML = '<span style="color:var(--red)">评分失败: ' + esc(e.message || '') + '</span>';
    document.getElementById('chSubmitBtn').disabled = false;
  }
}

// 生成 Charade 详细反馈 HTML（多维度评分，类似 Chat 反馈结构）
function showCharadeDetailedFeedback(obj, correct) {
  if (!obj) {
    showModuleFeedback('charade', chState.word, '<div class="pf-item red">⚠️ 评分解析失败，请重试</div>');
    return;
  }
  const title = chState.word + (correct ? ' ✓' : ' ✗') + ' · 第 ' + chState.rounds + ' 轮';
  let html = '';

  // 1. 顶部英雄区：总分 + AI 猜词
  const guessLine = '<div style="font-size:13px;margin-top:6px">🤖 AI 猜成了：<b>' + esc(obj.guess || '-') + '</b> → ' +
    (correct ? '<span style="color:var(--green)">✓ 猜中</span>' : '<span style="color:var(--red)">✗ 实际：' + esc(chState.word) + '</span>') + '</div>';
  html += pfHero(obj.score_overall || (correct ? '8/10 — 描述清晰' : '5/10 — 描述模糊'), '🎭 Charade 描述评分');
  html += '<div class="pf-section">' + guessLine + (obj.ai_guess_reasoning ? '<div style="font-size:11px;color:var(--text2);margin-top:4px">💭 ' + esc(obj.ai_guess_reasoning) + '</div>' : '') + '</div>';

  // 2. 多维度评分条
  const dims = [
    ['score_clarity', '🎯 清晰度'],
    ['score_grammar', '📖 语法'],
    ['score_vocabulary', '💬 词汇'],
    ['score_creativity', '✨ 创意'],
    ['score_comprehensibility', '🤝 AI理解度']
  ];
  const dimHtml = dims.map(([k, label]) => {
    const v = Math.max(1, Math.min(10, parseInt(obj[k]) || 0));
    const pct = v * 10;
    const color = v >= 8 ? 'var(--green)' : v >= 5 ? 'var(--amber)' : 'var(--red)';
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px">' +
      '<span style="min-width:88px;color:var(--text2)">' + label + '</span>' +
      '<div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + color + ';transition:width .3s"></div></div>' +
      '<span style="min-width:28px;text-align:right;font-weight:700;color:' + color + '">' + v + '</span>' +
      '</div>';
  }).join('');
  html += '<div class="pf-section"><div class="pf-title">📊 多维度评分</div>' + dimHtml + '</div>';

  // 3. 总体评论
  if (obj.dimensions_comment) {
    html += '<div class="pf-section"><div class="pf-title">📝 总体评论</div><div class="pf-item md-content">' + renderMD(obj.dimensions_comment) + '</div></div>';
  }

  // 4. 优点
  if (obj.strengths && obj.strengths.length) {
    html += '<div class="pf-section"><div class="pf-title">✅ 描述优点</div>' + pfList(obj.strengths, 'green') + '</div>';
  }

  // 5. 改进建议
  if (obj.improvements && obj.improvements.length) {
    html += '<div class="pf-section"><div class="pf-title">💡 改进建议</div>' + pfList(obj.improvements, 'amber') + '</div>';
  }

  // 6. 语法纠错
  if (obj.grammar_issues && obj.grammar_issues.length) {
    const corrHtml = obj.grammar_issues.map(g => {
      return '<div style="background:var(--surface);padding:8px 10px;border-radius:8px;margin-bottom:6px;border-left:3px solid var(--red);line-height:1.5">' +
        '<div style="color:var(--red);font-size:12px">❌ ' + esc(g.error || '') + '</div>' +
        '<div style="color:var(--green);font-size:12px">✅ ' + esc(g.correction || '') + '</div>' +
        (g.explanation ? '<div style="color:var(--text2);font-size:11px;margin-top:2px">' + esc(g.explanation) + '</div>' : '') +
        '</div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">📐 语法纠错</div>' + corrHtml + '</div>';
  }

  // 7. 词汇升级
  if (obj.vocabulary_upgrade && obj.vocabulary_upgrade.length) {
    const vHtml = obj.vocabulary_upgrade.map(v => {
      return '<div style="background:var(--surface);padding:6px 10px;border-radius:6px;margin-bottom:4px;font-size:12px;line-height:1.5">' +
        '<span style="color:var(--text2)">' + esc(v.basic || '') + '</span> → ' +
        '<span style="color:var(--primary);font-weight:600">' + esc(v.better || '') + '</span>' +
        (v.note ? '<div style="color:var(--text2);font-size:11px;margin-top:2px">' + esc(v.note) + '</div>' : '') +
        '</div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">💬 词汇升级</div>' + vHtml + '</div>';
  }

  // 8. 推荐描述
  if (obj.better_description) {
    html += '<div class="pf-section"><div class="pf-title">💡 参考描述</div><div class="pf-highlight md-content">' + renderMD(obj.better_description) + '</div></div>';
  }

  // 9. 拓展知识
  if (obj.extensions && obj.extensions.length) {
    const extHtml = obj.extensions.map(e => {
      return '<div style="background:var(--green-bg);padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.5">' +
        '<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--green)">' + esc(e.type || 'knowledge') + '</span>' +
        (e.title ? ' <b>' + esc(e.title) + '</b>' : '') +
        '<div style="margin-top:3px">' + esc(e.content || '') + '</div></div>';
    }).join('');
    html += '<div class="pf-section"><div class="pf-title">📚 拓展知识</div>' + extHtml + '</div>';
  }

  // 10. 你的描述
  html += '<div class="pf-section"><div class="pf-title">📝 你的描述</div><div class="pf-highlight md-content">' + renderMD(chState.guessResult.desc) + '</div></div>';

  // 11. 目标词
  html += '<div class="pf-section"><div class="pf-title">🎯 目标词</div><div class="pf-highlight md-content"><b>' + esc(chState.word) + '</b>' + (chState.hint ? ' — ' + renderMD(chState.hint) : '') + '</div></div>';

  showModuleFeedback('charade', title, html);
}

function charadeImprove() {
  // 回到编辑状态，让用户继续修改描述
  const guessEl = document.getElementById('chGuess');
  guessEl.style.background = 'var(--amber-bg)';
  guessEl.style.border = '1px solid var(--amber)';
  guessEl.innerHTML = '✏️ 继续修改你的描述，再点「🤔 让 AI 猜」。AI 上次猜成了：<b>' + esc(chState.guessResult.aiGuess) + '</b>' +
    (chState.guessResult.obj && chState.guessResult.obj.ai_guess_reasoning ? '<div style="margin-top:4px;font-size:11px;color:var(--text2)">💭 ' + esc(chState.guessResult.obj.ai_guess_reasoning) + '</div>' : '');
  document.getElementById('chDesc').focus();
  document.getElementById('chSubmitBtn').disabled = false;
}

function charadeSkip() {
  // 跳过时给出完整评价到右侧边栏（多维度）
  if (chState && chState.guessResult) {
    showCharadeDetailedFeedback(chState.guessResult.obj, false);
  }
  charadeNext();
}

// ============================================================
// Cloze · 上海高考 11 选 10（生词本驱动 + AI 出题）
// ============================================================
let clState = null; // {questions:[{sentence, options:[], answer}], candidates}
let clSource = 'vocab'; // vocab | ai
let clScore = { correct: 0, total: 0 };
let clChoices = {}; // {questionIndex: optionIndex}

function clNormalize(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9\s'-]/g, '').trim().replace(/\s+/g, ' ');
}

function clTokensOverlap(a, b) {
  // 比较单词级包含（处理变形 / 带连字符 / 短语拆分）
  const tk = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean).sort();
  const aSet = new Set(tk(a)); const bSet = new Set(tk(b));
  if (aSet.size === 0 || bSet.size === 0) return false;
  // 至少一个 aSet 的 token 在 bSet 里
  for (const t of aSet) if (bSet.has(t)) return true;
  return false;
}

function clRenderScore() {
  const el = document.getElementById('clozeScore');
  if (el) el.textContent = '✅ ' + clScore.correct + '/' + clScore.total;
}

function clozeSource(src) {
  clSource = src;
  document.getElementById('clozeVocabBtn').classList.toggle('active', src === 'vocab');
  document.getElementById('clozeAiBtn').classList.toggle('active', src === 'ai');
  clozeNext();
}

async function clozeNext() {
  clChoices = {};
  clState = null;
  document.getElementById('clozeQuestions').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">⏳ 加载题目...</div>';
  document.getElementById('clozeCandidates').innerHTML = '';

  if (clSource === 'vocab') {
    const vocab = getVocab();
    if (!vocab || vocab.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;text-align:center;color:var(--amber)">📚 生词本里少于 10 个词，请先去 Chat 对话中划词加入生词本，或切换到 AI 出题。</div>';
      return;
    }
    // 从生词本随机抽 10 个词
    const shuffled = [...vocab].sort(() => Math.random() - 0.5).slice(0, 10);
    const picks = shuffled.map(v => ({ word: v.word, meaning: v.translation || v.meaning || '' }));
    // 用 AI 生成 10 个含 these words 的句子（每句填空）
    await clGenerateFromVocab(picks);
  } else {
    await clGenerateFromAI();
  }
}

async function clGenerateFromVocab(picks) {
  const wordsList = picks.map(p => p.word).join(', ');
  const prompt = 'You are creating a Shanghai Gaokao English cloze test (11-choose-10 style) using the following vocabulary words: ' + wordsList + '\n\nFor EACH of these 10 words, write one natural English sentence that uses the word (or a clear inflection of it), with the word itself replaced by "____". The sentence should be natural Gaokao-level English.\n\nReturn ONLY valid JSON:\n{\n  "items": [\n    { "sentence": "The new policy has had a profound ____ on the environment.", "answer": "impact" }\n  ]\n}\nEach answer should match one of the given words (case-insensitive, allow inflections like impacts/impacted).';
  try {
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Generate 10 cloze sentences using these words.' }
    ], { temperature: 0.6, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    if (!obj || !Array.isArray(obj.items) || obj.items.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败，请重试</div>';
      return;
    }
    const items = obj.items.slice(0, 10);
    // 验证每个 item 的 answer 能在 picks 里找到（容忍变形）
    const valid = items.filter(it => picks.some(p => clNormalize(p.word) === clNormalize(it.answer) || clNormalize(p.word) === clNormalize((it.answer || '').replace(/e?s$/, '')) || clNormalize(it.answer) === clNormalize((p.word || '').replace(/e?s$/, ''))));
    if (valid.length < 8) {
      // fallback: 用 picks 直接做 11 选 10（不用 AI 造句）
      clBuildFromPicks(picks);
      return;
    }
    const questions = valid.slice(0, 10).map(it => {
      const correctWord = picks.find(p => clTokensOverlap(p.word, it.answer) || clNormalize(p.word) === clNormalize(it.answer) || clNormalize(p.word) === clNormalize((it.answer || '').replace(/e?s$/, '')));
      return { sentence: it.sentence, options: [correctWord.word], answer: correctWord.word, meaning: correctWord.meaning };
    });
    clAddDistractorAndRender(questions, picks);
  } catch (e) {
    document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败: ' + esc(e.message) + '</div>';
  }
}

function clBuildFromPicks(picks) {
  // 当 AI 不可用时，从生词本直接生成简单 cloze（句子 = word + 简单释义）
  const questions = picks.slice(0, 10).map(p => ({
    sentence: 'The word <span style="color:var(--primary);font-weight:700">' + esc(p.word) + '</span> means: ' + esc((p.meaning || '').substring(0, 30)) + ' — Please write: <span style="color:var(--primary)">____</span>',
    options: [p.word], answer: p.word, meaning: p.meaning
  }));
  clAddDistractorAndRender(questions, picks);
}

async function clGenerateFromAI() {
  const prompt = 'Generate a Shanghai Gaokao English cloze test (11-choose-10 style). Create 10 sentences at Gaokao difficulty. Each sentence should have one blank. Then create an 11th word that does NOT fit any sentence (the distractor).\n\nReturn ONLY valid JSON:\n{\n  "items": [\n    { "sentence": "...____...", "answer": "impact" }\n  ],\n  "distractor": "harmony"\n}\nMake the answers common CET-6 / Gaokao vocabulary words.';
  try {
    const raw = await callAPI([
      { role: 'system', content: prompt + '\n\nNo markdown, no thinking, only valid JSON.' },
      { role: 'user', content: 'Generate the cloze.' }
    ], { temperature: 0.7, maxTokens: 3000 });
    const obj = smartParseJSON(raw);
    if (!obj || !Array.isArray(obj.items) || obj.items.length < 10) {
      document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败，请重试</div>';
      return;
    }
    const items = obj.items.slice(0, 10);
    const distractor = (obj.distractor || 'extra').toString();
    const questions = items.map(it => ({ sentence: it.sentence, options: [it.answer], answer: it.answer, meaning: '' }));
    clAddDistractorAndRender(questions, [distractor]);
  } catch (e) {
    document.getElementById('clozeQuestions').innerHTML = '<div style="padding:20px;color:var(--red)">AI 生成失败: ' + esc(e.message) + '</div>';
  }
}

function clAddDistractorAndRender(questions, picks) {
  // 加入 1 个干扰项（多余的），组成 11 选 10
  let distractor = null;
  if (picks.length > 10) distractor = picks[10].word;
  else if (typeof picks[0] === 'string') {
    // AI 模式：picks 是包含 1 个干扰词的数组
    distractor = picks[0];
  } else {
    // 生词本 fallback：从 vocab 里随机抽一个不在 questions 里的
    const vocab = getVocab();
    const used = new Set(questions.map(q => clNormalize(q.answer)));
    const cand = (vocab || []).find(v => !used.has(clNormalize(v.word)));
    distractor = cand ? cand.word : 'extra';
  }
  clState = { questions, distractor, answers: questions.map(q => q.answer) };
  clRenderCandidates();
  clRenderQuestions();
}

function clRenderCandidates() {
  if (!clState) return;
  const all = [...clState.answers, clState.distractor];
  // 随机排序
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const wrap = document.getElementById('clozeCandidates');
  wrap.innerHTML = shuffled.map((opt, idx) => {
    return '<span class="cloze-cand" data-opt="' + esc(opt) + '" data-action="cloze-pick" data-arg1="' + esc(opt) + '">' + esc(opt) + '</span>';
  }).join('');
}

function clRenderQuestions() {
  if (!clState) return;
  const wrap = document.getElementById('clozeQuestions');
  wrap.innerHTML = clState.questions.map((q, i) => {
    const chosen = clChoices[i];
    const blank = chosen !== undefined
      ? '<span class="cloze-blank ' + (q.showCorrect ? (clNormalize(chosen) === clNormalize(q.answer) ? 'correct' : 'wrong') : '') + '">' + esc(chosen) + '</span>'
      : '<span class="cloze-blank">____</span>';
    // q.sentence 来自 LLM，必须转义后再拼接（只保留我们自己生成的空格标签）
    const raw = String(q.sentence || '');
    const cut = raw.indexOf('____');
    const head = cut >= 0 ? raw.slice(0, cut) : raw;
    const tail = cut >= 0 ? raw.slice(cut + 4) : '';
    const sentenceHtml = cut >= 0
      ? esc(head) + '</span>' + blank + '<span>' + esc(tail)
      : esc(raw);
    return '<div class="cloze-q" data-idx="' + i + '"><span class="cloze-num">' + (i + 1) + '.</span><span>' + sentenceHtml + '</span></div>';
  }).join('');
}

function clPickCandidate(el, opt) {
  if (!clState) return;
  // 找出点击的 candidate 在 candidates 里的位置
  const candWrap = document.getElementById('clozeCandidates');
  const cands = Array.from(candWrap.querySelectorAll('.cloze-cand'));
  const used = new Set(Object.values(clChoices).map(clNormalize));
  // 检查是否已被使用
  if (used.has(clNormalize(opt))) {
    // 取消选择：从 choices 里移除该选项对应的题号
    for (const idxStr of Object.keys(clChoices)) {
      if (clNormalize(clChoices[idxStr]) === clNormalize(opt)) {
        delete clChoices[idxStr];
      }
    }
    // 重新标记 used
    const usedAfter = new Set(Object.values(clChoices).map(clNormalize));
    cands.forEach(c => c.classList.toggle('used', usedAfter.has(clNormalize(c.dataset.opt))));
    // 找到当前第一个空白题，并填入
    const emptyIdx = clState.questions.findIndex((_, i) => clChoices[i] === undefined);
    if (emptyIdx >= 0) clChoices[emptyIdx] = opt;
    clRenderQuestions();
    return;
  }
  // 找到当前第一个空白题填入
  const emptyIdx = clState.questions.findIndex((_, i) => clChoices[i] === undefined);
  if (emptyIdx < 0) { toastMsg('所有空格已填满'); return; }
  clChoices[emptyIdx] = opt;
  // 标记其他候选的 used 状态
  const usedAfter = new Set(Object.values(clChoices).map(clNormalize));
  cands.forEach(c => c.classList.toggle('used', usedAfter.has(clNormalize(c.dataset.opt))));
  clRenderQuestions();
}

function submitCloze() {
  if (!clState) return;
  const total = clState.questions.length;
  const filled = Object.keys(clChoices).length;
  if (filled < total) { toastMsg('还有 ' + (total - filled) + ' 个空格未填'); return; }
  clScore.total++;
  let correct = 0;
  clState.questions.forEach((q, i) => {
    q.showCorrect = true;
    if (clNormalize(clChoices[i]) === clNormalize(q.answer)) correct++;
  });
  clScore.correct += correct;
  clRenderScore();
  clRenderQuestions();
  // 显示每题对错 + 反馈到右侧
  let html = pfHero(correct + ' / ' + total, '正确率');
  html += pfSection('📝 逐题答案', '<div class="pf-list">' + clState.questions.map((q, i) => {
    const ok = clNormalize(clChoices[i]) === clNormalize(q.answer);
    const tone = ok ? 'green' : 'red';
    return '<div class="pf-item ' + tone + '"><div class="md-content">' + renderMD(q.sentence) + '</div>' +
      '<div style="margin-top:4px;font-size:12px">' +
      '<span style="color:' + (ok ? 'var(--green)' : 'var(--red)') + '">你的: <b>' + esc(clChoices[i] || '(空)') + '</b></span>' +
      ' · <span style="color:var(--green)">答案: <b>' + esc(q.answer) + '</b></span></div></div>';
  }).join('') + '</div>');
  showModuleFeedback('cloze', correct + '/' + total, html);
  toastMsg(correct === total ? '🎉 全对！' : '📝 已评分，查看右侧');
}

function clozeShowAnswers() {
  if (!clState) return;
  clState.questions.forEach(q => q.showCorrect = true);
  // 自动填入正确答案
  clState.questions.forEach((q, i) => clChoices[i] = q.answer);
  clRenderCandidates();
  clRenderQuestions();
}

// ============================================================
// Wordle · 6 次机会猜单词
// ============================================================
let wlState = null; // {word, length, attempts, history:[[letters, status]]}
let wlInput = '';
let wlDone = false;

function wordleSource(src) {
  if (src === 'ai') wlGenerate();
  else wlPromptCustom();
}

function wlPromptCustom() {
  const w = prompt('输入你想让对方猜的 5-6 字母单词：', '');
  if (!w) return;
  const clean = (w.match(/[a-zA-Z]+/)?.[0] || '').toLowerCase();
  if (clean.length < 4 || clean.length > 7) { toastMsg('请输入 4-7 个字母的单词'); return; }
  document.getElementById('wlAiBtn').classList.remove('active');
  document.getElementById('wlCustomBtn').classList.add('active');
  wlStart(clean);
}

function extractWordleWord(text) {
  let s = stripThinking(text || '').toLowerCase();
  // 去除外层 markdown 代码块与 JSON 块，避免 "word" 字段名或代码包裹被误识别
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\{[\s\S]*?\}/g, ' ');
  // 去掉常见前缀（"the word is apple", "here is: apple" 等）
  s = s.replace(/\bthe\s+word\s+is\b[^\n]*?([a-z]+)/g, '$1');
  s = s.replace(/\bhere'?s?\s+(?:a|an)\s+word\b[^\n]*?([a-z]+)/g, '$1');
  // 只接受 5 或 6 字母的纯英文单词
  const m = s.match(/\b[a-z]{5,6}\b/);
  return m ? m[0] : '';
}

async function wlGenerate() {
  document.getElementById('wlAiBtn').classList.add('active');
  document.getElementById('wlCustomBtn').classList.remove('active');
  const prompt = 'You are picking a single English Wordle-style word. Output rules (strict):\n' +
    '- Exactly 5 or 6 letters, lowercase, common English.\n' +
    '- Reply with ONLY the word. No quotes, no JSON, no markdown, no explanation, no preamble.\n' +
    '- Do not include the word "word" or any other commentary.';
  const tryOnce = async () => {
    const raw = await callAPI(
      [{ role: 'system', content: prompt }, { role: 'user', content: 'Word.' }],
      { temperature: 0.5, maxTokens: 200 }
    );
    return extractWordleWord(raw);
  };
  let word = '';
  for (let i = 0; i < 2 && !word; i++) {
    try { word = await tryOnce(); } catch (e) { /* retry */ }
  }
  if (!word) {
    toastMsg('AI 出题失败，使用备用词 apple');
    word = 'apple';
  }
  wlStart(word);
}

function wlStart(word) {
  wlState = { word, length: word.length, attempts: 0, maxAttempts: 6, history: [] };
  wlInput = '';
  wlDone = false;
  wlRenderBoard();
  wlRenderKeyboard();
  wlUpdateStatus();
}

function wordleNew() {
  if (document.getElementById('wlAiBtn').classList.contains('active')) wlGenerate();
  else wlPromptCustom();
}

function wlUpdateStatus() {
  if (!wlState) return;
  const left = wlState.maxAttempts - wlState.attempts;
  let msg = '🟩 ' + wlState.length + ' 字母 · 还剩 ' + left + ' 次';
  if (wlDone) {
    const lastRow = wlState.history[wlState.history.length - 1] || [];
    if (lastRow.every(s => s && s.status === 'right')) {
      msg = '🎉 答对了！' + wlState.word.toUpperCase();
    } else {
      msg = '❌ 答案：' + wlState.word.toUpperCase();
    }
  }
  const el = document.getElementById('wordleStatus');
  if (el) el.textContent = msg;
}

function wlRenderBoard() {
  if (!wlState) return;
  const board = document.getElementById('wordleBoard');
  const len = wlState.length;
  board.style.gridTemplateColumns = 'repeat(' + len + ', 52px)';
  let html = '';
  for (let r = 0; r < wlState.maxAttempts; r++) {
    const row = wlState.history[r] || [];
    for (let c = 0; c < len; c++) {
      const letter = (row[c] && row[c].letter) || (r === wlState.attempts ? (wlInput.charAt(c) || '') : '');
      const status = (row[c] && row[c].status) || '';
      const anim = (r === wlState.attempts && c === wlInput.length - 1 && letter) ? ' pop' : (row[c] ? ' flip' : '');
      html += '<div class="wl-cell ' + status + anim + '">' + letter.toUpperCase() + '</div>';
    }
  }
  board.innerHTML = html;
}

const WL_KEYS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['enter','z','x','c','v','b','n','m','back']
];

function wlRenderKeyboard() {
  if (!wlState) return;
  const wrap = document.getElementById('wordleKeyboard');
  // 计算每个字母的最终状态（按所有提交）
  const finalStatus = {};
  wlState.history.forEach(row => row.forEach(c => {
    const cur = finalStatus[c.letter];
    if (c.status === 'right') finalStatus[c.letter] = 'right';
    else if (c.status === 'mispos' && cur !== 'right') finalStatus[c.letter] = 'mispos';
    else if (!cur) finalStatus[c.letter] = 'absent';
  }));
  wrap.innerHTML = WL_KEYS.map(row =>
    '<div style="display:flex;justify-content:center;gap:4px;margin-bottom:4px">' +
    row.map(k => {
      const cls = k === 'enter' || k === 'back' ? 'wl-key wide' : 'wl-key';
      const statusCls = finalStatus[k] ? ' ' + finalStatus[k] : '';
      return '<button class="' + cls + statusCls + '" data-action="wl-key" data-arg1="' + k + '">' + (k === 'back' ? '⌫' : k.toUpperCase()) + '</button>';
    }).join('') + '</div>'
  ).join('');
}

function wlKey(k) {
  if (!wlState || wlDone) return;
  if (k === 'enter') {
    if (wlInput.length !== wlState.length) { toastMsg('字母数不够'); return; }
    wlSubmit();
  } else if (k === 'back') {
    wlInput = wlInput.slice(0, -1);
    wlRenderBoard();
  } else if (wlInput.length < wlState.length) {
    wlInput += k;
    wlRenderBoard();
  }
}

function wlSubmit() {
  const guess = wlInput;
  const target = wlState.word;
  const len = wlState.length;
  const row = [];
  const targetArr = target.split('');
  const status = Array(len).fill('absent');
  // 第一轮：精确匹配
  for (let i = 0; i < len; i++) {
    if (guess[i] === targetArr[i]) { status[i] = 'right'; targetArr[i] = null; }
  }
  // 第二轮：错位
  for (let i = 0; i < len; i++) {
    if (status[i] === 'right') continue;
    const idx = targetArr.indexOf(guess[i]);
    if (idx >= 0) { status[i] = 'mispos'; targetArr[idx] = null; }
  }
  // 记录
  const rowData = [];
  for (let i = 0; i < len; i++) rowData.push({ letter: guess[i], status: status[i] });
  wlState.history.push(rowData);
  wlState.attempts++;
  wlInput = '';
  // 判断胜负
  const allRight = status.every(s => s === 'right');
  if (allRight) wlDone = true;
  else if (wlState.attempts >= wlState.maxAttempts) wlDone = true;
  wlRenderBoard();
  wlRenderKeyboard();
  wlUpdateStatus();
}

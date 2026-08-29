/* ============================================================
   AI 英语对话教练 — 难度、写作题库、翻译题库与翻译规则版本
   由 js/app.js 拆分而来（原 5142-5409 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Init ---------- */
function updateDifficulty() {
  currentLevel = parseInt(document.getElementById('difficulty').value);
  const labels = ['', 'CET-初', 'CET-初', 'CET-4', 'CET-4', 'CET-5', 'CET-6', 'CET-6+', 'CET-7', 'CET-8', 'CET-8+'];
  document.getElementById('diffLabel').textContent = labels[currentLevel] || currentLevel;
}

/* ============================================================
   首页 + 六大功能模块：Chat / Reading / Practice / Writing / Translation / Game
   ============================================================ */

// ---- 题库 ----
const WRITING_TOPICS = [
  'The impact of social media on society', 'Should college students take part-time jobs?',
  'The importance of environmental protection', 'My view on the future of AI',
  'The advantages and disadvantages of online learning', 'How to deal with stress in modern life',
  'The role of traditional culture in modern society', 'Should teenagers be allowed to use smartphones?',
  'The importance of lifelong learning', 'My ideal job',
  'The pros and cons of studying abroad', 'How to build a healthy lifestyle',
  'The value of friendship', 'Should we abolish the college entrance examination?',
  'The impact of technology on interpersonal relationships'
];
// 翻译题库：按分类组织，每个分类有 label 和题目数组
const TRANSLATION_BANK = {
  gaokao: {
    label: '高考英语',
    items: [
      { zh: '随着中国经济的发展，人们的生活水平有了显著提高。', ref: 'With the development of China\'s economy, people\'s living standards have improved significantly.' },
      { zh: '越来越多的大学生利用暑假参加社会实践活动，以拓宽视野。', ref: 'More and more college students take part in social practice activities during summer vacations to broaden their horizons.' },
      { zh: '环境保护是当今世界面临的最紧迫的挑战之一。', ref: 'Environmental protection is one of the most urgent challenges facing the world today.' },
      { zh: '这本书不仅有趣，而且富有教育意义，值得一读。', ref: 'This book is not only interesting but also educational and worth reading.' },
      { zh: '我们应该珍惜时间，因为时间一去不复返。', ref: 'We should cherish time, because time never returns once gone.' },
      { zh: '越来越多的人意识到健康的生活方式的重要性。', ref: 'More and more people have realized the importance of a healthy lifestyle.' },
      { zh: '在数字化时代，传统技艺面临着失传的危险。', ref: 'In the digital age, traditional skills are in danger of being lost.' },
      { zh: '他虽然年轻，但已经取得了令人瞩目的成就。', ref: 'Although he is young, he has already achieved remarkable accomplishments.' },
      { zh: '这部纪录片让我对中国传统文化有了更深的了解。', ref: 'This documentary gave me a deeper understanding of traditional Chinese culture.' },
      { zh: '我们应该学会与他人合作，因为团队合作至关重要。', ref: 'We should learn to cooperate with others, because teamwork is of great importance.' }
    ]
  },
  kaoyan: {
    label: '考研英语',
    items: [
      { zh: '随着互联网的普及，人们获取信息的方式发生了根本性的变化。', ref: 'With the popularization of the Internet, the way people access information has undergone fundamental changes.' },
      { zh: '政府应当采取有效措施来缓解城市交通拥堵问题。', ref: 'The government should take effective measures to alleviate urban traffic congestion.' },
      { zh: '人工智能的发展既带来了机遇，也带来了挑战。', ref: 'The development of artificial intelligence has brought both opportunities and challenges.' },
      { zh: '许多研究表明，定期锻炼对身心健康都有显著的益处。', ref: 'Many studies have shown that regular exercise has significant benefits for both physical and mental health.' },
      { zh: '全球化背景下，文化的多样性应当得到尊重和保护。', ref: 'In the context of globalization, cultural diversity should be respected and protected.' },
      { zh: '教育不仅是传授知识，更重要的是培养批判性思维能力。', ref: 'Education is not only about imparting knowledge, but more importantly about cultivating critical thinking skills.' },
      { zh: '可持续发展要求我们在经济增长与环境保护之间寻求平衡。', ref: 'Sustainable development requires us to seek a balance between economic growth and environmental protection.' },
      { zh: '社交媒体的兴起改变了人们交流和获取信息的方式。', ref: 'The rise of social media has changed the way people communicate and access information.' },
      { zh: '只有在充分尊重知识产权的前提下，创新才能蓬勃发展。', ref: 'Innovation can flourish only with full respect for intellectual property rights.' },
      { zh: '面对全球性挑战，没有任何一个国家能够独善其身。', ref: 'In the face of global challenges, no single country can remain unaffected.' }
    ]
  },
  cet4: {
    label: '大学英语四级',
    items: [
      { zh: '每天锻炼身体对保持健康很重要。', ref: 'Exercising every day is very important for staying healthy.' },
      { zh: '我们应该尽可能多读英文原著来提高阅读能力。', ref: 'We should read as many English originals as possible to improve our reading ability.' },
      { zh: '互联网在我们的日常生活中扮演着越来越重要的角色。', ref: 'The Internet plays an increasingly important role in our daily life.' },
      { zh: '他花了三年时间才完成这部小说。', ref: 'It took him three years to finish the novel.' },
      { zh: '如果你坚持每天练习说英语，你的口语会有很大的进步。', ref: 'If you keep practicing speaking English every day, your spoken English will improve a lot.' },
      { zh: '这家餐厅的菜味道好，价格也合理。', ref: 'This restaurant serves tasty food at reasonable prices.' },
      { zh: '这个博物馆每天都吸引着成千上万的参观者。', ref: 'The museum attracts thousands of visitors every day.' },
      { zh: '我花了两个小时才把作业做完。', ref: 'It took me two hours to finish my homework.' },
      { zh: '无论你做什么，都要尽自己最大的努力。', ref: 'Whatever you do, try your best.' },
      { zh: '昨天晚上我看了部很感人的电影。', ref: 'Last night I watched a very moving movie.' },
      { zh: '这座城市的公共交通既方便又便宜。', ref: 'The public transportation in this city is both convenient and cheap.' },
      { zh: '我每天早晨起床后都会喝一杯咖啡。', ref: 'I have a cup of coffee every morning after I get up.' }
    ]
  },
  cet6: {
    label: '大学英语六级',
    items: [
      { zh: '大量研究表明，长期睡眠不足会显著增加患慢性病的风险。', ref: 'Numerous studies have shown that chronic sleep deprivation significantly increases the risk of chronic diseases.' },
      { zh: '政府在推动经济结构转型的同时，也应注重环境保护。', ref: 'While promoting economic structural transformation, the government should also pay attention to environmental protection.' },
      { zh: '只有当个人利益与集体利益相协调时，社会才能和谐发展。', ref: 'A society can only develop harmoniously when individual interests are coordinated with collective interests.' },
      { zh: '尽管这项技术取得了一些进展，但距离大规模商业应用仍有距离。', ref: 'Although the technology has made some progress, it is still far from large-scale commercial application.' },
      { zh: '他之所以成功，是因为他从未放弃对梦想的追求。', ref: 'The reason for his success is that he never gave up pursuing his dream.' },
      { zh: '随着人们生活水平的提高，旅游已经成为一种流行的休闲方式。', ref: 'With the improvement of people\'s living standards, tourism has become a popular way of leisure.' },
      { zh: '教师不仅要传授知识，更应激发学生独立思考的能力。', ref: 'Teachers should not only impart knowledge but also inspire students to think independently.' },
      { zh: '如今，越来越多的企业开始关注员工的职业发展与心理健康。', ref: 'Nowadays, more and more companies begin to pay attention to employees\' career development and mental health.' },
      { zh: '在做出重大决定之前，最好充分了解相关信息。', ref: 'Before making a major decision, it is best to fully understand the relevant information.' },
      { zh: '尽管面临诸多挑战，该公司依然坚持其创新发展战略。', ref: 'Despite facing many challenges, the company still adheres to its innovative development strategy.' }
    ]
  },
  ielts: {
    label: '雅思',
    items: [
      { zh: '随着全球化的加速，掌握一门外语变得越来越重要。', ref: 'With the acceleration of globalization, mastering a foreign language has become increasingly important.' },
      { zh: '许多研究表明，童年时期的阅读习惯对一个人的终身发展有深远影响。', ref: 'Many studies have shown that reading habits formed in childhood have a profound influence on a person\'s lifelong development.' },
      { zh: '政府应当鼓励企业采用更环保的生产方式，以减少污染。', ref: 'The government should encourage enterprises to adopt more environmentally friendly production methods in order to reduce pollution.' },
      { zh: '在我看来，传统手工艺的传承不仅关系到技艺本身，更关系到文化的延续。', ref: 'In my view, the inheritance of traditional handicrafts concerns not only the skills themselves, but also the continuity of culture.' },
      { zh: '越来越多的人开始意识到，过度依赖手机可能会影响人际交流的质量。', ref: 'More and more people are beginning to realize that over-reliance on mobile phones may affect the quality of interpersonal communication.' },
      { zh: '无论城市还是乡村，每个孩子都应当享有平等的教育机会。', ref: 'Whether in cities or rural areas, every child should enjoy equal educational opportunities.' },
      { zh: '这项研究表明，定期锻炼不仅能改善身体健康，还能缓解压力。', ref: 'The study shows that regular exercise can not only improve physical health but also relieve stress.' },
      { zh: '应对气候变化需要全球合作，没有任何国家可以置身事外。', ref: 'Addressing climate change requires global cooperation, and no country can stand aside.' }
    ]
  },
  toefl: {
    label: '托福',
    items: [
      { zh: '科学家们一直在努力寻找治疗这种疾病更有效的方法。', ref: 'Scientists have been working hard to find more effective methods to treat this disease.' },
      { zh: '城市化进程加快带来了许多社会问题，需要政府加以重视。', ref: 'The acceleration of urbanization has brought many social problems that need the government\'s attention.' },
      { zh: '历史遗迹的保护对于理解一个国家的文化传统至关重要。', ref: 'The preservation of historical sites is essential to understanding a country\'s cultural traditions.' },
      { zh: '许多专家认为，气候变化是当今人类面临的最严峻挑战之一。', ref: 'Many experts believe that climate change is one of the most severe challenges humanity faces today.' },
      { zh: '随着技术的不断进步，传统的教育模式正在发生深刻变化。', ref: 'With the continuous advancement of technology, traditional educational models are undergoing profound changes.' },
      { zh: '在他看来，学习一门外语不仅是掌握一项技能，更是理解一种文化。', ref: 'In his view, learning a foreign language is not only about acquiring a skill, but also about understanding a culture.' },
      { zh: '这项新技术有望彻底改变人们日常交流的方式。', ref: 'This new technology is expected to completely change the way people communicate in daily life.' },
      { zh: '越来越多的研究表明，长期的心理压力可能导致多种健康问题。', ref: 'More and more studies show that long-term psychological stress may lead to various health problems.' }
    ]
  }
};
// 翻译题库"通用混合"（随机从所有分类抽）

function flattenTrBank() {
  const all = [];
  for (const k of Object.keys(TRANSLATION_BANK)) {
    for (const it of TRANSLATION_BANK[k].items) all.push(it);
  }
  return all;
}

/* ============================================================
   翻译规则版本（设置面板可切换）
   ============================================================ */
const TRANSLATION_RULES = {
  gaokao: {
    label: '高考版（必用词 + 一句话）',
    desc: '翻译必须使用「词」字段里列出的所有词（词性不变，可变式；首字母大写者必须用于句首）；高考题默认翻译为完整的一句话，避免分号。'
  },
  standard: {
    label: '标准版（必用词 + 自然分句）',
    desc: '翻译必须使用「词」字段里列出的所有词；可使用多个分句或分号，追求自然流畅。'
  },
  legacy: {
    label: '旧版（仅通用评分，不强制必用词）',
    desc: '不强制使用「词」字段；只做常规翻译评分。'
  }
};

function getTranslationRuleVersion() {
  const v = getSetting('translationRuleVersion', null);
  if (v && TRANSLATION_RULES[v]) return v;
  // 默认：当前题库来自「上海高考」（含必用词）→ 高考版；否则标准版
  const sel = document.getElementById('trCategorySelect');
  const catKey = (sel && sel.value) || (currentTranslation && currentTranslation._catKey) || '';
  if (typeof catKey === 'string' && /上海高考/i.test(catKey)) return 'gaokao';
  if (currentTranslation && currentTranslation._catKey && /上海高考/i.test(currentTranslation._catKey)) return 'gaokao';
  return 'standard';
}

/* 构造翻译评分 prompt（支持必用词 + 单句/多分句规则） */
function buildTranslationEvalPrompt(opts) {
  const { words = [], ruleVersion = 'standard' } = opts;
  const lines = [];
  lines.push('You are an English translation examiner. Evaluate the user\'s English translation of a Chinese sentence.');
  lines.push('Score (0-10) and provide feedback in Chinese.');
  // 必用词约束
  if (ruleVersion !== 'legacy' && words && words.length) {
    lines.push('');
    lines.push('=== 必用词（REQUIRED WORDS）===');
    lines.push('用户必须使用下列每一个词（含变式：过去式、第三人称单数、-ing、-ed、被动、形容词副词等词性派生形式）：');
    lines.push(words.map((w, i) => (i + 1) + '. ' + w).join('\n'));
    lines.push('规则：');
    lines.push('· 词性不变（同一词类；如有多个词性可任选其一）');
    lines.push('· 可使用变式（past / -ed / -s / -ing / 被动 / 大小写调整 / 名词复数 等）');
    lines.push('· 严格大小写要求：如果「词」在原文中首字母大写，用户的翻译中此词必须在句子开头；若在句中用过则大小写不变');
    lines.push('· 每个必用词在翻译中至少出现一次（接受语义等价/派生/同根词），缺少任何一项须明确指出');
    if (ruleVersion === 'gaokao') {
      lines.push('· 上海高考版：必用词 + 单句输出（尽量不使用分号 ; 拆分多句）。必须把整句翻译为完整的一句英语。');
    } else {
      lines.push('· 标准版：可使用 2-3 个分句或分号；优先追求表达自然流畅。');
    }
    lines.push('');
    lines.push('在你的反馈里，明确列出：');
    lines.push('- "missing_words": [列出用户翻译中未使用 / 未用变式体现的必用词]');
    lines.push('- "capital_issues": [列出首字母大写却没在句首的必用词]');
    lines.push('');
  }
  if (ruleVersion === 'gaokao') {
    lines.push('=== 高考风格提示 ===');
    lines.push('高考翻译评分通常要求：');
    lines.push('· 句子结构完整，无语法错误；');
    lines.push('· 必用词必须用上；');
    lines.push('· 全文为一句话，不分句（除非不拆会导致超长）；');
    lines.push('· 尽量用你提供的 8-10 范围给分；表达地道、无错误 9-10；');
  }
  lines.push('');
  lines.push('Return ONLY valid JSON (no markdown, no thinking):');
  lines.push('{');
  lines.push('  "score": "score out of 10 with brief Chinese comment, e.g. 7/10 — 基本准确，部分表达可改进",');
  lines.push('  "errors": ["specific errors or suggestions in Chinese"],');
  lines.push('  "missing_words": ["words the user failed to use (REQUIRED). Omit field if no words required."],');
  lines.push('  "capital_issues": ["words the user placed incorrectly regarding capitalization. Omit if none."],');
  lines.push('  "better_translation": "a better English version if applicable (MUST use all required words, and obey the sentence-count rule)",');
  lines.push('  "segments": [{"text": "part of the user\'s translation", "type": "correct|error|improve", "note": "Chinese explanation"}]');
  lines.push('}');
  lines.push('');
  lines.push('Important: The "segments" field must cover the ENTIRE user\'s translation, breaking it into consecutive parts. Each segment has: text (exact substring), type (correct=正确, error=翻译错误, improve=表达不地道或可改进), note (Chinese explanation). Join all segments\' text in order to reconstruct the user\'s translation exactly.');
  return lines.join('\n');
}

/* ---------- 必用词匹配 ----------
   题库「词」字段形态多样，只做「单词全等 + 去后缀」会大量误报：
     defer              译文写 defers            （需要正向展开变式，而非只反向去后缀）
     stop               译文写 stopped           （双写辅音）
     gaze v.            词性标注不是词的一部分
     in case / Not only 多词短语，被分词切开后永远匹配不到
     the more…the more  省略号连接的句型骨架，需要出现两次
   因此拆成四步：去词性标注 → 拆句型骨架 → 短语按词序列匹配 → 单词按变式集合双向匹配。 */

// 'gaze v.' / 'affect vt.' / 'quantity n.' → 'gaze' / 'affect' / 'quantity'
function stripPosTag(word) {
  return String(word || '')
    .replace(/\b(?:n|v|vt|vi|adj|adv|prep|conj|pron|art|int|num|aux|abbr)\.\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 小写化，只保留字母/数字/撇号/连字符，词间单空格
function normalizeWordText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\u2019\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordTokens(s) {
  return normalizeWordText(s).split(' ').filter(Boolean);
}

function stripApostrophes(s) {
  return String(s || '').replace(/['\u2019]/g, '');
}

// 原形 → 可能的书写变式（正向展开）
function wordFormSet(word) {
  const w = stripApostrophes(normalizeWordText(word));
  const out = new Set();
  if (!w) return out;
  out.add(w);
  const add = (x) => { if (x && x.length > 1) out.add(x); };
  add(w + 's'); add(w + 'es'); add(w + 'ed'); add(w + 'd');
  add(w + 'ing'); add(w + 'ly'); add(w + 'er'); add(w + 'est');
  if (/[^aeiou]y$/.test(w)) {
    const b = w.slice(0, -1);
    add(b + 'ies'); add(b + 'ied'); add(b + 'ier'); add(b + 'iest'); add(b + 'ily');
  }
  if (/e$/.test(w)) {
    const b = w.slice(0, -1);
    add(b + 'ing'); add(b + 'ed'); add(b + 'er'); add(b + 'est');
  }
  // 重读闭音节双写末尾辅音：stop → stopped / stopping
  if (/^[a-z]*[aeiou][bdglmnprt]$/.test(w)) {
    const d = w + w.slice(-1);
    add(d + 'ed'); add(d + 'ing'); add(d + 'er'); add(d + 'est');
  }
  return out;
}

// 变式 → 可能的原形（反向还原）；与 wordFormSet 取交集可覆盖大部分不规则写法
function wordBaseSet(token) {
  const t = stripApostrophes(normalizeWordText(token));
  const out = new Set();
  if (!t) return out;
  out.add(t);
  const add = (x) => { if (x && x.length > 1) out.add(x); };
  if (t.endsWith('ies') && t.length > 4) { add(t.slice(0, -3) + 'y'); add(t.slice(0, -2)); }
  if (t.endsWith('ied') && t.length > 4) add(t.slice(0, -3) + 'y');
  if (t.endsWith('es') && t.length > 3) { add(t.slice(0, -2)); add(t.slice(0, -1)); }
  if (t.endsWith('s') && t.length > 3) add(t.slice(0, -1));
  if (t.endsWith('ed') && t.length > 3) { add(t.slice(0, -2)); add(t.slice(0, -1)); }
  if (t.endsWith('ing') && t.length > 4) { add(t.slice(0, -3)); add(t.slice(0, -3) + 'e'); }
  if (t.endsWith('ly') && t.length > 3) add(t.slice(0, -2));
  if (t.endsWith('er') && t.length > 3) { add(t.slice(0, -2)); add(t.slice(0, -1)); }
  if (t.endsWith('est') && t.length > 4) { add(t.slice(0, -3)); add(t.slice(0, -2)); }
  // stopped → stop
  const m = t.match(/^([a-z]*[aeiou])([bdglmnprt])\2(?:ed|ing|er|est)$/);
  if (m) add(m[1] + m[2]);
  return out;
}

// 必用词的某个成分与译文里的某个词是否算同一个词
function formsMatch(requiredWord, token) {
  const tk = stripApostrophes(normalizeWordText(token));
  if (!tk) return false;
  if (wordFormSet(requiredWord).has(tk)) return true;
  const bases = wordBaseSet(requiredWord);
  for (const b of wordBaseSet(token)) if (bases.has(b)) return true;
  return false;
}

// 短语在词序列中按顺序出现的次数（不重叠计数）
function countPhraseOccurrences(phrase, textTokens) {
  const parts = wordTokens(phrase);
  if (!parts.length) return 0;
  let count = 0;
  let i = 0;
  while (i + parts.length <= textTokens.length) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (!formsMatch(parts[j], textTokens[i + j])) { ok = false; break; }
    }
    if (ok) { count++; i += parts.length; } else i++;
  }
  return count;
}

function phraseUsedInTokens(phrase, textTokens) {
  return countPhraseOccurrences(phrase, textTokens) > 0;
}

// 'the more…the more' → ['the more','the more']；'so … that …' → ['so','that']
function requiredWordParts(word) {
  return stripPosTag(word)
    .split(/[\u2026]+|\.\.\.+|\/|\u3001/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 单个必用词是否已用上（句型骨架里重复出现的成分需要出现对应次数）
function requiredWordUsed(text, word) {
  const tokens = wordTokens(text);
  if (!tokens.length) return false;
  const parts = requiredWordParts(word);
  if (!parts.length) return true;
  const need = new Map();
  for (const p of parts) {
    const k = normalizeWordText(p);
    if (k) need.set(k, (need.get(k) || 0) + 1);
  }
  for (const [p, n] of need) {
    if (countPhraseOccurrences(p, tokens) < n) return false;
  }
  return true;
}

// 首字母大写的必用词要求出现在句首
function capitalRequirementMet(text, word) {
  const first = requiredWordParts(word)[0];
  if (!first) return true;
  const tokens = wordTokens(text);
  const parts = wordTokens(first);
  if (!tokens.length || !parts.length) return false;
  if (parts.length > tokens.length) return false;
  for (let j = 0; j < parts.length; j++) {
    if (!formsMatch(parts[j], tokens[j])) return false;
  }
  return true;
}

/* 本地快速检查：用户的翻译里是否用上了所有必用词 */
function checkRequiredWordsUsed(text, words) {
  const result = { missing: [], capitalViolations: [] };
  if (!text || !words || !words.length) return result;
  for (const w of words) {
    if (!requiredWordUsed(text, w)) {
      result.missing.push(w);
      continue;
    }
    // 只在确实用上之后再校验位置，避免同一个词同时出现在两个列表里
    if (/^[A-Z]/.test(stripPosTag(w)) && !capitalRequirementMet(text, w)) {
      result.capitalViolations.push(w);
    }
  }
  return result;
}

// 把外部导入的上海高考题库并入 TRANSLATION_BANK（在 DOMContentLoaded 时调用）
function mergeShGaokaoBank() {
  if (typeof window === 'undefined' || !window.SH_GAOKAO_BANK) return;
  for (const k of Object.keys(window.SH_GAOKAO_BANK)) {
    if (TRANSLATION_BANK[k]) continue; // 不覆盖已有分类
    TRANSLATION_BANK[k] = window.SH_GAOKAO_BANK[k];
  }
}
const CHARADE_BANK = [
  { word: 'penguin', hint: 'a black and white bird that cannot fly' },
  { word: 'umbrella', hint: 'something you hold over your head when it rains' },
  { word: 'volcano', hint: 'a mountain that can erupt with hot lava' },
  { word: 'giraffe', hint: 'a very tall animal with a long neck' },
  { word: 'lighthouse', hint: 'a tower with a bright light that guides ships' },
  { word: 'backpack', hint: 'a bag you wear on your shoulders to carry things' },
  { word: 'telescope', hint: 'a tool that makes distant objects look closer' },
  { word: 'hammock', hint: 'a piece of cloth or net you sleep in, hung between two trees' },
  { word: 'tornado', hint: 'a violent rotating column of air' },
  { word: 'scarecrow', hint: 'a figure dressed in old clothes, placed in a field to frighten birds' }
];

/* ============================================================
   阅读练习：文章、题目生成、判分与打印导出
   由 js/app.js 拆分而来
   ============================================================ */
'use strict';
const GAME_READING_ARTICLE={title:'How Cities Learn to Adapt',paragraphs:[
  'Cities are often described as machines, but they behave more like living systems. They absorb people, habits, money, and ideas, then change in ways that no single planner can completely predict. A street redesigned for buses may later become a safer route for children, while a neglected park can become a cooling refuge during a heatwave.',
  'That is why adaptation matters as much as construction. A city facing hotter summers may plant trees, redesign streets, open public buildings as cooling centers, and change building rules. None of these measures works alone. Their value depends on whether residents can reach them, understand them, and help improve them.',
  'The most successful projects usually begin with careful observation. Officials talk to commuters, shop owners, children, and older residents before deciding what to change. Sensors can reveal traffic and temperature, but a map cannot explain why a parent avoids a crossing or why a shop closes earlier than expected.',
  'Adaptation also requires patience. Benefits may arrive slowly, while costs are immediate and visible. Communities need ways to measure progress, publish results, and correct mistakes. A pilot project is useful only when its failures are treated as evidence rather than hidden as embarrassment.',
  'Resilience therefore includes institutions as well as infrastructure. Schools can teach emergency routines, hospitals can coordinate during extreme weather, and neighborhood groups can check on people who live alone. These networks make a response faster because trust has already been built before a crisis begins.',
  'A resilient city is one that learns quickly, protects vulnerable residents, and turns experience into better decisions. It does not promise that disruption can be eliminated. Instead, it gives people a fairer chance to recover, participate, and prepare for the next change.',
  'Learning from disruption is harder than simply recording it. After a storm, officials may be tempted to count repaired roads and reopened offices, because those numbers are easy to report. Residents remember different details: whether warnings arrived in time, whether elevators worked, whether medicine reached people who could not travel, and whether officials explained what would happen next. These experiences should be collected systematically rather than treated as private complaints.',
  'Good planning also recognizes that adaptation can create new inequalities. A redesigned waterfront may protect one district while making another more vulnerable to flooding. A digital warning system may reach smartphone users but exclude people with limited data, disabilities, or little confidence in official messages. For that reason, public projects need several channels of communication and regular checks on who benefits. Fairness is not an optional decoration added after construction; it is part of the design itself.',
  'Small experiments can help cities make better choices. A temporary bus lane, a shaded schoolyard, or a neighborhood cooling room can be tested before a large budget is committed. The test should have a clear question, a way to collect evidence, and a plan for changing course. Failure is useful when it reveals an assumption that was wrong. Without honest evaluation, however, a pilot becomes only a performance designed to justify a decision already made.',
  'The strongest adaptation plans therefore connect daily habits with long-term policy. Residents can save energy, check on neighbors, and report unsafe places, while institutions invest in drainage, public health, education, and reliable transport. Neither side can succeed alone. When a city treats local knowledge as evidence and makes its decisions transparent, each disruption becomes a lesson. Over time, that habit of learning may be more valuable than any single wall, sensor, or emergency announcement.',
  'Adaptation is also a question of time. A measure that works during one unusually hot summer may fail when a heatwave lasts twice as long or arrives after a power cut. Planners therefore need scenarios rather than one perfect forecast. They can ask what happens if buses are delayed, if a shelter becomes crowded, or if a warning is misunderstood. Thinking through these possibilities does not make a city fearful; it makes its choices more deliberate. It also helps officials explain why a modest investment today can prevent a larger loss later.',
  'Residents often notice the first signs of trouble before an official report is published. A caretaker may see that a drain is blocked, a nurse may recognize that older patients are struggling with heat, and a delivery worker may know which streets become impassable after rain. Such observations are valuable only when institutions provide safe and simple ways to share them. Public meetings, telephone lines, accessible forms, and trusted community groups can turn scattered observations into a pattern that decision makers can investigate.',
  'A resilient city is therefore not a finished object. It is a continuing relationship between evidence, trust, and revision. Residents can save energy, check on neighbors, and report unsafe places, while institutions invest in drainage, public health, education, and reliable transport. Neither side can succeed alone. When a city treats local knowledge as evidence and makes its decisions transparent, each disruption becomes a lesson. The process asks people to remain curious even after the immediate danger has passed.'
  ,'Learning systems need memory as well as action. After an emergency, reports should record which assumptions were correct, which groups were missed, and which promises were difficult to keep. Those records should remain available when staff change, budgets tighten, or public attention moves elsewhere. Schools and libraries can help preserve local stories, while universities can compare them with measurements from sensors and surveys. The purpose is not to create a perfect archive. It is to make the next decision less dependent on guesswork and more open to correction. In this sense, resilience is a civic habit: people expect evidence, listen to one another, and accept that a good plan may need to change.'
]};
let gameReadingCurrent=null;

// The featured article is an offline, authored pack. It must remain usable when
// the model service is unavailable; RSS and AI sources still use live generation.
const READING_PREPARED_QUESTION_BANK = (() => {
  const clozeRows = [
    ['When the weather service forecast a storm, the garden group moved its tools under cover before the rain ____.', ['began','settled','passed','spread'], 0],
    ['By morning, water had collected along the lower path, so the volunteers first ____ how deep it was.', ['measured','guessed','announced','doubted'], 0],
    ['They marked the unsafe section with bright tape to keep visitors from ____ into the mud.', ['stepping','turning','looking','calling'], 0],
    ['Rather than start repairs at once, the team made a short ____ of the damage.', ['record','promise','purchase','speech'], 0],
    ['Several raised beds were still stable, while two others had ____ at one corner.', ['collapsed','expanded','waited','arrived'], 0],
    ['A neighbor who worked as a carpenter offered to ____ the broken frames.', ['reinforce','decorate','borrow','observe'], 0],
    ['The group reused sound boards, but set aside any piece that was too ____ to support soil.', ['warped','smooth','narrow','painted'], 0],
    ['They divided the work into small tasks so that newcomers could ____ without special training.', ['participate','withdraw','compete','complain'], 0],
    ['One volunteer drew a simple plan, which helped everyone ____ where each repaired bed would go.', ['visualize','forget','question','measure'], 0],
    ['Before lifting the heavier frame, the volunteers checked that they had enough people to move it ____.', ['safely','quietly','rarely','equally'], 0],
    ['A disagreement arose over the path, but the group listened until they found a ____ solution.', ['workable','distant','private','instant'], 0],
    ['They widened one section while keeping another narrow to ____ space for a wheelchair to turn.', ['reserve','remove','discover','compare'], 0],
    ['The repair took longer than expected, yet the team did not ____ the final safety check.', ['skip','repeat','publish','borrow'], 0],
    ['After the work was finished, they tested the path with a loaded cart to see whether it was ____.', ['stable','familiar','silent','ordinary'], 0],
    ['The test revealed a loose board, so a carpenter ____ it before the garden reopened.', ['secured','painted','counted','delivered'], 0],
    ['A sign at the entrance explained which areas remained closed and ____ the reason clearly.', ['stated','hid','changed','guessed'], 0],
    ['The group also posted a list of materials it still needed, inviting neighbors to ____ what they could.', ['contribute','replace','translate','inspect'], 0],
    ['Within a week, people had brought spare lumber, gloves, and a ____ of useful hand tools.', ['variety','pair','piece','length'], 0],
    ['The volunteers kept notes on the repairs so the next storm response would be more ____.', ['efficient','doubtful','ordinary','distant'], 0],
    ['Their experience showed that a shared plan can turn a setback into an opportunity to ____ the community.', ['strengthen','separate','interrupt','measure'], 0]
  ];
  const cloze = clozeRows.map(([q, options, answer], index) => {
    const shift = index % options.length;
    const shuffled = options.slice(shift).concat(options.slice(0, shift));
    return { type: 'cloze', q, options: shuffled, answer: (answer - shift + options.length) % options.length };
  });
  const grammar = [
    ['The success of an emergency plan depends on its (accessible) to residents with disabilities.', 'accessibility'],
    ['Officials should not make a decision before (consult) the people affected by it.', 'consulting'],
    ['Several older neighborhoods (experience) higher temperatures than the city average last summer.', 'experienced'],
    ['A warning that reaches only smartphone users may leave some residents (inform).', 'uninformed'],
    ['The maintenance costs must be (include) in the original budget.', 'included'],
    ['The city is considering (open) public buildings as cooling centers during heatwaves.', 'opening'],
    ['The data (show) that shade is unevenly distributed across the district.', 'show'],
    ['If residents had been asked earlier, the unsafe crossing (redesign) before construction began.', 'would have been redesigned'],
    ['The report recommends that each department (take) clear responsibility for repairs.', 'take'],
    ['A project should be reviewed regularly so that ineffective measures (replace) in time.', 'can be replaced']
  ].map(([q, answer]) => ({ type: 'grammar', q, answer }));
  const sevenCorrect = [
    'A citywide average can hide the sharply different risks faced by individual neighborhoods.',
    'A facility shown on a map is not necessarily easy or safe for everyone to reach.',
    'Planners should compare service data with accounts of people\'s daily journeys.',
    'Those accounts can explain barriers that a travel-time figure alone cannot reveal.',
    'The city can then revise routes, opening hours, or the location of services.'
  ];
  const sevenDistractors = [
    'For this reason, every district should receive precisely the same number of buildings.',
    'Once a center opens, there is no need to ask how residents use it.'
  ];
  const sevenOrder = [2, 0, 4, 1, 5, 3, 6];
  const seven = [{
    type: 'seven',
    q: 'Extreme weather rarely affects every resident in the same way. (1) ____ A cooling center, for instance, is of little use to someone who cannot reach it safely. (2) ____ Officials should therefore ask not only how many facilities exist, but who can use them. (3) ____ They can compare travel times with residents\' accounts. (4) ____ If the evidence reveals a barrier, planners can adjust routes or opening hours. (5) ____',
    options: sevenOrder.map(index => index < 5 ? sevenCorrect[index] : sevenDistractors[index - 5]),
    answer: [1, 3, 0, 5, 2],
    explanation: 'The passage moves from unequal exposure, to access, to gathering evidence, interpreting it, and revising services.'
  }];
  const reading = [
    ['A city reports that it planted 2,000 trees, but residents in the hottest blocks still lack shade. What is the strongest conclusion?', ['The planting target proves the project succeeded.','The city measured an activity, but has not shown that the intended benefit reached exposed residents.','Residents should be asked to plant the remaining trees themselves.','Temperature data should be replaced by construction totals.'], 1],
    ['Why does the author contrast a model\'s ideal wetland site with families\' concerns about a walking route?', ['To argue that technical models are always inaccurate.','To show that local experience can reveal costs a technical analysis leaves out.','To suggest that families should make engineering decisions alone.','To prove that wetlands cannot reduce flood risk.'], 1],
    ['A city opens a cooling center but provides no evening transport. Which principle from the article is most directly at issue?', ['Infrastructure matters more than relationships.','The existence of a service does not guarantee practical access to it.','Every public building should remain open all night.','A city should avoid measuring service use.'], 1],
    ['What does the article suggest officials should do when a pilot project fails?', ['End public discussion to prevent confusion.','Treat the result as evidence and revise the plan where needed.','Describe the project as successful if construction is complete.','Repeat the same test without changing its assumptions.'], 1],
    ['Which statement best captures the author\'s view of resilience?', ['It is a finished condition achieved by building enough infrastructure.','It is a continuing capacity to learn, share responsibility, and adjust decisions.','It depends mainly on predicting exactly when a disruption will occur.','It is useful only during major emergencies.'], 1]
  ].map(([q, options, answer], index) => {
    const shift = index % options.length;
    return { type: 'reading', q, options: options.slice(shift).concat(options.slice(0, shift)), answer: (answer - shift + options.length) % options.length };
  });
  return Object.freeze([...cloze, ...grammar, ...seven, ...reading]);
})();

function readingPreparedQuestionBank(settings) {
  const types = settings.types.length ? settings.types : ['cloze', 'grammar', 'seven', 'reading'];
  const count = Math.max(1, Math.min(60, Number(settings.count) || 40));
  const pools = Object.fromEntries(types.map(type => [type, READING_PREPARED_QUESTION_BANK.filter(question => question.type === type)]));
  const capacities = Object.fromEntries(types.map(type => [type, type === 'seven' ? (pools[type].length ? 5 : 0) : pools[type].length]));
  const totalCapacity = Object.values(capacities).reduce((sum, size) => sum + size, 0);
  if (count > totalCapacity) throw new Error('精选题库中所选题型最多支持 ' + totalCapacity + ' 个作答点');
  const desired = Object.fromEntries(types.map(type => [type, 0]));
  const baseline = { cloze: 20, grammar: 10, seven: 5, reading: 5 };
  let remaining = count;
  for (const type of ['cloze', 'grammar', 'seven', 'reading']) {
    if (!types.includes(type)) continue;
    const amount = type === 'seven'
      ? (remaining >= 5 && capacities[type] >= 5 ? 5 : 0)
      : Math.min(baseline[type] || 0, capacities[type], remaining);
    desired[type] = amount;
    remaining -= amount;
  }
  while (remaining > 0) {
    const type = types.find(candidate => candidate !== 'seven' && desired[candidate] < capacities[candidate]);
    if (!type) break;
    desired[type]++;
    remaining--;
  }
  if (remaining) throw new Error('七选五每组必须包含五个空，请调整题数或题型');
  const selected = [];
  for (const type of types) {
    if (type === 'seven' && desired[type]) selected.push(...pools[type]);
    else selected.push(...pools[type].slice(0, desired[type]));
  }
  return selected;
}

function readingPracticeSettings() {
  const types = [...(document.getElementById('grTypes')?.selectedOptions || [])].map(x => x.value);
  return { source: document.getElementById('grSource')?.value || getSetting('readingPracticeSource', 'current'), types: types.length ? types : ['cloze','grammar','seven','reading'], count: Math.max(1, Math.min(60, Number(document.getElementById('grReadingCount')?.value || getSetting('readingPracticeCount', 40)))) };
}
function readingPracticeSaveSettings(s) { setSetting('readingPracticeSource', s.source); setSetting('readingPracticeTypes', s.types); setSetting('readingPracticeCount', s.count); }
function readingPracticeQuotas(settings) {
  const types = settings.types.length ? settings.types : ['cloze', 'grammar', 'seven', 'reading'];
  const count = Math.max(1, Math.min(60, Number(settings.count) || 40));
  const quotas = Object.fromEntries(types.map(type => [type, 0]));
  const points = Object.fromEntries(types.map(type => [type, 0]));
  const baseline = { cloze: 20, grammar: 10, seven: 5, reading: 5 };
  let remaining = count;
  for (const type of ['cloze', 'grammar', 'seven', 'reading']) {
    if (!types.includes(type)) continue;
    const amount = Math.min(baseline[type], remaining);
    points[type] += amount;
    remaining -= amount;
  }
  const fillTypes = types.filter(type => type !== 'seven');
  let cursor = 0;
  while (remaining > 0 && fillTypes.length) { points[fillTypes[cursor++ % fillTypes.length]]++; remaining--; }
  if (remaining) {
    if (remaining % 5) throw new Error('七选五每组必须包含五个空，请调整题数或题型');
    points.seven += remaining;
  }
  for (const type of types) quotas[type] = type === 'seven' ? points[type] / 5 : points[type];
  if (types.includes('seven') && points.seven % 5) throw new Error('七选五每组必须包含五个空，请调整题数或题型');
  return quotas;
}
function readingPracticeParseJSON(raw) { try { const text=String(raw||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim(); return JSON.parse(text); } catch(e) { return null; } }
function readingPracticeCallAPI(messages, options) {
  const opts = {...(options || {})};
  if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(240000);
  return callAPI(messages, opts);
}
async function readingPracticeGenerateAI(settings) {
  const articleRaw = await readingPracticeCallAPI([{role:'system',content:'You write difficult Shanghai Gaokao English reading material. Return JSON only: {"title":"...","paragraphs":["..."]}. Write 8-10 substantial paragraphs, at least 900 English words, coherent and factually cautious.'},{role:'user',content:'Generate a current-affairs style article for an advanced high-school learner. Avoid invented statistics and explain essential C1 words briefly in context.'}], {maxTokens:5000});
  const article = readingPracticeParseJSON(articleRaw);
  if (!article || !Array.isArray(article.paragraphs) || article.paragraphs.join(' ').split(/\s+/).length < 900) throw new Error('AI 文章长度不足 900 词或格式不合格，请重试');
  const questions = await readingPracticeGenerateQuestions(article, settings);
  return {title:article.title||'AI 阅读文章',paragraphs:article.paragraphs,questions};
}
async function readingPracticeGenerateQuestions(article, settings) {
  const text = article.paragraphs.join('\n\n');
  const requested = settings.types.length ? settings.types : ['cloze', 'grammar', 'seven', 'reading'];
  const quotas = readingPracticeQuotas(settings);
  const target = Object.values(quotas).reduce((sum, n) => sum + n, 0);
  const output = [];
  for (const type of requested) {
    for (let offset = 0; offset < quotas[type]; offset += 5) {
      const batchCount = Math.min(5, quotas[type] - offset);
      const raw = await readingPracticeCallAPI([
        { role: 'system', content: 'Create distinct, challenging Shanghai Gaokao English questions supported by the article. Return JSON only: {"questions":[{"type":"' + type + '","q":"...","options":["..."],"answer":"...","explanation":"...","hint":"..."}]}. Return exactly ' + batchCount + ' questions, all of type ' + type + '. Do not repeat a tested fact or paraphrase another stem. Cloze questions must use original, self-contained contexts not copied or lightly paraphrased from the article; their answer must not appear verbatim in the article. Grammar questions must test a form in a new sentence, not quote the article. Reading questions must require inference and must not be answered by copying one sentence. ' + (type === 'grammar' ? 'Every blank must show its supplied root word in parentheses; answer is the correctly inflected form.' : type === 'seven' ? 'This is a genuine Shanghai Gaokao seven-choose-five task: provide exactly seven distinct sentence options and answer as an array of five distinct option indexes from 0 to 6, in order, mapping gaps (1) through (5). The stem must contain a passage with all five numbered gaps (1), (2), (3), (4), and (5); each option fills exactly one gap.' : 'Every multiple choice question has four plausible options and one defensible answer.') },
        { role: 'user', content: 'Article:\n' + text + '\n\nCreate questions ' + (offset + 1) + '-' + (offset + batchCount) + ' of type ' + type + '. Avoid these existing stems:\n' + output.map(q => q.q).join('\n') }
      ], {});
      const parsed = readingPracticeParseJSON(raw);
      const batch = parsed && Array.isArray(parsed.questions) ? parsed.questions.map(readingNormalizeQuestion).filter(q => readingQuestionIsValid(q, type)) : [];
      if (batch.length !== batchCount) throw new Error('题目生成数量不足（' + type + '），请重试');
      const verifyRaw = await readingPracticeCallAPI([
        { role: 'system', content: 'Check every question for correctness, a single defensible answer, plausible distractors, and no duplicates. Cloze and grammar must use new contexts; reject them if the answer is stated verbatim in the article. Reading questions must require inference rather than quote a sentence. Return JSON only: {"ok":true,"questions":[...]} or {"ok":false,"questions":[]}. Preserve question type and grammar root hints.' },
        { role: 'user', content: 'Article:\n' + text + '\nQuestions:\n' + JSON.stringify(batch) }
      ], {});
      const verified = readingPracticeParseJSON(verifyRaw);
      const checked = verified && verified.ok !== false && Array.isArray(verified.questions) ? verified.questions.map(readingNormalizeQuestion).filter(q => readingQuestionIsValid(q, type)) : [];
      if (checked.length !== batchCount) throw new Error('题目校验未通过（' + type + '），请重试');
      for (const q of checked) {
        if (output.some(old => readingQuestionDuplicate(old, q))) throw new Error('生成的题目重复，请重试');
        output.push(q);
      }
    }
  }
  if (output.length !== target) throw new Error('题组未达到要求数量，请重试');
  return output;
}
function readingQuestionDuplicate(a, b) {
  const normalize = q => String(q.q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return a.type === b.type && normalize(a) === normalize(b);
}
function readingQuestionIsValid(question, type) {
  if (!question || question.type !== type || !question.q) return false;
  if (type === 'grammar') return /\([^)]{2,}\)/.test(question.q) && typeof question.answer === 'string' && !!question.answer.trim();
  const options = question.options;
  if (!Array.isArray(options) || options.some(option => !String(option).trim())) return false;
  if (type === 'seven') {
    const answer = question.answer;
    const gaps = [1, 2, 3, 4, 5].every(number => new RegExp('\\(' + number + '\\)').test(question.q));
    return options.length === 7 && Array.isArray(answer) && answer.length === 5 && new Set(answer).size === 5 && answer.every(index => Number.isInteger(index) && index >= 0 && index < 7) && gaps;
  }
  const answer = question.answer;
  return options.length >= 2 && (Number.isInteger(answer) ? answer >= 0 && answer < options.length : options.some(option => String(option).toLowerCase() === String(answer).toLowerCase()));
}
function readingNormalizeQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const out = {...q};
  out.type = ['cloze','grammar','seven','reading'].includes(out.type) ? out.type : (out.options ? 'reading' : 'grammar');
  out.q = String(out.q || out.question || '').trim();
  if (!out.q) return null;
  if (Array.isArray(out.options)) out.options = out.options.map(x => String(x));
  if (out.type === 'grammar' && out.hint && !/\([^)]{2,}\)/.test(out.q)) out.q += ' (' + String(out.hint).replace(/[()]/g, '') + ')';
  return out;
}


async function readingPracticeNew() {
  const settings = readingPracticeSettings();
  readingPracticeSaveSettings(settings);
  const button = document.querySelector('[data-action="reading-practice-new"]');
  const result = document.getElementById('gameReadingResult');
  // Keep the module visibly alive while article/question generation is in flight.
  // Without this, the toolbar renders over an empty area and looks like a broken page.
  if (result) result.innerHTML = '<span class="muted">正在准备文章与题组…</span>';
  if (button) { button.disabled = true; button.textContent = settings.source === 'ai' ? '生成中…' : '准备中…'; }
  let pack;
  try {
    if (settings.source === 'ai') pack = await readingPracticeGenerateAI(settings);
    else if (settings.source === 'rss' && typeof readingResolveCurrentArticle === 'function') pack = { ...(await readingResolveCurrentArticle()), questions: null };
    else if (settings.source === 'current' && typeof READING_PREPARED_ARTICLES !== 'undefined' && READING_PREPARED_ARTICLES[0]) {
      const prepared = READING_PREPARED_ARTICLES[0];
      pack = { title: prepared.title, paragraphs: prepared.paragraphs.slice(), sourceType: 'prepared', questions: readingPreparedQuestionBank(settings) };
    } else if (typeof readingPreparedArticle === 'function') pack = { ...readingPreparedArticle(), questions: null };
    else pack = {title:GAME_READING_ARTICLE.title,paragraphs:GAME_READING_ARTICLE.paragraphs,questions:null};
  } catch (e) {
    gameReadingCurrent = null;
    const result = document.getElementById('gameReadingResult');
    if (result) result.innerHTML = '<span style="color:var(--red)">生成失败：' + esc(e.message || '请稍后重试') + '</span>';
    if (button) { button.disabled = false; button.textContent = '生成题组'; }
    return;
  }
  const articleWordCount = pack && Array.isArray(pack.paragraphs) ? pack.paragraphs.join(' ').split(/\s+/).filter(Boolean).length : 0;
  if (articleWordCount < 600) {
    const result = document.getElementById('gameReadingResult');
    if (result) result.innerHTML = '<span style="color:var(--red)">文章长度不足高考阅读练习要求，请更换来源或重试。</span>';
    if (button) { button.disabled = false; button.textContent = '生成题组'; }
    return;
  }
  let generated = Array.isArray(pack.questions) ? pack.questions.map(readingNormalizeQuestion).filter(Boolean) : null;
  if (!generated) {
    try { generated = await readingPracticeGenerateQuestions(pack, settings); }
    catch (e) {
      const result = document.getElementById('gameReadingResult');
      if (result) result.innerHTML = '<span style="color:var(--red)">题组未能通过完整性校验：' + esc(e.message || '请重试') + '</span>';
      if (button) { button.disabled = false; button.textContent = '重新生成'; }
      return;
    }
  }
  gameReadingCurrent = { article: pack, questions: generated };
  const articleHeader = '<article class="reading-reference reading-main-article"><header><span class="reading-eyebrow">READING TEXT</span><h2>' + esc(pack.title) + '</h2></header>' + (pack.sourceNotice ? '<p class="reading-source-notice" role="status">时文来源暂不可用，已使用离线精选文章。</p>' : '');
  let pointNumber = 0;
  const exerciseItems = [];
  const sevenItems = [];
  gameReadingCurrent.questions.forEach((q, i) => {
    if (q.type === 'seven') {
      const parts = String(q.q || '').split(/\(([1-5])\)\s*(?:_{2,}|\[\s*\])?/g);
      for (let gap = 1; gap <= 5; gap++) {
        sevenItems.push({ q, i, gap, before: gap === 1 ? parts[0] || '' : '', text: parts[gap * 2] || '' });
      }
    } else if (['cloze', 'grammar'].includes(q.type)) exerciseItems.push({ q, i });
  });
  for (let i = exerciseItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [exerciseItems[i], exerciseItems[j]] = [exerciseItems[j], exerciseItems[i]];
  }
  if (sevenItems.length) {
    const mixed = [];
    let exerciseIndex = 0;
    let sevenIndex = 0;
    const total = exerciseItems.length + sevenItems.length;
    for (let position = 0; position < total; position++) {
      const nextSevenPosition = Math.floor((sevenIndex + 1) * total / (sevenItems.length + 1));
      if (sevenIndex < sevenItems.length && position >= nextSevenPosition) mixed.push(sevenItems[sevenIndex++]);
      else if (exerciseIndex < exerciseItems.length) mixed.push(exerciseItems[exerciseIndex++]);
    }
    exerciseItems.splice(0, exerciseItems.length, ...mixed);
  }
  const renderInlineExercise = item => {
    const { q, i } = item;
    const start = pointNumber + 1;
    if (q.type === 'cloze') {
      pointNumber++;
      const opts = q.options || q.o;
      const input = '<label class="reading-inline-control"><span class="reading-gap-number">(' + start + ')</span><select data-gr-cloze="' + i + '" aria-label="完形第' + start + '空"><option value="">选择词语</option>' + opts.map((option,j) => '<option value="' + j + '">' + String.fromCharCode(65+j) + '. ' + esc(option) + '</option>').join('') + '</select></label>';
      return '<p data-gr-q="' + i + '" class="reading-exercise-line reading-cloze-item">' + esc(q.q).replace(/_{2,}|\(\s*\)/, input) + '</p>';
    }
    if (q.type === 'grammar') {
      pointNumber++;
      const suppliedRoot = q.hint ? q.hint.replace(/^提示[:：]?\s*/, '') : '';
      const input = '<label class="reading-inline-control"><span class="reading-gap-number">(' + start + ')</span><input data-gr-answer="' + i + '" aria-label="语法填空第' + start + '题" autocomplete="off" placeholder="填写答案">';
      const original = String(q.q || '');
      const rootMatch = original.match(/\(([^()]+)\)/);
      const root = suppliedRoot || (rootMatch && rootMatch[1]);
      const sentence = rootMatch
        ? esc(original).replace(rootMatch[0], input + '<span class="reading-root-word">(' + esc(root) + ')</span></label>')
        : /_{2,}|\(\s*\)/.test(original)
          ? esc(original).replace(/_{2,}|\(\s*\)/, input + (root ? '<span class="reading-root-word">(' + esc(root) + ')</span>' : '') + '</label>')
          : esc(original) + ' ' + input + (root ? '<span class="reading-root-word">(' + esc(root) + ')</span>' : '') + '</label>';
      return '<p data-gr-q="' + i + '" class="reading-exercise-line reading-grammar-item">' + sentence + '</p>';
    }
    const opts = q.options || q.o;
    const number = ++pointNumber;
    const gap = item.gap;
    const input = '<label class="reading-inline-control reading-seven-control"><span class="reading-gap-number">(' + number + ')</span><select data-gr-gap="' + gap + '" aria-label="七选五第' + number + '空"><option value="">选择句子</option>' + opts.map((_,j) => '<option value="' + j + '">' + String.fromCharCode(65+j) + '</option>').join('') + '</select></label>';
    const lead = gap === 1 ? '<span class="reading-task-tag">七选五</span> ' : '';
    const before = esc(item.before || '').replace(/\s+/g, ' ').trim();
    const part = esc(item.text).replace(/\s+/g, ' ').trim();
    return '<p data-gr-q="' + i + '" class="reading-exercise-line reading-seven-passage">' + lead + (before ? before + ' ' : '') + input + (part ? ' ' + part : '') + '</p>';
  };
  const readingQuestions = gameReadingCurrent.questions.map((q, i) => {
    if (q.type !== 'reading') return '';
    const opts=q.options||q.o; const number=++pointNumber;
    return '<article data-gr-q="' + i + '" class="reading-question-card"><h4>' + number + '. ' + esc(q.q) + '</h4><div class="reading-choice-list">' + opts.map((x,j) => '<label><input type="radio" name="gr' + i + '" value="' + j + '"><span class="reading-choice-letter">' + String.fromCharCode(65+j) + '</span><span>' + esc(x) + '</span></label>').join('') + '</div></article>';
  }).join('');
  const sourceParagraphs = pack.paragraphs.map(p => String(p || '').trim()).filter(Boolean);
  const articleBody = [];
  const slots = Array.from({ length: sourceParagraphs.length }, () => []);
  exerciseItems.forEach((item, index) => {
    const slot = Math.min(sourceParagraphs.length - 1, Math.floor((index + 0.5) * sourceParagraphs.length / exerciseItems.length));
    slots[slot].push(renderInlineExercise(item));
  });
  sourceParagraphs.forEach((paragraph, index) => articleBody.push('<p>' + esc(paragraph) + '</p>', ...slots[index]));
  const sevenOptions = gameReadingCurrent.questions.map((q, i) => {
    if (q.type !== 'seven') return '';
    const opts = q.options || q.o;
    const choices = opts.map(option => '<li>' + esc(option) + '</li>').join('');
    return '<section data-gr-q="' + i + '" class="reading-seven-options-wrap"><h3>七选五备选句</h3><ol class="reading-seven-options" type="A">' + choices + '</ol></section>';
  }).join('');
  const articleHtml = articleHeader + '<div class="reading-source-copy">' + articleBody.join('') + sevenOptions + '</div></article>';
  const questionsRoot = document.getElementById('gameReadingQuestions');
  document.getElementById('gameReadingArticle').innerHTML = articleHtml;
  questionsRoot.innerHTML = readingQuestions ? '<div class="reading-after-text"><section class="reading-comprehension"><header><span class="reading-type-mark">阅读理解</span><h3>读后回答</h3><p class="reading-inline-instructions">阅读文章后选择最合适的答案。</p></header>' + readingQuestions + '</section><button type="button" class="send-btn" data-reading-submit>提交答案</button></div>' : '<button type="button" class="send-btn" data-reading-submit>提交答案</button>';
  questionsRoot.querySelector('[data-reading-submit]').addEventListener('click', readingPracticeSubmit);
  if (result) result.textContent = '';
  if (typeof readingTranslateHardWords === 'function') readingTranslateHardWords();
  if (button) { button.disabled = false; button.textContent = '重新生成'; }
}
async function readingPracticeSubmit(){
  if(!gameReadingCurrent)return;
  let s=0;
  let total=0;
  const wrong=[];
  gameReadingCurrent.questions.forEach((q,i)=>{
    const opts=q.options||q.o; const expected=q.answer!==undefined?q.answer:q.a;
    const selected = q.type === 'seven' ? [...document.querySelectorAll('[data-gr-q="'+i+'"] [data-gr-gap]')].map(input => input.value === '' ? -1 : Number(input.value)) : q.type === 'cloze' ? [document.querySelector('[data-gr-cloze="'+i+'"]')?.value].filter(value => value !== undefined && value !== '') .map(Number) : opts ? [...document.querySelectorAll('input[name="gr'+i+'"]:checked')].map(input => Number(input.value)) : [];
    const v=selected[0] ?? -1;
    const t=document.querySelector('[data-gr-answer="'+i+'"]')?.value.trim().toLowerCase();
    total += q.type === 'seven' ? 5 : 1;
    const sevenScores = q.type === 'seven' && Array.isArray(expected) ? expected.map((answer, gap) => selected[gap] === answer) : [];
    const earned = sevenScores.filter(Boolean).length;
    const ok=opts?(q.type === 'seven' ? sevenScores.length === 5 && sevenScores.every(Boolean) : (typeof expected==='number'?v===expected:String(opts[v]||'').toLowerCase()===String(expected).toLowerCase())):t===String(expected||'').toLowerCase();
    if (q.type === 'seven') {
      s += earned;
      if (earned < 5) wrong.push({type:q.type, question:q.q, answer:expected, explanation:q.explanation||q.e||''});
    } else if(ok) s++; else wrong.push({type:q.type, question:q.q, answer:expected, explanation:q.explanation||q.e||''});
    const e=document.querySelector('[data-gr-q="'+i+'"]');
    if(e&&!e.querySelector('.gr-feedback')) {
      const feedback = q.type === 'seven' ? '✅ 七选五：' + earned + '/5 空正确。' + (earned < 5 ? esc(q.explanation||q.e||'请核对句间逻辑与衔接。') + ' 参考答案：' + expected.map(index => String.fromCharCode(65 + index)).join(', ') : '') : ok ? '✅ 正确' : '❌ ' + esc(q.explanation||q.e||('参考答案：'+expected));
      e.innerHTML+='<span class="gr-feedback" style="color:'+(ok?'var(--green)':'var(--red)')+'">'+feedback+(ok||q.type === 'seven'?'':' <button class="dict-btn" data-action="reading-add-word" data-arg1="'+esc(String(expected))+'">加入生词本</button>')+'</span>';
    }
  });
  document.getElementById('gameReadingResult').textContent='得分：'+s+'/'+total;
  if (wrong.length && typeof addWeakPoint === 'function') wrong.forEach(w => addWeakPoint('阅读练习', w.type+'：'+w.question, w.explanation||'复习该题型并核对答案'));
}
function readingPracticeAddWord(word){ if(typeof quickAddVocab==='function') quickAddVocab(String(word||''),'阅读练习错题'); }
function readingPracticeExport(){window.print();}

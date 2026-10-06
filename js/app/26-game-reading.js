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
function readingPracticeSettings() {
  const types = [...(document.getElementById('grTypes')?.selectedOptions || [])].map(x => x.value);
  return { source: document.getElementById('grSource')?.value || getSetting('readingPracticeSource', 'current'), types: types.length ? types : ['cloze','grammar','seven','reading'], count: Math.max(1, Math.min(10, Number(document.getElementById('grReadingCount')?.value || getSetting('readingPracticeCount', 5)))) };
}
function readingPracticeSaveSettings(s) { setSetting('readingPracticeSource', s.source); setSetting('readingPracticeTypes', s.types); setSetting('readingPracticeCount', s.count); }
function readingPracticeParseJSON(raw) { try { const text=String(raw||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim(); return JSON.parse(text); } catch(e) { return null; } }
function readingPracticeCallAPI(messages, options) {
  const opts = {...(options || {})};
  if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(30000);
  return callAPI(messages, opts);
}
async function readingPracticeGenerateAI(settings) {
  const articleRaw = await readingPracticeCallAPI([{role:'system',content:'You write difficult Shanghai Gaokao English reading material. Return JSON only: {"title":"...","paragraphs":["..."]}. Write 8-10 substantial paragraphs, at least 900 English words, coherent and factually cautious.'},{role:'user',content:'Generate a current-affairs style article for an advanced high-school learner. Avoid invented statistics and explain essential C1 words briefly in context.'}], {maxTokens:5000});
  const article = readingPracticeParseJSON(articleRaw);
  if (!article || !Array.isArray(article.paragraphs) || article.paragraphs.join(' ').split(/\s+/).length < 500) throw new Error('AI 文章长度或格式不合格，请重试');
  const questionRaw = await readingPracticeCallAPI([{role:'system',content:'Create Shanghai Gaokao reading questions from the supplied article. Return JSON only: {"questions":[{"type":"reading|cloze|grammar|seven","q":"...","options":["..."],"answer":"...","explanation":"...","hint":"..."}]}. Every answer must be directly supported by the article; grammar answers include the root in parentheses.'},{role:'user',content:'Article:\n'+article.paragraphs.join('\n\n')+'\n\nRequired types: '+settings.types.join(',')+'; reading questions: '+settings.count}],{maxTokens:5000});
  const pack = readingPracticeParseJSON(questionRaw);
  if (!pack || !Array.isArray(pack.questions) || !pack.questions.length) throw new Error('AI 题目格式不合格，请重试');
  const verifyRaw = await readingPracticeCallAPI([{role:'system',content:'Validate these questions against the article. Return JSON only: {"ok":true|false,"questions":[...corrected questions...]}. Remove any question whose answer is not supported.'},{role:'user',content:'Article:\n'+article.paragraphs.join('\n\n')+'\nQuestions:\n'+JSON.stringify(pack.questions)}],{maxTokens:5000});
  const verified = readingPracticeParseJSON(verifyRaw);
  if (!verified || verified.ok === false || !Array.isArray(verified.questions) || !verified.questions.length) throw new Error('AI 校验未通过，请重试');
  return {title:article.title||'AI 阅读文章',paragraphs:article.paragraphs,questions:verified.questions.slice(0, Math.max(settings.count, settings.types.length*2))};
}
async function readingPracticeGenerateQuestions(article, settings) {
  const text = article.paragraphs.join('\n\n');
  const requested = settings.types.length ? settings.types : ['cloze', 'grammar', 'seven', 'reading'];
  const target = Math.max(1, Math.min(10, Number(settings.count) || 5));
  const raw = await readingPracticeCallAPI([
    { role: 'system', content: 'You create rigorous Shanghai Gaokao English questions. Return JSON only: {"questions":[{"type":"cloze|grammar|seven|reading","q":"...","options":["..."],"answer":"...","explanation":"...","hint":"..."}]}. Use exactly the requested question count. Cover the requested types as evenly as possible. Every answer must be supported by the article. For grammar fill, the prompt must include the supplied root word in parentheses, e.g. "... (complete)"; answer is the inflected form. Cloze/reading/seven are 4-option multiple choice; grammar is a text answer.' },
    { role: 'user', content: 'Article:\n' + text + '\n\nRequested types: ' + requested.join(', ') + '\nTotal questions: ' + target }
  ], { maxTokens: 6000 });
  const parsed = readingPracticeParseJSON(raw);
  if (!parsed || !Array.isArray(parsed.questions)) throw new Error('题目生成格式不合格，请重试');
  const questions = parsed.questions.map(readingNormalizeQuestion).filter(Boolean);
  if (questions.length < target) throw new Error('题目数量不足，请重试');
  const counts = Object.fromEntries(requested.map(t => [t, 0]));
  questions.forEach(q => { if (counts[q.type] !== undefined) counts[q.type]++; });
  if (requested.some(t => counts[t] < 1)) throw new Error('未覆盖所选题型，请重试');
  const verifyRaw = await readingPracticeCallAPI([
    { role: 'system', content: 'Validate questions against the article. Return JSON only: {"ok":true|false,"questions":[...]}. Keep exactly the requested count, remove unsupported questions, and correct answer/options when necessary. Preserve grammar root hints in parentheses.' },
    { role: 'user', content: 'Article:\n' + text + '\nQuestions:\n' + JSON.stringify(questions.slice(0, target)) }
  ], { maxTokens: 6000 });
  const verified = readingPracticeParseJSON(verifyRaw);
  const finalQuestions = verified && Array.isArray(verified.questions) ? verified.questions.map(readingNormalizeQuestion).filter(Boolean) : [];
  if (!verified || verified.ok === false || finalQuestions.length < target) throw new Error('AI 题目校验未通过，请重试');
  return finalQuestions.slice(0, target);
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

function readingPracticeFallbackQuestions(article, settings) {
  const requested = settings.types.length ? settings.types : ['cloze', 'grammar', 'seven', 'reading'];
  const target = Math.max(1, Math.min(10, Number(settings.count) || 5));
  const title = article && article.title ? article.title : 'the article';
  const templates = {
    cloze: [
      {type:'cloze', q:'The article suggests that adaptation depends on whether residents can ___ new measures.', options:['reach and understand','ignore','replace','predict'], answer:0, explanation:'The second paragraph says residents must reach, understand, and help improve the measures.'},
      {type:'cloze', q:'A pilot project is useful when its failures are treated as ___.', options:['evidence','secrets','rewards','delays'], answer:0, explanation:'The fourth paragraph describes failures as evidence.'}
    ],
    grammar: [
      {type:'grammar', q:'Communities need ways to ___ progress and correct mistakes. (measure)', answer:'measure', hint:'measure', explanation:'After “ways to”, use the infinitive measure.'},
      {type:'grammar', q:'Trust has already been ___ before a crisis begins. (build)', answer:'built', hint:'build', explanation:'The passive form is “has been built”.'},
      {type:'grammar', q:'Public projects should be ___ regularly for fairness. (check)', answer:'checked', hint:'check', explanation:'After “should be”, use the past participle checked.'}
    ],
    seven: [
      {type:'seven', q:'Which sentence best completes the idea that adaptation is a shared process?', options:['Residents and institutions must learn from evidence together.','Only engineers can decide what a city needs.','A city should stop changing after construction.','Technology makes public discussion unnecessary.'], answer:0, explanation:'The article repeatedly connects local knowledge with institutional planning.'},
      {type:'seven', q:'Which sentence could follow the paragraph about digital warning systems?', options:['Therefore, several communication channels are needed.','Therefore, all residents should use one app.','Therefore, warning systems should be removed.','Therefore, infrastructure no longer matters.'], answer:0, explanation:'The next paragraph calls for several communication channels.'}
    ],
    reading: [
      {type:'reading', q:'What is the main idea of "' + title + '"?', options:['Cities become more resilient by learning, including residents, and correcting decisions.','Cities can eliminate every future disruption with sensors.','Large construction projects are always better than experiments.','Residents should leave difficult decisions to officials.'], answer:0, explanation:'The final paragraph emphasizes learning, fairness, and shared responsibility.'},
      {type:'reading', q:'Why does the author mention a parent avoiding a crossing?', options:['To show that statistics alone cannot explain lived experience.','To prove that crossings are never useful.','To argue that maps should be banned.','To show that parents oppose public projects.'], answer:0, explanation:'The example contrasts sensor data with residents’ reasons and experiences.'}
    ]
  };
  const output = [];
  let round = 0;
  while (output.length < target) {
    const type = requested[round % requested.length] || 'reading';
    const pool = templates[type] || templates.reading;
    const item = pool[Math.floor(round / requested.length) % pool.length];
    output.push({...item});
    round++;
  }
  return output;
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
    else if (typeof readingPreparedArticle === 'function') pack = { ...readingPreparedArticle(), questions: null };
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
      generated = readingPracticeFallbackQuestions(pack, settings);
      const result = document.getElementById('gameReadingResult');
      if (result) result.innerHTML = '<span class="muted">AI 出题暂不可用，已使用本地校验题组。</span>';
    }
  }
  gameReadingCurrent = { article: pack, questions: generated.slice(0, settings.count) };
  document.getElementById('gameReadingArticle').innerHTML = '<h2>' + esc(pack.title) + '</h2>' + pack.paragraphs.map(p => '<p>' + esc(p) + '</p>').join('');
  document.getElementById('gameReadingQuestions').innerHTML = gameReadingCurrent.questions.map((q, i) => { const opts=q.options||q.o; const answer=q.answer||q.a; return '<div data-gr-q="' + i + '" class="pf-section"><b>' + (i + 1) + '. ' + esc(q.q) + '</b>' + (q.hint ? '<div class="muted">提示：'+esc(q.hint)+'</div>' : '') + (opts ? '<div>' + opts.map((x, j) => '<label style="display:block;margin:6px"><input type="radio" name="gr' + i + '" value="' + j + '"> ' + esc(x) + '</label>').join('') + '</div>' : '<input data-gr-answer="' + i + '" placeholder="填写答案" style="margin-top:8px;padding:7px">') + '</div>'; }).join('') + '<button class="send-btn" data-action="reading-practice-submit">提交答案</button>';
  if (typeof readingTranslateHardWords === 'function') readingTranslateHardWords();
  if (button) { button.disabled = false; button.textContent = '重新生成'; }
}
async function readingPracticeSubmit(){
  if(!gameReadingCurrent)return;
  let s=0;
  const wrong=[];
  gameReadingCurrent.questions.forEach((q,i)=>{
    const opts=q.options||q.o; const expected=q.answer!==undefined?q.answer:q.a;
    const v=opts?Number(document.querySelector('input[name="gr'+i+'"]:checked')?.value):-1;
    const t=document.querySelector('[data-gr-answer="'+i+'"]')?.value.trim().toLowerCase();
    const ok=opts?(typeof expected==='number'?v===expected:String(opts[v]||'').toLowerCase()===String(expected).toLowerCase()):t===String(expected||'').toLowerCase();
    if(ok)s++; else wrong.push({type:q.type, question:q.q, answer:expected, explanation:q.explanation||q.e||''});
    const e=document.querySelector('[data-gr-q="'+i+'"]');
    if(e&&!e.querySelector('.gr-feedback')) e.innerHTML+='<div class="gr-feedback" style="color:'+(ok?'var(--green)':'var(--red)')+'">'+(ok?'✅ 正确':'❌ '+esc(q.explanation||q.e||('参考答案：'+expected)))+(ok?'':' <button class="dict-btn" data-action="reading-add-word" data-arg1="'+esc(String(expected))+'">加入生词本</button>')+'</div>';
  });
  document.getElementById('gameReadingResult').textContent='得分：'+s+'/'+gameReadingCurrent.questions.length;
  if (wrong.length && typeof addWeakPoint === 'function') wrong.forEach(w => addWeakPoint('阅读练习', w.type+'：'+w.question, w.explanation||'复习该题型并核对答案'));
}
function readingPracticeAddWord(word){ if(typeof quickAddVocab==='function') quickAddVocab(String(word||''),'阅读练习错题'); }
function readingPracticeExport(){window.print();}

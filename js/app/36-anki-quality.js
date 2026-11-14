/* ============================================================
   Anki 题目质量与去重，由 js/app.js 拆分而来
============================================================ */
function quizQuestionStemText(value) {
  return String(value || '')
    .replace(/<div\b[^>]*class=["'][^"']*\bquiz-options\b[^"']*["'][\s\S]*$/i, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:quot|#34);/gi, ' ')
    .replace(/&(?:amp);/gi, ' and ')
    .replace(/&(?:nbsp);/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quizQuestionTokens(value) {
  const generic = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'best', 'by', 'does', 'for', 'from', 'how', 'in',
    'is', 'it', 'of', 'on', 'or', 'passage', 'sentence', 'that', 'the', 'this', 'to', 'what',
    'which', 'who', 'why', 'with', 'idea', 'main', 'according', 'discussed', 'expresses',
    'completes', 'complete', 'suggest', 'suggests', 'about', 'benefit'
  ]);
  return new Set(quizQuestionStemText(value).split(' ')
    .filter(token => token.length > 2 && !generic.has(token))
    .map(token => token.replace(/ies$/, 'y').replace(/s$/, ''))
    .filter(token => token.length > 2 && !generic.has(token)));
}

function quizQuestionWeakPointIds(value) {
  const ids = value && (value.weakPointIds || value.weak_point_ids);
  return new Set(Array.isArray(ids) ? ids.map(id => String(id).trim()).filter(Boolean) : []);
}

function quizQuestionReadingFocus(value) {
  const stem = quizQuestionStemText(value && value.question);
  if (/\bwhat does the title\b|\btitle .*\b(?:suggest|indicate|reflect|reveal|mean)\b/.test(stem)) return 'title-inference';
  if (/\b(?:main|central|key) idea\b|\bmain point\b|\bprimarily about\b|\bmainly about\b|\bbest summarizes?\b|\bmost appropriate title\b/.test(stem)) return 'gist';
  return '';
}

function quizQuestionNeedsMissingSource(value) {
  const question = String(value && value.question || '').replace(/<[^>]*>/g, ' ');
  const referencesExternalText = /\baccording to (?:the )?(?:passage|article|text)\b|\b(?:in|from|throughout) the (?:passage|article|text)\b|\b(?:the|this) (?:passage|article|text) (?:says|states|suggests|indicates|describes|argues|discusses|shows|explains)\b/i.test(question);
  const wordCount = (question.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
  return referencesExternalText && wordCount < 70;
}

function quizQuestionsAreNearDuplicates(a, b) {
  const left = quizQuestionTokens(a && a.question);
  const right = quizQuestionTokens(b && b.question);
  if (!left.size || !right.size) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const union = left.size + right.size - shared;
  const jaccard = union ? shared / union : 0;
  const containment = shared / Math.min(left.size, right.size);
  if (jaccard >= 0.8 && containment >= 0.8) return true;

  // Main-idea and title-inference cards for the same reading text usually
  // rehearse the same gist; lexical similarity alone misses that pair.
  if (quizQuestionReadingFocus(a) === 'gist' && quizQuestionReadingFocus(b) === 'gist' && shared >= 2 && containment >= 0.6) return true;

  // A recurring weak point may be generated as different quiz types. Catch
  // those when their stems still share the same substantive language.
  const leftIds = quizQuestionWeakPointIds(a);
  const rightIds = quizQuestionWeakPointIds(b);
  const sameWeakPoint = [...leftIds].some(id => rightIds.has(id));
  return sameWeakPoint && shared >= 4 && containment >= 0.42;
}

function isQuizQuestionUsable(q) {
  if (!q || typeof q !== 'object') return false;
  const type = String(q.type || '').trim().toLowerCase();
  const question = String(q.question || '').trim();
  const answer = String(q.answer || '').trim();
  const explanation = String(q.explanation || '').trim();
  if (!question || !answer || !explanation || !['multiple_choice', 'fill_blank', 'error_correction'].includes(type)) return false;
  if (/[\u3400-\u9fff]/.test(question)) return false;
  if (quizQuestionNeedsMissingSource(q)) return false;
  if (type === 'multiple_choice') {
    if (!Array.isArray(q.options) || q.options.length !== 4 || !/^[A-D]$/i.test(answer)) return false;
    const options = q.options.map(option => String(option || '').replace(/^\s*[A-D][.、)]\s*/i, '').trim());
    if (options.some(option => !option || /[\u3400-\u9fff]/.test(option)) || /[\u3400-\u9fff]/.test(question)) return false;
    if (new Set(options.map(option => option.toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' '))).size !== 4) return false;
    const answerIndex = answer.toUpperCase().charCodeAt(0) - 65;
    const correct = options[answerIndex];
    const optionLengths = options.map(option => option.replace(/\s+/g, '').length).sort((a, b) => a - b);
    const typicalLength = optionLengths[2];
    if (correct.replace(/\s+/g, '').length >= 36 && correct.replace(/\s+/g, '').length >= typicalLength * 1.8) return false;
    const shortcutWords = /\b(?:always|never|only|solely|all|every|none|refuse|entirely|exclusively)\b/i;
    const extremeDistractors = options.filter((option, index) => index !== answerIndex && shortcutWords.test(option)).length;
    if (extremeDistractors >= 2 && !shortcutWords.test(correct)) return false;
    return true;
  }
  if (type === 'fill_blank') {
    const blanks = question.match(/_{2,}/g) || [];
    if (!blanks.length || /[\u3400-\u9fff]/.test(question)) return false;
    const answers = answer.split(/\s*[,;]\s*/).map(value => value.trim()).filter(Boolean);
    if (answers.length !== blanks.length) return false;
    if (!Array.isArray(q.blank_hints) || q.blank_hints.length !== blanks.length) return false;
    let hintIndex = 0;
    const missingHint = question.replace(/_{2,}/g, (blank, offset, whole) => {
      const afterBlank = whole.slice(offset + blank.length);
      const shown = afterBlank.match(/^\s*\(([^()\n]{1,80})\)/);
      const index = hintIndex++;
      const hint = String(q.blank_hints[index] || '').trim();
      const expected = String(answers[index] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedHint = hint.toLowerCase().replace(/\s+/g, ' ');
      return !hint || normalizedHint === expected || !shown || shown[1].trim().toLowerCase() !== hint.toLowerCase()
        ? '__MISSING_HINT__'
        : blank;
    });
    return !missingHint.includes('__MISSING_HINT__');
  }
  const contradiction = /(原句|原文|本题)[^。！？\n]{0,40}(正确|无语法错误|没有语法错误|保留原句)|(original sentence|original|sentence)[^.!?\n]{0,40}(correct|no grammar error|grammatically correct|should be retained)/i.test(explanation);
  return !contradiction && answer !== question && /^\s*(?:correct|fix|rewrite)\s+(?:the\s+)?(?:error|sentence|incorrect)/i.test(question);
}

async function getExistingQuizQuestions() {
  try {
    if (typeof isNativeSchedulerMode === 'function' && isNativeSchedulerMode() && typeof nativeSchedulerAllCards === 'function') {
      const response = await nativeSchedulerAllCards({ limit: 2000 });
      const weakPointTagPrefix = 'wp_' + (typeof currentUser === 'function' ? (currentUser() || 'default') : 'default') + '_';
      return (Array.isArray(response && response.data) ? response.data : [])
        .filter(card => !card.deck_name || card.deck_name === ankiWeakDeck())
        .map(card => ({
          question: card.fields && card.fields.Question || '',
          weakPointIds: (Array.isArray(card.tags) ? card.tags : [])
            .filter(tag => String(tag).startsWith(weakPointTagPrefix))
            .map(tag => String(tag).slice(weakPointTagPrefix.length))
        }))
        .filter(card => card.question);
    }
    const found = await ankiPostCall({ action: 'findNotes', version: 6, params: { query: 'deck:' + ankiWeakDeck() + ' tag:weak-point' } });
    const ids = found && found.result && found.result.result;
    if (!Array.isArray(ids) || !ids.length) return [];
    const info = await ankiPostCall({ action: 'notesInfo', version: 6, params: { notes: ids.slice(0, 2000) } });
    const weakPointTagPrefix = 'wp_' + (typeof currentUser === 'function' ? (currentUser() || 'default') : 'default') + '_';
    return (info && info.result && info.result.result || []).map(note => ({
      question: note.fields && note.fields.Question && note.fields.Question.value || '',
      weakPointIds: (Array.isArray(note.tags) ? note.tags : [])
        .filter(tag => String(tag).startsWith(weakPointTagPrefix))
        .map(tag => String(tag).slice(weakPointTagPrefix.length))
    })).filter(card => card.question);
  } catch (error) {
    dbg('QUIZ_DEDUP', error.message);
    return [];
  }
}

import { npcById, type PublicStage, type StageId } from '../content/world';
import type { ChapterQuiz, ChapterSettlement, Journey, QuizAnswer } from '../services/journey';
import { nextQuestion } from '../services/journey';
import './chapter.css';

type Actions = {
  start(): void;
  answer(index: number, choice: number): void;
  settle(): void;
  switchStage(stageId: StageId): void;
  refresh(): void;
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function button(text: string, action: () => void, primary = false) {
  const item = element('button', text, primary ? 'wg-chapter-primary' : '');
  item.type = 'button'; item.addEventListener('click', action); return item;
}

/** The journal is an explicit pause/read surface. It never injects evidence into a resident. */
export function createChapterPanel(root: HTMLElement, actions: Actions) {
  const toggle = button('Chapter', () => { render(); dialog.showModal(); });
  toggle.id = 'wg-chapter-toggle'; toggle.setAttribute('aria-label', 'Open chapter investigation');
  root.querySelector('.wg-controls')!.append(toggle);
  const dialog = element('dialog', undefined, 'wg-chapter'); dialog.id = 'wg-chapter-panel';
  dialog.setAttribute('aria-labelledby', 'wg-chapter-title');
  const header = element('header');
  const title = element('h2', 'Investigation'); title.id = 'wg-chapter-title';
  header.append(title, button('Close', () => dialog.close()));
  const status = element('p', '', 'wg-chapter-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const content = element('div', undefined, 'wg-chapter-body');
  dialog.append(header, status, content); root.querySelector('.wg-shell')!.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  let journey: Journey | undefined;
  let quiz: ChapterQuiz | undefined;
  let settlement: ChapterSettlement | undefined;
  let busy = false;
  let error = '';
  let operation = '';

  function report(answer: QuizAnswer, index: number) {
    const result = element('details', undefined, 'wg-chapter-answer');
    const summary = element('summary', `Question ${index + 1} · ${answer.correct ? 'Supported by the evidence' : 'Review this conclusion'}`);
    result.append(summary, element('p', answer.explanation)); return result;
  }
  function stageOfJourney(): PublicStage | undefined { const current = journey; return current?.stages.find(stage => stage.id === current.stageId); }
  function renderOverview() {
    if (!journey) {
      content.append(element('p', 'Sign in through the English app to load your investigation, evidence and chapter progress.'));
      content.append(button('Load saved journey', actions.refresh, true)); return;
    }
    const stage = stageOfJourney();
    if (!stage) return;
    const label = element('small', stage.title, 'wg-chapter-kicker');
    content.append(label, element('h3', stage.name), element('p', stage.objective));
    const facts = element('ul', undefined, 'wg-chapter-facts');
    for (const fact of stage.publicFacts) facts.append(element('li', fact));
    content.append(facts, element('h4', 'People to hear from'));
    const residents = element('ul', undefined, 'wg-chapter-residents');
    for (const id of stage.npcs) {
      const npc = npcById(id); const visited = journey.visitedNpcIds.includes(id);
      const place = id === 'eli' ? 'the keeper’s pier' : id === 'mara' ? 'the harbor workshop' : 'the eastern mooring';
      residents.append(element('li', `${visited ? '✓' : '○'} ${npc?.name || id} · ${visited ? 'Account recorded' : `Find them at ${place}`}`));
    }
    content.append(residents);
    const notes = journey.evidence.filter(item => item.stageId === journey!.stageId);
    content.append(element('h4', 'Your field notes'));
    if (!notes.length) content.append(element('p', 'Completed conversations add sourced notes here. Ask residents about what they observed.', 'wg-chapter-muted'));
    else {
      const clues = element('ol', undefined, 'wg-chapter-evidence');
      for (const note of notes) {
        const item = element('li'); item.append(element('p', note.text), element('small', `Source: ${note.source}`)); clues.append(item);
      }
      content.append(clues);
    }
    const complete = journey.completedStageIds.includes(stage.id);
    const ready = stage.npcs.every(id => journey!.visitedNpcIds.includes(id));
    const controls = element('div', undefined, 'wg-chapter-actions');
    controls.append(button('Return to the harbor', () => dialog.close()));
    if (!complete) {
      const start = button(journey.quiz ? 'Resume your conclusion' : 'Make your case', actions.start, true);
      start.disabled = !ready || busy; controls.append(start);
      if (!ready) content.append(element('p', 'Hear each resident’s account before making your case. You can return and ask follow-up questions at any time.', 'wg-chapter-muted'));
    }
    content.append(controls);
    const unlocked = journey.stages.filter(item => journey!.unlockedStageIds.includes(item.id));
    if (unlocked.length > 1) {
      content.append(element('h4', 'Chapters'));
      const chapters = element('div', undefined, 'wg-chapter-stages');
      for (const item of unlocked) {
        const entry = button(`${journey.completedStageIds.includes(item.id) ? '✓ ' : ''}${item.name}`, () => actions.switchStage(item.id), !journey.completedStageIds.includes(item.id));
        entry.disabled = item.id === journey.stageId || busy;
        if (item.id === journey.stageId) entry.setAttribute('aria-current', 'step');
        chapters.append(entry);
      }
      content.append(chapters);
    }
    const log = journey.settlements || journey.chapterLog || [];
    if (log.length) {
      content.append(element('h4', 'Chapter log'));
      for (const entry of log) {
        const detail = element('details', undefined, 'wg-chapter-log');
        const name = journey.stages.find(stage => stage.id === entry.stageId)?.name || entry.stageId;
        detail.append(element('summary', `${name} · ${entry.score}/${entry.total}`), element('p', entry.summary)); content.append(detail);
      }
    }
  }
  function renderQuiz() {
    if (!quiz) return;
    const stage = journey?.stages.find(item => item.id === quiz!.stageId);
    content.append(element('small', stage?.title || 'YOUR CONCLUSION', 'wg-chapter-kicker'), element('h3', 'Make your case'));
    const source = quiz.source === 'ai_assembled' ? 'AI assembled from reviewed questions' : quiz.source === 'authored_fallback' ? 'Reviewed questions - authored fallback' : undefined;
    if (source) content.append(element('p', source, 'wg-chapter-muted'));
    content.append(element('p', 'Choose the conclusion best supported by what you learned. Your English feedback stays in the English drawer.'));
    const current = nextQuestion(quiz);
    quiz.questions.forEach((question, index) => {
      const answer = quiz!.answers[index];
      if (answer) { content.append(report(answer, index)); return; }
      if (index !== current) return;
      const form = element('form', undefined, 'wg-chapter-question');
      const fieldset = element('fieldset');
      const legend = element('legend', `${index + 1} / ${quiz!.questions.length} · ${question.q}`);
      fieldset.append(legend);
      const submit = element('button', 'Submit conclusion', 'wg-chapter-primary'); submit.type = 'submit'; submit.disabled = true;
      question.options.forEach((option, choice) => {
        const label = element('label', undefined, 'wg-chapter-option');
        const input = element('input'); input.type = 'radio'; input.name = 'chapter-choice'; input.value = String(choice); input.required = true;
        input.addEventListener('change', () => { submit.disabled = busy; });
        label.append(input, element('span', option)); fieldset.append(label);
      });
      form.append(fieldset, submit);
      form.addEventListener('submit', event => {
        event.preventDefault(); const selected = form.querySelector<HTMLInputElement>('input:checked');
        if (selected && !busy) actions.answer(index, Number(selected.value));
      });
      content.append(form);
    });
    if (current === -1) content.append(button('Submit your investigation', actions.settle, true));
    content.append(button('Back to field notes', () => { quiz = undefined; render(); }));
  }
  function renderSettlement() {
    if (!settlement) return;
    content.append(element('small', settlement.complete ? 'CHAPTER COMPLETED' : 'KEEP INVESTIGATING', 'wg-chapter-kicker'));
    content.append(element('h3', settlement.complete ? 'A clearer picture' : 'There is more to uncover'));
    content.append(element('p', settlement.summary));
    content.append(element('p', `${settlement.score} of ${settlement.total} conclusions supported by the evidence.`, 'wg-chapter-muted'));
    content.append(element('p', settlement.complete
      ? 'Your chapter English report is being prepared in the English drawer. You can keep exploring while it arrives.'
      : 'Your conversation feedback remains in the English drawer. Complete this investigation to receive a chapter report.', 'wg-chapter-muted'));
    const controls = element('div', undefined, 'wg-chapter-actions');
    if (settlement.complete && settlement.nextStageId) controls.append(button('Continue to the next chapter', () => actions.switchStage(settlement!.nextStageId!), true));
    else if (settlement.complete) controls.append(element('p', 'You have completed all available chapters. The harbor remains open for conversation.'));
    else controls.append(button('Review the accounts', () => { settlement = undefined; quiz = undefined; render(); }, true));
    controls.append(button('Return to the harbor', () => dialog.close()));
    content.append(controls);
  }
  function render() {
    status.hidden = !busy && !error;
    status.textContent = error || operation;
    status.classList.toggle('wg-chapter-error', Boolean(error));
    content.replaceChildren();
    if (settlement) renderSettlement(); else if (quiz) renderQuiz(); else renderOverview();
    if (error) content.append(button('Reload saved progress', actions.refresh));
    for (const item of content.querySelectorAll<HTMLButtonElement>('button')) if (busy) item.disabled = true;
    for (const input of content.querySelectorAll<HTMLInputElement>('input')) input.disabled = busy;
    content.setAttribute('aria-busy', String(busy));
  }
  return {
    open() { render(); if (!dialog.open) dialog.showModal(); },
    isOpen: () => dialog.open,
    update(next: Journey) {
      if (journey && journey.stageId !== next.stageId) { quiz = undefined; settlement = undefined; }
      journey = next;
      if (quiz) quiz = next.quiz;
      toggle.textContent = next.completedStageIds.length === next.stages.length ? 'Chapters ✓' : 'Chapter';
      if (dialog.open) render();
    },
    showQuiz(next: ChapterQuiz) { quiz = next; settlement = undefined; busy = false; error = ''; render(); },
    clearQuiz() { quiz = undefined; if (journey) journey = { ...journey, quiz: undefined }; settlement = undefined; busy = false; error = ''; render(); },
    showSettlement(next: ChapterSettlement) { settlement = next; quiz = undefined; busy = false; error = ''; render(); },
    busy(text: string) { busy = true; error = ''; operation = text; render(); },
    idle() { busy = false; operation = ''; render(); },
    error(text: string) { busy = false; error = text; render(); }
  };
}

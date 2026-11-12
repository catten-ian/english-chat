import './styles.css';
import { WORLD, type StageId } from './content/world';
import { createState, movePlayer, nearestNpc, saveState } from './simulation/state';
import { createRenderer } from './render/renderer';
import { createHud } from './ui/hud';
import { createChapterPanel } from './ui/chapter';
import { chapterError, createJourneyApi, GameApiError, providerError, type ChapterQuiz, type Journey } from './services/journey';
import { mergeArchivedFeedback, readArchivedFeedback } from './services/feedback';
import { createNpcStreamReader } from './services/npc-stream';

const root = document.querySelector<HTMLElement>('#game-root')!;
const accountId = localStorage.getItem('ai_en_user') || sessionStorage.getItem('ai_en_user') || 'guest';
const archivedFeedback = readArchivedFeedback(accountId);
const state = createState(accountId);
if (new URLSearchParams(location.search).get('view') === '2d') state.mode = '2d';
const hud = createHud(root);
const canvas = root.querySelector<HTMLCanvasElement>('#wg-canvas')!;
const renderer = createRenderer(canvas);
const keys = new Set<string>();
let last = performance.now(), syncElapsed = 0, saveElapsed = 0, frameId = 0;
let disposed = false, loadingJourney = false, journeyReady = false;
let moveRequest: Promise<boolean> | undefined;
let lastSynced: { x: number; z: number; at: number } | undefined;
let conversationRequest: AbortController | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const feedbackRetries = new Set<string>();
let journey: Journey | undefined;
let currentQuiz: ChapterQuiz | undefined;
const token = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token') || '';
const headers = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const providerSettings = () => {
  try {
    const settings = JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}') as Record<string, string>;
    return { provider: settings.llmProvider || 'aihub8', model: settings.llmTextModel || undefined };
  } catch { return { provider: 'aihub8' }; }
};
const releaseVersion = new URLSearchParams(location.search).get('version') || '';
const apiBase = location.pathname.startsWith('/english-beta/') || releaseVersion.startsWith('beta') ? '/api-beta' : location.pathname.startsWith('/english-dev/') || releaseVersion.startsWith('dev') ? '/api-dev' : '';
root.querySelector<HTMLAnchorElement>('#wg-back')!.href = apiBase === '/api-beta' ? '/english/?version=beta' : apiBase === '/api-dev' ? '/english/?version=dev' : '/';
const api = createJourneyApi({ apiBase, headers, provider: providerSettings });
const showFeedback = (feedback: Journey['feedback']) => {
  hud.refreshFeedback(mergeArchivedFeedback(feedback.records, archivedFeedback), retryFeedback);
  hud.refreshSummaries(feedback.summaries, retryFeedback);
};
showFeedback({ records: [], summaries: [] });
const chapter = createChapterPanel(root, {
  start: () => { void startQuiz(); },
  answer: (index, choice) => { void answerQuiz(index, choice); },
  settle: () => { void settleChapter(); },
  switchStage: stageId => { void switchChapter(stageId); },
  refresh: () => { void refreshJourney(true); }
});
const feedbackIsOpen = () => !root.querySelector<HTMLElement>('#wg-feedback-panel')!.hidden;
const paused = () => Boolean(root.querySelector('dialog[open]')) || feedbackIsOpen() || loadingJourney || Boolean(conversationRequest) || Boolean(token && !journeyReady);

function setMode(mode: typeof state.mode) {
  state.mode = mode; renderer.setMode(mode);
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
}
canvas.addEventListener('world-game-renderer-fallback', () => setMode('2d'));
function updateNearby() {
  state.nearbyNpc = nearestNpc(state, WORLD.npcs)?.id;
  hud.update(state, state.nearbyNpc ? WORLD.npcs.find(npc => npc.id === state.nearbyNpc) : undefined);
}
function applyJourney(next: Journey, reposition = false) {
  const changedStage = state.currentStage !== next.stageId;
  journey = next; journeyReady = true;
  state.currentStage = next.stageId;
  state.activeNpcIds = [...(next.stages.find(stage => stage.id === next.stageId)?.npcs || [])];
  state.clues = next.evidence.filter(item => item.stageId === next.stageId).map(item => `${item.text} — ${WORLD.npcs.find(npc => npc.id === item.source)?.name || item.source}`);
  if (reposition || changedStage) {
    state.player = { ...next.position }; lastSynced = undefined; keys.clear();
    state.activeNpc = undefined; state.nearbyNpc = undefined;
    hud.resetDialogue();
  }
  if (changedStage) currentQuiz = undefined;
  chapter.update(next);
  showFeedback(next.feedback);
  updateNearby();
}
async function refreshJourney(reposition = false) {
  if (!token) { chapter.error('Sign in from the English app, then return to load your saved journey.'); return; }
  if (loadingJourney || disposed) return;
  loadingJourney = true;
  try { applyJourney(await api.load(), reposition); chapter.idle(); }
  catch (error) { chapter.error(chapterError(error)); }
  finally { loadingJourney = false; }
}
async function pollFeedback() {
  if (disposed || !token) return;
  try {
    const feedback = await api.feedback();
    if (disposed) return;
    showFeedback(feedback);
    if (journey) journey.feedback = feedback;
  } catch { /* Durable workers continue while the player reconnects. */ }
  finally { if (!disposed) feedbackTimer = setTimeout(() => { void pollFeedback(); }, document.hidden ? 15000 : 4000); }
}
async function retryFeedback(id: string) {
  if (feedbackRetries.has(id)) return;
  feedbackRetries.add(id);
  try { showFeedback(await api.retryFeedback(id)); hud.setFeedbackStatus(''); }
  catch (error) {
    if (error instanceof GameApiError && error.status === 409) {
      try {
        const feedback = await api.feedback(); showFeedback(feedback);
        const record = feedback.records.find(item => item.id === id) || feedback.summaries.find(item => item.id === id);
        hud.setFeedbackStatus(record && record.status !== 'failed' ? 'This note is already queued or ready. Its latest status is shown below.' : 'This note cannot be retried right now. Its latest saved status is shown below.');
        return;
      } catch { /* Keep the saved note and offer a later recovery. */ }
    }
    hud.setFeedbackStatus(error instanceof GameApiError && error.status === 401
      ? 'Sign in from the English app to retry feedback.'
      : error instanceof GameApiError && providerError(error.status, error.detail)
        || 'The feedback service could not be reached. Your saved note is still available; retry when the connection returns.');
  } finally { feedbackRetries.delete(id); }
}
async function startQuiz() {
  chapter.busy('Gathering your chapter questions…');
  try {
    currentQuiz = await api.questions(state.currentStage);
    chapter.showQuiz(currentQuiz);
  } catch (error) { chapter.error(chapterError(error)); }
}
async function answerQuiz(index: number, choice: number) {
  if (!currentQuiz) return;
  chapter.busy('Checking your conclusion…');
  try {
    const result = await api.answer(currentQuiz.quizId, index, choice);
    currentQuiz.answers[index] = result;
    chapter.showQuiz(currentQuiz);
  } catch (error) {
    // If a response was lost after the server accepted it, resume the same saved
    // quiz instead of submitting a second answer or silently starting over.
    if (error instanceof GameApiError && error.status === 409) {
      try { const saved = await api.load(); applyJourney(saved); if (saved.quiz) { currentQuiz = saved.quiz; chapter.showQuiz(currentQuiz); return; } } catch { /* Show the original reconnect guidance. */ }
    }
    chapter.error(chapterError(error));
  }
}
async function settleChapter() {
  if (!currentQuiz) return;
  chapter.busy('Recording your investigation…');
  try {
    const result = await api.settle(currentQuiz.quizId);
    currentQuiz = undefined;
    try { applyJourney(await api.load()); }
    catch { /* The settlement itself is authoritative; a lost refresh must not hide it. */ }
    chapter.showSettlement(result);
  } catch (error) { chapter.error(chapterError(error)); }
}
async function switchChapter(stageId: StageId) {
  if (conversationRequest || loadingJourney) return;
  loadingJourney = true; keys.clear(); chapter.busy('Opening your next chapter…');
  try {
    if (moveRequest) await moveRequest;
    applyJourney(await api.switchStage(stageId), true);
    currentQuiz = undefined; chapter.idle();
  } catch (error) { chapter.error(chapterError(error)); }
  finally { loadingJourney = false; }
}
function interact() {
  const npc = nearestNpc(state, WORLD.npcs); if (!npc || paused()) return;
  state.activeNpc = npc.id;
  hud.openDialogue(npc, async text => {
    const line = root.querySelector<HTMLElement>('#wg-transcript')!;
    if (!token) { line.textContent = 'Sign in from the English app, then return here.'; return; }
    if (nearestNpc(state, [npc])?.id !== npc.id) { line.textContent = `Walk back to ${npc.name} to continue speaking.`; return; }
    keys.clear();
    if (moveRequest) await moveRequest;
    if (!await syncPosition()) { line.textContent = 'Your position could not be confirmed. Wait a moment, then try again.'; return; }
    if (nearestNpc(state, [npc])?.id !== npc.id) { line.textContent = `Walk back to ${npc.name} to continue speaking.`; return; }
    const controller = new AbortController(); conversationRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    let partialAnswer = '';
    try {
      const response = await fetch(`${apiBase}/api/world-game/npc`, {
        method: 'POST', headers: headers(), signal: controller.signal,
        body: JSON.stringify({ stageId: state.currentStage, npcId: npc.id, text, turnId: crypto.randomUUID(), ...providerSettings() })
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        line.textContent = providerError(response.status, detail) || (response.status === 401 ? 'Sign in from the English app, then return here.' : response.status === 429 ? 'The harbor line or your call allowance is busy. Wait a moment, then try again.' : 'The harbor line was interrupted. Your saved notes are unchanged; please try again.');
        return;
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      const stream = createNpcStreamReader(text => { partialAnswer = text; line.textContent = text; });
      while (true) {
        const { done, value } = await reader.read();
        if (done) { stream.push(decoder.decode()); break; }
        stream.push(decoder.decode(value, { stream: true }));
      }
      const result = stream.finish();
      if (!result.complete) line.textContent = result.text ? `${result.text}\n\nThis reply was interrupted and was not recorded as evidence. You can ask again.` : 'The connection ended before the resident could answer. You can ask again.';
      // Evidence and English jobs are awarded by the server only after a real
      // successful turn. They are never inferred from text or client keywords.
      await refreshJourney();
    } catch {
      line.textContent = partialAnswer.trim()
        ? `${partialAnswer}\n\nThis reply was interrupted and was not recorded as evidence. You can ask again.`
        : 'The connection was interrupted. You can try speaking again.';
    } finally {
      clearTimeout(timeout); if (conversationRequest === controller) conversationRequest = undefined;
      // Even a rejected NPC provider call can have a durable learner-feedback job.
      if (!disposed) { try { showFeedback(await api.feedback()); } catch { /* Scheduled polling will reconcile later. */ } }
    }
  });
}
root.querySelector<HTMLButtonElement>('#wg-interact')!.addEventListener('click', interact);
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (feedbackIsOpen()) { if (event.key === 'Escape') root.querySelector<HTMLButtonElement>('#wg-feedback-close')!.click(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || paused()) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
  keys.add(event.key.toLowerCase()); if (event.key.toLowerCase() === 'e' && !event.repeat) interact();
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
root.addEventListener('focusin', event => { if ((event.target as HTMLElement)?.closest('#wg-feedback-panel, #wg-input, dialog')) keys.clear(); });
root.addEventListener('click', event => { if ((event.target as HTMLElement)?.closest('#wg-journal, #wg-journal-close, #wg-feedback-toggle, #wg-feedback-close, #wg-chapter-toggle')) keys.clear(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode as typeof state.mode)));
root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  const key = button.dataset.move!;
  button.addEventListener('pointerdown', event => { event.preventDefault(); if (paused()) return; button.setPointerCapture(event.pointerId); keys.add(key); });
  const up = () => keys.delete(key);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, up);
});
function syncPosition(): Promise<boolean> {
  if (!token || !journeyReady) return Promise.resolve(false);
  if (moveRequest) return moveRequest;
  if (lastSynced && Date.now() - lastSynced.at < 1000 && Math.hypot(state.player.x - lastSynced.x, state.player.z - lastSynced.z) < .01) return Promise.resolve(true);
  const sentPosition = { ...state.player }, sentStage = state.currentStage;
  moveRequest = (async () => {
    try {
      const response = await fetch(`${apiBase}/api/world-game/move`, { method: 'POST', headers: headers(), signal: AbortSignal.timeout(10000), body: JSON.stringify({ stageId: sentStage, position: sentPosition }) });
      if (response.status === 409) {
        const result = await response.json();
        if (state.currentStage === sentStage && Number.isFinite(result.position?.x) && Number.isFinite(result.position?.z)) state.player = result.position;
        if (result.stageId && result.stageId !== state.currentStage) void refreshJourney(true);
      }
      if (response.ok) lastSynced = { ...sentPosition, at: Date.now() };
      return response.ok;
    } catch { return false; } finally { moveRequest = undefined; }
  })();
  return moveRequest;
}
function frame(now: number) {
  if (disposed) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  let dx = 0, dz = 0;
  if (!document.hidden && !paused()) {
    if (keys.has('w') || keys.has('arrowup') || keys.has('up')) dz -= 1;
    if (keys.has('s') || keys.has('arrowdown') || keys.has('down')) dz += 1;
    if (keys.has('a') || keys.has('arrowleft') || keys.has('left')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright') || keys.has('right')) dx += 1;
  }
  movePlayer(state, dx, dz, dt); syncElapsed += dt; saveElapsed += dt;
  if (syncElapsed >= .5) { syncElapsed = 0; if (!loadingJourney) void syncPosition(); }
  updateNearby(); renderer.render(state, dt);
  if (saveElapsed >= .5) { saveElapsed = 0; saveState(state, accountId); }
  frameId = requestAnimationFrame(frame);
}
setMode(state.mode);
if (token) { void refreshJourney(true); void pollFeedback(); }
frameId = requestAnimationFrame(frame);
window.addEventListener('pagehide', event => {
  saveState(state, accountId); if (event.persisted) return;
  disposed = true; cancelAnimationFrame(frameId); conversationRequest?.abort(); api.dispose();
  if (feedbackTimer !== undefined) clearTimeout(feedbackTimer);
  renderer.dispose();
});

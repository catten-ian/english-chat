import './styles.css';
import { WORLD } from './content/world';
import { createState, movePlayer, nearestNpc, saveState } from './simulation/state';
import { createRenderer } from './render/renderer';
import { createHud } from './ui/hud';
import { createFeedbackQueue } from './services/feedback';

const root = document.querySelector<HTMLElement>('#game-root')!;
const accountId = localStorage.getItem('ai_en_user') || sessionStorage.getItem('ai_en_user') || 'guest';
const state = createState(accountId);
if (new URLSearchParams(location.search).get('view') === '2d') state.mode = '2d';
const hud = createHud(root);
const canvas = root.querySelector<HTMLCanvasElement>('#wg-canvas')!;
const renderer = createRenderer(canvas);
const keys = new Set<string>();
let last = performance.now();
let syncElapsed = 0;
let saveElapsed = 0;
let frameId = 0;
let disposed = false;
let moveRequest: Promise<boolean> | undefined;
let lastSynced: { x: number; z: number; at: number } | undefined;
let conversationRequest: AbortController | undefined;
const storedSettings = (() => { try { return JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}') as Record<string, string>; } catch { return {}; } })();
const provider = storedSettings.llmProvider || 'aihub8';
const model = storedSettings.llmTextModel || undefined;
const token = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token') || '';
const headers = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const releaseVersion = new URLSearchParams(location.search).get('version') || '';
const apiBase = location.pathname.startsWith('/english-beta/') || releaseVersion.startsWith('beta') ? '/api-beta' : location.pathname.startsWith('/english-dev/') || releaseVersion.startsWith('dev') ? '/api-dev' : '';
root.querySelector<HTMLAnchorElement>('#wg-back')!.href = apiBase === '/api-beta' ? '/english/?version=beta' : apiBase === '/api-dev' ? '/english/?version=dev' : '/';
const feedback = createFeedbackQueue({ accountId, apiBase, headers,
  onChange: (records) => hud.refreshFeedback(records, (id) => feedback.retry(id)) });
const feedbackIsOpen = () => !root.querySelector<HTMLElement>('#wg-feedback-panel')!.hidden;

function setMode(mode: typeof state.mode) { state.mode = mode; renderer.setMode(mode); root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => { button.classList.toggle('active', button.dataset.mode === mode); button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); }); }
canvas.addEventListener('world-game-renderer-fallback', () => setMode('2d'));
function updateNearby() { state.nearbyNpc = nearestNpc(state, WORLD.npcs)?.id; hud.update(state, state.nearbyNpc ? WORLD.npcs.find((npc) => npc.id === state.nearbyNpc) : undefined); }
function interact() {
  const npc = nearestNpc(state, WORLD.npcs); if (!npc) return;
  state.activeNpc = npc.id;
  hud.openDialogue(npc, async (text) => {
    const line = root.querySelector<HTMLElement>('#wg-transcript')!;
    if (!token) { line.textContent = 'Sign in from the English app, then return here.'; return; }
    if (nearestNpc(state, [npc])?.id !== npc.id) { line.textContent = `Walk back to ${npc.name} to continue speaking.`; return; }
    keys.clear();
    // Finish any periodic update before sending the final position for this turn.
    if (moveRequest) await moveRequest;
    if (!await syncPosition()) { line.textContent = 'Your position could not be confirmed. Wait a moment, then try again.'; return; }
    if (nearestNpc(state, [npc])?.id !== npc.id) { line.textContent = `Walk back to ${npc.name} to continue speaking.`; return; }
    feedback.enqueue({ text, stageId: state.currentStage, npcName: npc.name });
    conversationRequest?.abort();
    const controller = new AbortController(); conversationRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
    const response = await fetch(`${apiBase}/api/world-game/npc`, { method: 'POST', headers: headers(), signal: controller.signal, body: JSON.stringify({ stageId: WORLD.stageId, npcId: npc.id, text, provider, model }) });
    if (!response.ok || !response.body) { line.textContent = response.status === 401 ? 'Sign in from the English app, then return here.' : 'The connection was interrupted. Your journal was not changed.'; return; }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let answer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || '';
      for (const event of events) for (const row of event.split(/\r?\n/)) if (row.startsWith('data:')) {
        const raw = row.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
        try { const delta = JSON.parse(raw).choices?.[0]?.delta?.content; if (typeof delta === 'string') { answer += delta; line.textContent = answer; } } catch { /* Ignore provider metadata events. */ }
      }
    }
    if (!answer.trim()) line.textContent = 'The connection ended before the resident could answer.';
    } finally { clearTimeout(timeout); if (conversationRequest === controller) conversationRequest = undefined; }
  });
}
root.querySelector<HTMLButtonElement>('#wg-interact')!.addEventListener('click', interact);
window.addEventListener('keydown', (event) => { const target = event.target as HTMLElement; if (feedbackIsOpen()) { if (event.key === 'Escape') root.querySelector<HTMLButtonElement>('#wg-feedback-close')!.click(); return; } if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.closest('#wg-feedback-panel') || root.querySelector('dialog[open]')) return; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault(); keys.add(event.key.toLowerCase()); if (event.key.toLowerCase() === 'e' && !event.repeat) interact(); });
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
root.addEventListener('focusin', (event) => { if ((event.target as HTMLElement)?.closest('#wg-feedback-panel, #wg-input')) keys.clear(); });
root.addEventListener('click', (event) => { if ((event.target as HTMLElement)?.closest('#wg-journal, #wg-journal-close, #wg-feedback-toggle, #wg-feedback-close')) keys.clear(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode as typeof state.mode)));
root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => { const key = button.dataset.move!; const down = (event: PointerEvent) => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(key); }; const up = () => keys.delete(key); button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up); });
setMode(state.mode);
function syncPosition(): Promise<boolean> {
  if (!token) return Promise.resolve(false);
  if (moveRequest) return moveRequest;
  if (lastSynced && Date.now() - lastSynced.at < 1000 && Math.hypot(state.player.x - lastSynced.x, state.player.z - lastSynced.z) < .01) return Promise.resolve(true);
  const sentPosition = { ...state.player };
  moveRequest = (async () => { try {
    const response = await fetch(`${apiBase}/api/world-game/move`, { method: 'POST', headers: headers(), signal: AbortSignal.timeout(10000), body: JSON.stringify({ stageId: WORLD.stageId, position: sentPosition }) });
    if (response.status === 409) {
      const result = await response.json();
      if (Number.isFinite(result.position?.x) && Number.isFinite(result.position?.z)) state.player = result.position;
    }
    if (response.ok) lastSynced = { ...sentPosition, at: Date.now() };
    return response.ok;
  } catch { return false; } finally { moveRequest = undefined; } })();
  return moveRequest;
}
function frame(now: number) { if (disposed) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; let dx = 0; let dz = 0; if (!document.hidden && !root.querySelector('dialog[open]') && !feedbackIsOpen() && !conversationRequest) { if (keys.has('w') || keys.has('arrowup') || keys.has('up')) dz -= 1; if (keys.has('s') || keys.has('arrowdown') || keys.has('down')) dz += 1; if (keys.has('a') || keys.has('arrowleft') || keys.has('left')) dx -= 1; if (keys.has('d') || keys.has('arrowright') || keys.has('right')) dx += 1; } movePlayer(state, dx, dz, dt); syncElapsed += dt; saveElapsed += dt; if (syncElapsed >= .5) { syncElapsed = 0; void syncPosition(); } updateNearby(); renderer.render(state, dt); if (saveElapsed >= .5) { saveElapsed = 0; saveState(state, accountId); } frameId = requestAnimationFrame(frame); }
frameId = requestAnimationFrame(frame);
window.addEventListener('pagehide', (event) => { saveState(state, accountId); if (event.persisted) return; disposed = true; cancelAnimationFrame(frameId); conversationRequest?.abort(); feedback.dispose(); renderer.dispose(); });

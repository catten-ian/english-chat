import './styles.css';
import { WORLD } from './content/world';
import { createState, movePlayer, nearestNpc, saveState } from './simulation/state';
import { createRenderer } from './render/renderer';
import { createHud } from './ui/hud';

const root = document.querySelector<HTMLElement>('#game-root')!;
const state = createState();
const hud = createHud(root);
const canvas = root.querySelector<HTMLCanvasElement>('#wg-canvas')!;
const renderer = createRenderer(canvas);
const keys = new Set<string>();
let last = performance.now();
let syncElapsed = 0;
const storedSettings = (() => { try { return JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}') as Record<string, string>; } catch { return {}; } })();
const provider = storedSettings.llmProvider || 'aihub8';
const model = storedSettings.llmTextModel || undefined;
const token = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token') || '';
const headers = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const releaseVersion = new URLSearchParams(location.search).get('version') || '';
const apiBase = location.pathname.startsWith('/english-beta/') || releaseVersion.startsWith('beta') ? '/api-beta' : location.pathname.startsWith('/english-dev/') || releaseVersion.startsWith('dev') ? '/api-dev' : '';

function setMode(mode: typeof state.mode) { state.mode = mode; renderer.setMode(mode); root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode)); }
function updateNearby() { state.nearbyNpc = nearestNpc(state, WORLD.npcs)?.id; hud.update(state, state.nearbyNpc ? WORLD.npcs.find((npc) => npc.id === state.nearbyNpc) : undefined); }
function interact() {
  const npc = nearestNpc(state, WORLD.npcs); if (!npc) return;
  state.activeNpc = npc.id;
  hud.openDialogue(npc, async (text) => {
    await syncPosition(0.5);
    const response = await fetch(`${apiBase}/api/world-game/npc`, { method: 'POST', headers: headers(), body: JSON.stringify({ stageId: WORLD.stageId, npcId: npc.id, text, provider, model }) });
    const line = root.querySelector<HTMLElement>('#wg-transcript')!;
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
  });
}
root.querySelector<HTMLButtonElement>('#wg-interact')!.addEventListener('click', interact);
window.addEventListener('keydown', (event) => { if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return; keys.add(event.key.toLowerCase()); if (event.key.toLowerCase() === 'e') interact(); });
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode as typeof state.mode)));
root.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => { const key = button.dataset.move!; const down = () => keys.add(key); const up = () => keys.delete(key); button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointerleave', up); });
setMode(state.mode);
async function syncPosition(dt: number) {
  if (!token) return;
  try {
    const response = await fetch(`${apiBase}/api/world-game/move`, { method: 'POST', headers: headers(), body: JSON.stringify({ stageId: WORLD.stageId, position: state.player, dt }) });
    if (response.status === 409) {
      const result = await response.json();
      if (Number.isFinite(result.position?.x) && Number.isFinite(result.position?.z)) state.player = result.position;
    }
  } catch { /* The render loop remains playable while the connection recovers. */ }
}
function frame(now: number) { const dt = Math.min(0.05, (now - last) / 1000); last = now; let dx = 0; let dz = 0; if (keys.has('w') || keys.has('arrowup') || keys.has('up')) dz -= 1; if (keys.has('s') || keys.has('arrowdown') || keys.has('down')) dz += 1; if (keys.has('a') || keys.has('arrowleft') || keys.has('left')) dx -= 1; if (keys.has('d') || keys.has('arrowright') || keys.has('right')) dx += 1; movePlayer(state, dx, dz, dt); syncElapsed += dt; if (syncElapsed >= .5) { syncElapsed = 0; syncPosition(.5); } updateNearby(); renderer.render(state, dt); saveState(state); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

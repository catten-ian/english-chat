import { Npc, WORLD } from '../content/world';
import { GameState } from '../simulation/state';
import type { FeedbackRecord } from '../services/feedback';
import '../feedback.css';

export type Hud = {
  root: HTMLElement;
  update(state: GameState, nearby?: Npc): void;
  openDialogue(npc: Npc, send: (text: string) => Promise<void>): void;
  refreshFeedback(records: readonly FeedbackRecord[], retry?: (id: string) => void): void;
};

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div class="wg-shell">
      <canvas id="wg-canvas" aria-label="Bellweather 3D harbor"></canvas>
      <a class="wg-back" id="wg-back" href="/">English app ↗</a>
      <div class="wg-objective"><span>${WORLD.title}</span><strong>${WORLD.objective}</strong><small id="wg-nearby">Explore the harbor</small></div>
      <aside class="wg-panel" aria-live="polite"><div class="wg-brand">BELLWEATHER <span>THE QUIET TIDE</span></div><div class="wg-panel-title" id="wg-speaker">NO ONE NEARBY</div><div class="wg-transcript" id="wg-transcript">Walk to a resident to begin a conversation.</div><form id="wg-form" hidden><textarea id="wg-input" rows="3" maxlength="1200" placeholder="Ask what you need to know..."></textarea><button type="submit">Send <span>↗</span></button></form></aside>
      <div class="wg-controls"><button data-mode="2d" aria-label="2D view">2D</button><button class="active" data-mode="3d" aria-label="3D view">3D</button><button id="wg-journal" aria-label="Open clue log">Clue Log <b id="wg-clue-count">0</b></button><button id="wg-feedback-toggle" aria-controls="wg-feedback-panel" aria-expanded="false">English <b id="wg-feedback-count">0</b></button></div>
      <aside class="wg-feedback" id="wg-feedback-panel" aria-labelledby="wg-feedback-title" hidden><header><div><small>YOUR FIELD NOTES</small><h2 id="wg-feedback-title">English feedback</h2></div><button id="wg-feedback-close" aria-label="Close English feedback">Close</button></header><p class="wg-feedback-intro">Keep exploring. Feedback arrives quietly here, ready whenever you are.</p><p id="wg-feedback-empty">Your English replies will appear here.</p><ol id="wg-feedback-list"></ol></aside>
      <dialog class="wg-journal" id="wg-journal-panel" aria-labelledby="wg-journal-title"><header><h2 id="wg-journal-title">Clue Log</h2><button id="wg-journal-close" aria-label="Close clue log">Close</button></header><p class="wg-journal-empty" id="wg-journal-empty">No clues recorded.</p><ol id="wg-clue-list" hidden></ol></dialog>
      <button class="wg-interact" id="wg-interact" hidden>Talk <span>↗</span></button>
      <div class="wg-touch" aria-label="Touch movement"><button data-move="up">▲</button><button data-move="left">◀</button><button data-move="down">▼</button><button data-move="right">▶</button></div>
    </div>`;
  const nearby = root.querySelector<HTMLElement>('#wg-nearby')!;
  const speaker = root.querySelector<HTMLElement>('#wg-speaker')!;
  const transcript = root.querySelector<HTMLElement>('#wg-transcript')!;
  const form = root.querySelector<HTMLFormElement>('#wg-form')!;
  const input = root.querySelector<HTMLTextAreaElement>('#wg-input')!;
  const sendButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const interact = root.querySelector<HTMLButtonElement>('#wg-interact')!;
  const journal = root.querySelector<HTMLDialogElement>('#wg-journal-panel')!;
  const clueList = root.querySelector<HTMLOListElement>('#wg-clue-list')!;
  const clueEmpty = root.querySelector<HTMLElement>('#wg-journal-empty')!;
  const feedbackPanel = root.querySelector<HTMLElement>('#wg-feedback-panel')!;
  const feedbackToggle = root.querySelector<HTMLButtonElement>('#wg-feedback-toggle')!;
  const feedbackList = root.querySelector<HTMLOListElement>('#wg-feedback-list')!;
  const setFeedbackOpen = (open: boolean) => {
    feedbackPanel.hidden = !open;
    feedbackToggle.setAttribute('aria-expanded', String(open));
    if (open) feedbackList.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };
  feedbackToggle.addEventListener('click', () => setFeedbackOpen(feedbackPanel.hidden));
  root.querySelector<HTMLButtonElement>('#wg-feedback-close')!.addEventListener('click', () => setFeedbackOpen(false));
  feedbackPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { setFeedbackOpen(false); feedbackToggle.focus(); }
  });
  root.querySelector<HTMLButtonElement>('#wg-journal')!.addEventListener('click', () => journal.showModal());
  root.querySelector<HTMLButtonElement>('#wg-journal-close')!.addEventListener('click', () => journal.close());
  journal.addEventListener('click', (event) => { if (event.target === journal) journal.close(); });
  let lastNearby: string | undefined;
  let lastClues = '';
  let sending = false;
  const update = (state: GameState, npc?: Npc) => {
    if (npc?.id !== lastNearby) {
      nearby.textContent = npc ? `Within talking distance · ${npc.name}` : 'Walk to a resident to begin a conversation';
      // A streamed speaker must not change merely because the player walks away.
      if (form.hidden) speaker.textContent = npc ? npc.name.toUpperCase() : 'NO ONE NEARBY';
      interact.hidden = !npc;
      lastNearby = npc?.id;
    }
    const clues = JSON.stringify(state.clues);
    if (clues !== lastClues) {
      root.querySelector('#wg-clue-count')!.textContent = String(state.clues.length);
      clueList.replaceChildren(...state.clues.map((clue) => { const item = document.createElement('li'); item.textContent = clue; return item; }));
      clueList.hidden = state.clues.length === 0;
      clueEmpty.hidden = state.clues.length > 0;
      lastClues = clues;
    }
  };
  const openDialogue = (npc: Npc, send: (text: string) => Promise<void>) => {
    if (sending) return;
    speaker.textContent = npc.name.toUpperCase();
    transcript.textContent = `${npc.name} is listening.`;
    form.hidden = false; input.focus();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || sending) return;
      sending = true; sendButton.disabled = true; input.disabled = true;
      input.value = ''; transcript.textContent = '…';
      try { await send(text); }
      catch { transcript.textContent = 'The connection was interrupted. You can try speaking again.'; input.value = text; }
      finally { sending = false; sendButton.disabled = false; input.disabled = false; }
    };
  };
  const refreshFeedback = (records: readonly FeedbackRecord[], retry?: (id: string) => void) => {
    root.querySelector('#wg-feedback-count')!.textContent = String(records.filter((record) => record.status === 'ready').length);
    root.querySelector<HTMLElement>('#wg-feedback-empty')!.hidden = records.length > 0;
    const focusedId = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.feedbackRetry : undefined;
    feedbackList.replaceChildren(...records.map((record) => {
      const item = document.createElement('li');
      const meta = document.createElement('small');
      meta.className = 'wg-feedback-meta';
      meta.textContent = `${record.npcName} · ${new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const original = document.createElement('blockquote'); original.textContent = record.text;
      const feedback = document.createElement('p');
      feedback.textContent = record.status === 'ready' ? record.feedback || ''
        : record.status === 'retry' ? 'Connection interrupted. Retrying quietly…'
        : record.status === 'failed' ? record.error || 'Feedback is unavailable.'
        : 'Preparing your feedback…';
      feedback.className = record.status === 'ready' ? 'wg-feedback-result' : 'wg-feedback-status';
      item.append(meta, original, feedback);
      if (record.status === 'failed' && retry) {
        const button = document.createElement('button');
        button.textContent = 'Retry feedback'; button.dataset.feedbackRetry = record.id;
        button.addEventListener('click', () => retry(record.id)); item.append(button);
      }
      return item;
    }));
    if (focusedId) feedbackList.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      if (button.dataset.feedbackRetry === focusedId) button.focus({ preventScroll: true });
    });
  };
  return { root, update, openDialogue, refreshFeedback };
}

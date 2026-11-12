import { Npc, WORLD } from '../content/world';
import { GameState } from '../simulation/state';

export type Hud = {
  root: HTMLElement;
  update(state: GameState, nearby?: Npc): void;
  openDialogue(npc: Npc, send: (text: string) => Promise<void>): void;
};

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div class="wg-shell">
      <canvas id="wg-canvas" aria-label="Bellweather 3D harbor"></canvas>
      <div class="wg-objective"><span>${WORLD.title}</span><strong>${WORLD.objective}</strong><small id="wg-nearby">Explore the harbor</small></div>
      <aside class="wg-panel" aria-live="polite"><div class="wg-brand">BELLWEATHER <span>THE QUIET TIDE</span></div><div class="wg-panel-title" id="wg-speaker">NO ONE NEARBY</div><div class="wg-transcript" id="wg-transcript">Walk to a resident to begin a conversation.</div><form id="wg-form" hidden><textarea id="wg-input" rows="3" maxlength="1200" placeholder="Ask what you need to know..."></textarea><button type="submit">Send <span>↗</span></button></form></aside>
      <div class="wg-controls"><button data-mode="2d" aria-label="2D view">2D</button><button class="active" data-mode="3d" aria-label="3D view">3D</button><button id="wg-journal" aria-label="Open clue log">Clue Log <b id="wg-clue-count">0</b></button></div>
      <dialog class="wg-journal" id="wg-journal-panel" aria-labelledby="wg-journal-title"><header><h2 id="wg-journal-title">Clue Log</h2><button id="wg-journal-close" aria-label="Close clue log">Close</button></header><p class="wg-journal-empty" id="wg-journal-empty">No clues recorded.</p><ol id="wg-clue-list" hidden></ol></dialog>
      <button class="wg-interact" id="wg-interact" hidden>Talk <span>↗</span></button>
      <div class="wg-touch" aria-label="Touch movement"><button data-move="up">▲</button><button data-move="left">◀</button><button data-move="down">▼</button><button data-move="right">▶</button></div>
    </div>`;
  const canvas = root.querySelector<HTMLCanvasElement>('#wg-canvas')!;
  const nearby = root.querySelector<HTMLElement>('#wg-nearby')!;
  const speaker = root.querySelector<HTMLElement>('#wg-speaker')!;
  const transcript = root.querySelector<HTMLElement>('#wg-transcript')!;
  const form = root.querySelector<HTMLFormElement>('#wg-form')!;
  const input = root.querySelector<HTMLTextAreaElement>('#wg-input')!;
  const interact = root.querySelector<HTMLButtonElement>('#wg-interact')!;
  const journal = root.querySelector<HTMLDialogElement>('#wg-journal-panel')!;
  const clueList = root.querySelector<HTMLOListElement>('#wg-clue-list')!;
  const clueEmpty = root.querySelector<HTMLElement>('#wg-journal-empty')!;
  root.querySelector<HTMLButtonElement>('#wg-journal')!.addEventListener('click', () => journal.showModal());
  root.querySelector<HTMLButtonElement>('#wg-journal-close')!.addEventListener('click', () => journal.close());
  journal.addEventListener('click', (event) => { if (event.target === journal) journal.close(); });
  const update = (state: GameState, npc?: Npc) => {
    nearby.textContent = npc ? `Within talking distance · ${npc.name}` : 'Walk to a resident to begin a conversation';
    speaker.textContent = npc ? npc.name.toUpperCase() : 'NO ONE NEARBY';
    interact.hidden = !npc;
    root.querySelector('#wg-clue-count')!.textContent = String(state.clues.length);
    clueList.replaceChildren(...state.clues.map((clue) => { const item = document.createElement('li'); item.textContent = clue; return item; }));
    clueList.hidden = state.clues.length === 0;
    clueEmpty.hidden = state.clues.length > 0;
  };
  const openDialogue = (npc: Npc, send: (text: string) => Promise<void>) => { speaker.textContent = npc.name.toUpperCase(); transcript.textContent = `${npc.name} is listening.`; form.hidden = false; input.focus(); form.onsubmit = async (event) => { event.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; transcript.textContent = '…'; await send(text); }; };
  return { root, update, openDialogue };
}

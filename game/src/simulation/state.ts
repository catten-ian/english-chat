import { Npc, NpcId, WORLD } from '../content/world';

export type GameMode = '3d' | '2d';

export type GameState = {
  mode: GameMode;
  player: { x: number; z: number };
  currentStage: string;
  activeNpc?: NpcId;
  nearbyNpc?: NpcId;
  clues: string[];
};

const STORAGE_KEY = 'bellweather:run:v2';

export function createState(accountId = 'guest'): GameState {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${encodeURIComponent(accountId)}`) || 'null') as Partial<GameState> | null;
    if (saved && saved.player && Number.isFinite(saved.player.x) && Number.isFinite(saved.player.z)) {
      return { mode: saved.mode === '2d' ? '2d' : '3d', player: { x: Math.min(WORLD.bounds.maxX, Math.max(WORLD.bounds.minX, saved.player.x)), z: Math.min(WORLD.bounds.maxZ, Math.max(WORLD.bounds.minZ, saved.player.z)) }, currentStage: WORLD.stageId, clues: Array.isArray(saved.clues) ? saved.clues.filter((clue): clue is string => typeof clue === 'string') : [] };
    }
  } catch { /* A corrupt local draft must not block a new run. */ }
  return { mode: '3d', player: { ...WORLD.playerSpawn }, currentStage: WORLD.stageId, clues: [] };
}

export function saveState(state: GameState, accountId = 'guest') {
  try { localStorage.setItem(`${STORAGE_KEY}:${encodeURIComponent(accountId)}`, JSON.stringify(state)); }
  catch { /* Storage denial must not stop the render loop. */ }
}

export function distance(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function nearestNpc(state: GameState, npcs: readonly Npc[]) {
  let found: Npc | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const npc of npcs) {
    const d = distance(state.player, npc.position);
    if (d <= npc.interactionRadius && d < best) { found = npc; best = d; }
  }
  return found;
}

export function movePlayer(state: GameState, dx: number, dz: number, dt: number) {
  const speed = 4.2;
  const length = Math.hypot(dx, dz) || 1;
  const next = { x: state.player.x + dx / length * speed * dt, z: state.player.z + dz / length * speed * dt };
  state.player.x = Math.min(WORLD.bounds.maxX, Math.max(WORLD.bounds.minX, next.x));
  state.player.z = Math.min(WORLD.bounds.maxZ, Math.max(WORLD.bounds.minZ, next.z));
}

export type NpcId = 'eli' | 'mara';

export type WorldPoint = { x: number; z: number };

export type Npc = {
  id: NpcId;
  name: string;
  role: string;
  position: WorldPoint;
  interactionRadius: number;
  accent: string;
};

export const WORLD = {
  stageId: 'low-tide',
  title: 'CHAPTER 01 · LOW TIDE',
  objective: 'Find why the harbor lanterns went dark.',
  playerSpawn: { x: 1.2, z: -10.5 },
  bounds: { minX: -28, maxX: 28, minZ: -25, maxZ: 16 },
  npcs: [
    { id: 'eli', name: 'Eli Turner', role: 'LIGHTHOUSE KEEPER', position: { x: 2, z: -11 }, interactionRadius: 2.6, accent: '#e6b27a' },
    { id: 'mara', name: 'Mara Quinn', role: 'HARBOR ELECTRICIAN', position: { x: 5, z: 4 }, interactionRadius: 2.6, accent: '#8eb6b2' }
  ] satisfies Npc[]
} as const;

export const npcById = (id: NpcId) => WORLD.npcs.find((npc) => npc.id === id)!;

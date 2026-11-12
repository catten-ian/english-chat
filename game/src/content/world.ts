export type NpcId = 'eli' | 'mara' | 'jonah';
export type StageId = 'low-tide' | 'storm-line' | 'beacon';
export type WorldPoint = { x: number; z: number };

export type Npc = {
  id: NpcId;
  name: string;
  role: string;
  position: WorldPoint;
  interactionRadius: number;
  accent: string;
};
export type PublicStage = {
  id: StageId;
  title: string;
  name: string;
  objective: string;
  publicFacts: string[];
  npcs: NpcId[];
};

// Public orientation only. Private memories, evidence and answer keys come from
// the server through their own audience-specific paths, never this bundle.
export const STAGES: readonly PublicStage[] = [
  { id: 'low-tide', title: 'CHAPTER 01 · LOW TIDE', name: 'The Missing Lantern', objective: 'Find why the harbor lanterns went dark.', publicFacts: ['The old pier lantern is missing after the storm.', 'The Wren ferry is overdue.', 'The harbor workshop is open for questions.'], npcs: ['eli', 'mara'] },
  { id: 'storm-line', title: 'CHAPTER 02 · THE STORM LINE', name: 'A Safe Crossing', objective: 'Trace the storm surge and guide the rescue boat.', publicFacts: [], npcs: ['mara', 'jonah'] },
  { id: 'beacon', title: 'CHAPTER 03 · FIRST LIGHT', name: 'The Beacon Returns', objective: 'Restore the beacon before the rescue drill.', publicFacts: [], npcs: ['eli', 'jonah'] }
];
export const WORLD = {
  stageId: 'low-tide' as StageId,
  title: STAGES[0].title,
  objective: STAGES[0].objective,
  playerSpawn: { x: 1.2, z: -10.5 },
  bounds: { minX: -28, maxX: 28, minZ: -25, maxZ: 16 },
  npcs: [
    { id: 'eli', name: 'Eli Turner', role: 'LIGHTHOUSE KEEPER', position: { x: 2, z: -11 }, interactionRadius: 2.6, accent: '#e6b27a' },
    { id: 'mara', name: 'Mara Quinn', role: 'HARBOR ELECTRICIAN', position: { x: 5, z: 4 }, interactionRadius: 2.6, accent: '#8eb6b2' },
    { id: 'jonah', name: 'Jonah Reed', role: 'FERRY PILOT', position: { x: 22, z: -16 }, interactionRadius: 2.6, accent: '#97b0c5' }
  ] satisfies Npc[]
} as const;
export const stageById = (id: string) => STAGES.find(stage => stage.id === id) || STAGES[0];
export const npcById = (id: NpcId) => WORLD.npcs.find(npc => npc.id === id)!;

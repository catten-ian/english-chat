'use strict';

const WORLD = Object.freeze({
  global: { setting: 'Bellweather is a small fishing town on a rocky coast.', rule: 'A storm has affected the harbor before the annual rescue drill.' },
  stages: [
    { id: 'low-tide', title: 'CHAPTER 01 · LOW TIDE', name: 'The Missing Lantern', objective: 'Find why the harbor lanterns went dark.', publicFacts: ['The old pier lantern is missing after the storm.', 'The Wren ferry is overdue.', 'The harbor workshop is open for questions.'], clues: ['A wet fuse lies beside the east pier.', 'The lens and fresh oil are not the cause.', 'The storm surge reached the lower switch box.'], npcs: ['eli', 'mara'], judgeOnly: 'Saltwater from the storm surge entered the lower switch box and shorted the harbor lantern circuit.', questions: [{ q: 'Why did the harbor lanterns go out?', options: ['The lighthouse lens cracked', 'Saltwater reached the lower switch box', 'The oil ran out', 'The keeper forgot to light them'], answer: 1, why: 'The wet fuse and storm surge point to saltwater in the lower switch box.' }] },
    { id: 'storm-line', title: 'CHAPTER 02 · THE STORM LINE', name: 'A Safe Crossing', objective: 'Trace the storm surge and guide the rescue boat.', publicFacts: ['The storm line has moved across the harbor.', 'The Wren still needs to be located.', 'The tide chart is available at the harbor office.'], clues: ['The second surge arrives at midnight.', 'The north channel hides rocks.', 'The east bell buoy marks a safe route.'], npcs: ['mara', 'jonah'], judgeOnly: 'The north channel is dangerous at midnight; the east channel marked by the bell buoy is the safe passage.', questions: [{ q: 'Which route should the rescue boat take?', options: ['The north channel at midnight', 'The east channel, following the bell buoy', 'Straight across the shoals', 'Wait until the buoy is silent'], answer: 1, why: 'The bell buoy marks the east channel as the safe passage.' }] },
    { id: 'beacon', title: 'CHAPTER 03 · FIRST LIGHT', name: 'The Beacon Returns', objective: 'Restore the beacon before the rescue drill.', publicFacts: ['The beacon needs inspection before the rescue drill.', 'The keeper has opened the workshop.', 'The tide will fall before first light.'], clues: ['A dry ceramic fuse is available.', 'The switch box needs drying first.', 'The beam must point toward open water.'], npcs: ['eli', 'jonah'], judgeOnly: 'Dry the switch box first, install the dry ceramic fuse, then aim the beam toward open water after the tide falls.', questions: [{ q: 'What is the safest order to restore the beacon?', options: ['Fit the fuse, then dry the box', 'Dry the box, fit the fuse, then aim toward open water', 'Aim the lens before opening the switch box', 'Pour fresh oil into the electrical box'], answer: 1, why: 'Dry the switch box before fitting the dry fuse, then aim the beam toward open water.' }] }
  ],
  npcs: {
    eli: { name: 'Eli Turner', role: 'lighthouse keeper', voice: 'measured, weathered, quietly hopeful',
      privateFacts: ['Eli has tended the lighthouse for decades and keeps a notebook of his maintenance checks.', 'Eli has difficulty hearing through his left ear; during the storm, wind and loose metal blurred the sounds from the pier. He remembers hearing a bell but cannot recall how many times it rang.', 'Eli did not inspect the lower harbor switch box during the storm.'],
      stagePrivateFacts: {
        'low-tide': ['Eli checked the lens this morning and found it intact.', 'Eli filled the lantern with fresh oil before the storm; the reservoir was still full when he checked it afterward.'],
        beacon: ['Eli keeps a dry ceramic fuse in his workshop.', 'Eli has disconnected the beacon supply for inspection. His maintenance notebook requires drying the switch box completely before a replacement fuse can be fitted.', 'The beacon must stay disconnected until the box is dry and the dry ceramic fuse has been fitted.']
      } },
    mara: { name: 'Mara Quinn', role: 'harbor electrician', voice: 'practical, direct, observant',
      privateFacts: ['Mara repairs harbor wiring and checks the tide gauge on her rounds.', 'Mara has no first-hand account of the Wren ferry crossing during the storm.'],
      stagePrivateFacts: {
        'low-tide': ['Mara found the wet fuse beside the east pier.', 'Mara believes the storm surge reached the lower switch box. The damp tide mark ends just above its door.'],
        'storm-line': ['Mara compared the harbor gauge with the current tide chart: a second storm surge is forecast at midnight.', 'Mara has marked the midnight surge in the harbor office tide chart.']
      } },
    jonah: { name: 'Jonah Reed', role: 'ferry pilot', voice: 'warm, concise, confident on the water',
      privateFacts: ['Jonah pilots the Wren and has learned the harbor channels through years of crossings.', 'Jonah has not inspected the harbor electrical equipment.'],
      stagePrivateFacts: {
        'storm-line': ['Jonah knows the north channel has submerged rocks.', 'Jonah follows the bell buoy through the east channel. Its marked passage stays clear of the shoals during the expected surge.'],
        beacon: ['Jonah checked the harbor markers after the storm. Once the tide has fallen, the beacon beam needs to point toward open water, along the outer channel markers.', 'A beam aimed at the inner shoals would lead an approaching boat toward rocks.']
      } }
  }
});

// Provider outages preserve the same three-question settlement contract. Each
// authored question is supported by facts the chapter's residents can share.
WORLD.stages[0].questions.push(
  { q: 'Which observation makes an empty oil reservoir unlikely?', options: ['The ferry is overdue', 'Eli found the reservoir still full', 'The tide chart is in the office', 'Mara heard four bells'], answer: 1, why: 'Eli checked the reservoir after the storm and found it full.' },
  { q: 'Whose direct observations help investigate the electrical fault?', options: ['Jonah inspected the lower switch box', 'A visitor saw the lens crack', 'Mara found a wet fuse and a high tide mark', 'Eli counted every bell precisely'], answer: 2, why: 'Mara found the wet fuse and saw a damp mark above the switch-box door; Eli did not inspect that box.' }
);
WORLD.stages[1].questions.push(
  { q: 'When is the next storm surge forecast?', options: ['At sunrise', 'At noon', 'At midnight', 'After the rescue drill'], answer: 2, why: 'Mara compared the gauge and current tide chart, which forecast a second surge at midnight.' },
  { q: 'Why should the boat avoid the north channel?', options: ['It has submerged rocks', 'The lighthouse lens is broken', 'The east bell buoy is missing', 'The north channel has no water at all'], answer: 0, why: 'Jonah knows the north channel has submerged rocks; the bell buoy marks a clear east passage.' }
);
WORLD.stages[2].questions.push(
  { q: 'Which replacement is available in Eli’s workshop?', options: ['A wet wire fuse', 'A dry ceramic fuse', 'A new ferry propeller', 'A cracked lens'], answer: 1, why: 'Eli keeps a dry ceramic fuse in the workshop.' },
  { q: 'Where should the restored beam point after the tide falls?', options: ['At the inner shoals', 'At the switch-box door', 'Toward open water along the outer markers', 'At the harbor office windows'], answer: 2, why: 'Jonah checked the outer markers. A beam toward the inner shoals would lead boats toward rocks.' }
);

module.exports = WORLD;

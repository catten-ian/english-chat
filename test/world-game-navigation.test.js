'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nav = require('../shared/world-game-navigation.cjs');

test('runtime navigation exactly matches the exported harbor surface manifest', () => {
  const exported = JSON.parse(fs.readFileSync(path.join(__dirname, '../game/tools/harbor-navigation.json'), 'utf8'));
  assert.deepEqual(nav.manifest, exported);
  assert.equal(nav.manifest.sourceAsset, 'bellweather-harbor-v6.glb');
});
test('spawn and residents stand on safe ground; water and conservative building walls block the avatar footprint', () => {
  for (const point of [{ x: 1.2, z: -10.5 }, { x: 2, z: -11 }, { x: 5, z: 4 }, { x: 22, z: -16 }]) assert.equal(nav.isWalkable(point), true);
  assert.equal(nav.isWalkable({ x: -10, z: -18 }), false);
  assert.equal(nav.isWalkable({ x: 15, z: -12 }), false);
  assert.equal(nav.isWalkable({ x: 7, z: -1 }), false);
  assert.equal(nav.isWalkable({ x: 4, z: -1 }), false, 'avatar radius cannot clip the tide office wall');
  assert.equal(nav.isWalkable({ x: 10, z: 8 }), false);
  assert.equal(nav.isWalkable({ x: 28, z: 0 }), false, 'full footprint stays within world bounds');
  assert.equal(nav.floorHeightAt(2, -11), .07);
  assert.equal(nav.floorHeightAt(5, 4), -.075);
  assert.equal(nav.floorHeightAt(22, -16), .07);
});
test('segment stepping rejects tunnelling through a house and across the harbor water', () => {
  assert.equal(nav.isWalkable({ x: 3.5, z: -1 }), true);
  assert.equal(nav.isWalkable({ x: 10.5, z: -1 }), true);
  assert.equal(nav.segmentWalkable({ x: 3.5, z: -1 }, { x: 10.5, z: -1 }), false);
  assert.equal(nav.segmentWalkable({ x: 10, z: -8 }, { x: 22, z: -16 }), false);
  const collision = nav.moveSafely({ x: 3.5, z: -1 }, { x: 10.5, z: -1 });
  assert.equal(nav.isWalkable(collision), true);
  assert.ok(collision.x <= 4.1787 - nav.RADIUS + 1e-6);
});
test('walkable union keeps pier seams open and BFS reaches every resident from the actual spawn', () => {
  assert.equal(nav.segmentWalkable({ x: 2, z: -11 }, { x: 2, z: -10 }), true, 'keeper landing seam is open');
  assert.equal(nav.segmentWalkable({ x: 1, z: -5.5 }, { x: 1, z: -4 }), true, 'boardwalk joins the stone quay and pier');
  assert.equal(nav.segmentWalkable({ x: 10, z: -7.5 }, { x: 22, z: -7.5 }), true, 'cross-pier joins main pier to ferry approach');
  assert.equal(nav.segmentWalkable({ x: 22, z: -7.5 }, { x: 22, z: -16 }), true, 'ferry approach joins the landing');
  const start = { x: 1, z: -10.5 }, queue = [start], seen = new Set(['1,-10.5']);
  const goals = [{ x: 2, z: -11 }, { x: 5, z: 4 }, { x: 22, z: -16 }];
  const reached = new Set();
  for (let at = 0; at < queue.length; at++) {
    const from = queue[at];
    goals.forEach((goal, index) => { if (Math.hypot(from.x - goal.x, from.z - goal.z) < .3) reached.add(index); });
    if (reached.size === goals.length) break;
    for (const [dx, dz] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]]) {
      const next = { x: from.x + dx, z: from.z + dz }, key = `${next.x},${next.z}`;
      if (!seen.has(key) && nav.segmentWalkable(from, next)) { seen.add(key); queue.push(next); }
    }
  }
  assert.equal(reached.size, goals.length, 'all residents share a traversable connected component');
});
test('older positions inside water or houses recover to the nearest safe grid point; valid positions are untouched', () => {
  for (const point of [{ x: -10, z: -18 }, { x: 7, z: -1 }]) {
    const repaired = nav.relocate(point);
    assert.equal(nav.isWalkable(repaired), true);
    assert.ok(Math.hypot(repaired.x - point.x, repaired.z - point.z) < 10);
  }
  assert.deepEqual(nav.relocate({ x: 2, z: -11 }), { x: 2, z: -11 });
});

'use strict';
const manifest = require('../game/src/content/navigation.json');
const RADIUS = manifest.playerRadiusRecommendation;
const BOUNDS = Object.freeze({ minX: -28, maxX: 28, minZ: -25, maxZ: 16 });
const EPSILON = 1e-7;
const STEP = .1;
const inRect = (point, rect) => point.x >= rect[0] - EPSILON && point.x <= rect[2] + EPSILON && point.z >= rect[1] - EPSILON && point.z <= rect[3] + EPSILON;
function inPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    const cross = (point.x - xi) * (zj - zi) - (point.z - zi) * (xj - xi);
    if (Math.abs(cross) < EPSILON && point.x >= Math.min(xi, xj) - EPSILON && point.x <= Math.max(xi, xj) + EPSILON && point.z >= Math.min(zi, zj) - EPSILON && point.z <= Math.max(zi, zj) + EPSILON) return true;
    if ((zi > point.z) !== (zj > point.z) && point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function surfaceContains(point) {
  return manifest.walkableUnion.some(surface => surface.rect ? inRect(point, surface.rect) : inPolygon(point, surface.polygon));
}
function floorHeightAt(x, z) {
  const point = { x, z };
  const surfaces = manifest.walkableUnion.filter(surface => surface.rect ? inRect(point, surface.rect) : inPolygon(point, surface.polygon));
  return surfaces.length ? Math.max(...surfaces.map(surface => surface.height)) : 0;
}
const footprint = [{ x: 0, z: 0 }, ...Array.from({ length: 24 }, (_, i) => ({ x: Math.cos(i * Math.PI / 12) * RADIUS, z: Math.sin(i * Math.PI / 12) * RADIUS }))];
function isWalkable(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) || point.x < BOUNDS.minX + RADIUS || point.x > BOUNDS.maxX - RADIUS || point.z < BOUNDS.minZ + RADIUS || point.z > BOUNDS.maxZ - RADIUS) return false;
  // Check every footprint point against the union, preserving flush pier seams.
  if (!footprint.every(offset => surfaceContains({ x: point.x + offset.x, z: point.z + offset.z }))) return false;
  // Exact circle-vs-AABB overlap prevents clipping house corners between samples.
  return !manifest.buildingObstacles.some(({ rect }) => {
    const dx = point.x - Math.min(rect[2], Math.max(rect[0], point.x));
    const dz = point.z - Math.min(rect[3], Math.max(rect[1], point.z));
    return dx * dx + dz * dz < RADIUS * RADIUS - EPSILON;
  });
}
function segmentWalkable(from, to) {
  if (!isWalkable(from) || !isWalkable(to)) return false;
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / STEP);
  for (let index = 1; index < steps; index++) {
    const ratio = index / steps;
    if (!isWalkable({ x: from.x + (to.x - from.x) * ratio, z: from.z + (to.z - from.z) * ratio })) return false;
  }
  return true;
}
function moveSafely(from, to, onStep) {
  if (!isWalkable(from)) return relocate(from);
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / STEP));
  const dx = (to.x - from.x) / steps, dz = (to.z - from.z) / steps;
  let position = { x: from.x, z: from.z };
  for (let index = 0; index < steps; index++) {
    const next = { x: position.x + dx, z: position.z + dz };
    if (isWalkable(next)) position = next;
    else {
      const xOnly = { x: position.x + dx, z: position.z };
      const zOnly = { x: position.x, z: position.z + dz };
      if (isWalkable(xOnly)) position = xOnly;
      else if (isWalkable(zOnly)) position = zOnly;
    }
    onStep?.({ ...position });
  }
  return position;
}
function relocate(point) {
  if (isWalkable(point)) return { x: point.x, z: point.z };
  const x = Number.isFinite(point?.x) ? Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, point.x)) : 1.2;
  const z = Number.isFinite(point?.z) ? Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, point.z)) : -10.5;
  // Search a bounded quarter-metre grid for the nearest safe landing. This only
  // runs when an older save is inside new water/geometry, never during valid play.
  let best = { x: 1.2, z: -10.5 }, bestDistance = Infinity;
  for (let gx = BOUNDS.minX; gx <= BOUNDS.maxX; gx += .25) for (let gz = BOUNDS.minZ; gz <= BOUNDS.maxZ; gz += .25) {
    const distance = (gx - x) ** 2 + (gz - z) ** 2;
    if (distance < bestDistance && isWalkable({ x: gx, z: gz })) { best = { x: gx, z: gz }; bestDistance = distance; }
  }
  return best;
}
module.exports = { manifest, RADIUS, BOUNDS, isWalkable, segmentWalkable, moveSafely, relocate, floorHeightAt };

import type { GameMode } from './state';

// Input uses screen right/up. The map is north-up; the 3D camera looks toward
// logical +Z with a small fixed diagonal, while presentation reflects X.
export function movementFromScreen(mode: GameMode, right: number, down: number) {
  if (mode === '2d') return { x: right, z: down };
  const angle = Math.atan2(1.1, 5.3);
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return { x: cosine * right + sine * down, z: sine * right - cosine * down };
}

type Point = { x: number; z: number };
export const RADIUS: number;
export const BOUNDS: { minX: number; maxX: number; minZ: number; maxZ: number };
export function isWalkable(point: Point): boolean;
export function segmentWalkable(from: Point, to: Point): boolean;
export function moveSafely(from: Point, to: Point): Point;
export function relocate(point: Point): Point;
export function floorHeightAt(x: number, z: number): number;

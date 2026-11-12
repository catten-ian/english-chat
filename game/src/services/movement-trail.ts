type Point = { x: number; z: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

// Keep corners, simplify only straight forward steps, and bound offline walking.
// Taking a batch moves its endpoint to the anchor without touching later steps.
export class MovementTrail {
  private anchor: Point;
  private points: Point[] = [];
  private length = 0;
  constructor(position: Point) { this.anchor = { ...position }; }
  reset(position: Point) { this.anchor = { ...position }; this.points = []; this.length = 0; }
  get pending() { return this.points.length > 0; }
  get canWalk() { return this.points.length < 124 && this.length < 6; }
  append(position: Point) {
    const last = this.points.at(-1) || this.anchor;
    const step = distance(last, position);
    if (step < 1e-9) return;
    const before = this.points.length > 1 ? this.points[this.points.length - 2] : this.anchor;
    const ax = last.x - before.x, az = last.z - before.z;
    const bx = position.x - last.x, bz = position.z - last.z;
    if (this.points.length && ax * bx + az * bz > 0 && Math.abs(ax * bz - az * bx) <= 1e-10 * Math.max(1, Math.hypot(ax, az) * step)) this.points[this.points.length - 1] = { ...position };
    else this.points.push({ ...position });
    this.length += step;
  }
  take() {
    const path = this.points.map(point => ({ ...point }));
    const position = { ...(path.at(-1) || this.anchor) };
    this.anchor = position; this.points = []; this.length = 0;
    return { position, path: path.length ? path : [position] };
  }
}

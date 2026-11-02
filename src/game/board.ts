import { BASE, N, type Axis, type Dir, type Pos, type Tile } from './types';
import type { Rng } from './rng';

export function posIndex(p: Pos): number {
  return p[0] + N * (p[1] + N * p[2]);
}

export function posEquals(a: Pos, b: Pos): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The two axes that are not `axis`, in increasing order. */
export function otherAxes(axis: Axis): [Axis, Axis] {
  switch (axis) {
    case 0:
      return [1, 2];
    case 1:
      return [0, 2];
    case 2:
      return [0, 1];
  }
}

/** Build a position with `along` on `axis` and (u, v) on the other two axes in increasing order. */
export function makePos(axis: Axis, along: number, u: number, v: number): Pos {
  const p: [number, number, number] = [0, 0, 0];
  const [a, b] = otherAxes(axis);
  p[axis] = along;
  p[a] = u;
  p[b] = v;
  return p;
}

/** One tile's journey during a move, for animation. A merged-away tile carries `mergedInto`. */
export interface TileMove {
  readonly id: number;
  readonly value: number;
  readonly from: Pos;
  readonly to: Pos;
  readonly mergedInto?: number;
}

/** A tile that absorbed another this move and now holds `value`. */
export interface Merge {
  readonly id: number;
  readonly value: number;
  readonly pos: Pos;
}

export interface MoveResult {
  /** False when no tile slid or merged, which makes the move invalid. */
  readonly moved: boolean;
  /** The board after sliding and merging, before any spawn. */
  readonly tiles: readonly Tile[];
  /** Every tile that existed before the move, with where it went. */
  readonly moves: readonly TileMove[];
  readonly merges: readonly Merge[];
  /** Points earned: the sum of every merged tile's new value. */
  readonly gained: number;
}

/**
 * Slide every tile toward the wall `dir` points at, merging equal neighbours.
 * Each line parallel to the axis is independent. Within a line, tiles nearest
 * the wall merge first and a tile merges at most once per move, exactly like 2048.
 */
export function applyMove(tiles: readonly Tile[], dir: Dir): MoveResult {
  const grid: (Tile | undefined)[] = new Array<Tile | undefined>(N * N * N);
  for (const t of tiles) grid[posIndex(t.pos)] = t;

  const out: Tile[] = [];
  const moves: TileMove[] = [];
  const merges: Merge[] = [];
  let gained = 0;
  let moved = false;

  const wallCoord = (k: number) => (dir.sign === 1 ? N - 1 - k : k);

  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      // Tiles in this line, ordered from the wall inward.
      const line: Tile[] = [];
      for (let k = 0; k < N; k++) {
        const t = grid[posIndex(makePos(dir.axis, wallCoord(k), u, v))];
        if (t) line.push(t);
      }

      let write = 0;
      let last: { id: number; value: number; pos: Pos; merged: boolean } | null = null;

      for (const t of line) {
        if (last && !last.merged && last.value === t.value) {
          last.value *= 2;
          last.merged = true;
          gained += last.value;
          moved = true;
          moves.push({ id: t.id, value: t.value, from: t.pos, to: last.pos, mergedInto: last.id });
          merges.push({ id: last.id, value: last.value, pos: last.pos });
          out[out.length - 1] = { id: last.id, value: last.value, pos: last.pos };
        } else {
          const to = makePos(dir.axis, wallCoord(write), u, v);
          if (!posEquals(to, t.pos)) moved = true;
          last = { id: t.id, value: t.value, pos: to, merged: false };
          out.push({ id: t.id, value: t.value, pos: to });
          moves.push({ id: t.id, value: t.value, from: t.pos, to });
          write++;
        }
      }
    }
  }

  return { moved, tiles: out, moves, merges, gained };
}

export function emptyCells(tiles: readonly Tile[]): Pos[] {
  const taken = new Set<number>();
  for (const t of tiles) taken.add(posIndex(t.pos));
  const cells: Pos[] = [];
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const p: Pos = [x, y, z];
        if (!taken.has(posIndex(p))) cells.push(p);
      }
  return cells;
}

/** True when any slide in any of the six directions would change the board. */
export function canMove(tiles: readonly Tile[]): boolean {
  if (tiles.length < N * N * N) return true;
  const grid: number[] = new Array<number>(N * N * N).fill(0);
  for (const t of tiles) grid[posIndex(t.pos)] = t.value;
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = grid[posIndex([x, y, z])];
        if (x + 1 < N && grid[posIndex([x + 1, y, z])] === v) return true;
        if (y + 1 < N && grid[posIndex([x, y + 1, z])] === v) return true;
        if (z + 1 < N && grid[posIndex([x, y, z + 1])] === v) return true;
      }
  return false;
}

/** Probability that a spawned tile is the double value (6) rather than the base (3). */
export const DOUBLE_SPAWN_CHANCE = 0.1;

/** A new tile in a random empty cell. Throws if the board is full. */
export function spawnTile(tiles: readonly Tile[], rng: Rng, id: number): Tile {
  const cells = emptyCells(tiles);
  if (cells.length === 0) throw new Error('spawnTile: the board is full');
  const cell = cells[Math.floor(rng.next() * cells.length)] as Pos;
  const value = rng.next() < DOUBLE_SPAWN_CHANCE ? BASE * 2 : BASE;
  return { id, value, pos: cell };
}

export function maxValue(tiles: readonly Tile[]): number {
  let m = 0;
  for (const t of tiles) if (t.value > m) m = t.value;
  return m;
}

/** Throws if the board is inconsistent. Used by tests and by state restore. */
export function assertValidBoard(tiles: readonly Tile[]): void {
  const seenPos = new Set<number>();
  const seenId = new Set<number>();
  for (const t of tiles) {
    for (const c of t.pos) {
      if (!Number.isInteger(c) || c < 0 || c >= N) throw new Error(`Tile ${t.id} is off the board at ${t.pos.join(',')}`);
    }
    const i = posIndex(t.pos);
    if (seenPos.has(i)) throw new Error(`Two tiles share cell ${t.pos.join(',')}`);
    seenPos.add(i);
    if (seenId.has(t.id)) throw new Error(`Duplicate tile id ${t.id}`);
    seenId.add(t.id);
    if (!Number.isInteger(t.value) || t.value < BASE || (t.value / BASE) % 1 !== 0 || ((t.value / BASE) & ((t.value / BASE) - 1)) !== 0) {
      throw new Error(`Tile ${t.id} has an impossible value ${t.value}`);
    }
  }
}

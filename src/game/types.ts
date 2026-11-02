/** Side length of the cube. The board is N × N × N cells. */
export const N = 3;
export const CELLS = N * N * N;
/** The lowest tile value. Tiles double on merge: 3, 6, 12, … 3072. */
export const BASE = 3;
/** Reaching this tile wins the game (3 × 2^10, the same number of merges as 2048). */
export const TARGET = 3072;

export type Axis = 0 | 1 | 2;
export type Sign = 1 | -1;

/** A slide direction: along one world axis, toward its positive or negative wall. */
export interface Dir {
  readonly axis: Axis;
  readonly sign: Sign;
}

/** A cell coordinate [x, y, z], each in 0..N-1. y is up. z=N-1 is the side nearest the default camera. */
export type Pos = readonly [number, number, number];

export interface Tile {
  readonly id: number;
  readonly value: number;
  readonly pos: Pos;
}

export const DIRS = {
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
  down: { axis: 1, sign: -1 },
  up: { axis: 1, sign: 1 },
  back: { axis: 2, sign: -1 },
  forward: { axis: 2, sign: 1 },
} as const satisfies Record<string, Dir>;

export type DirName = keyof typeof DIRS;

export function dirName(dir: Dir): DirName {
  for (const [name, d] of Object.entries(DIRS) as [DirName, Dir][]) {
    if (d.axis === dir.axis && d.sign === dir.sign) return name;
  }
  throw new Error(`Not a direction: ${JSON.stringify(dir)}`);
}

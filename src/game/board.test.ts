import { describe, expect, it } from 'vitest';
import { applyMove, assertValidBoard, canMove, emptyCells, makePos, otherAxes, posIndex, spawnTile } from './board';
import { createRng } from './rng';
import { CELLS, DIRS, N, type Dir, type DirName, type Pos, type Tile } from './types';

let nextId = 1;
function tile(value: number, pos: Pos): Tile {
  return { id: nextId++, value, pos };
}
function at(tiles: readonly Tile[], pos: Pos): number | undefined {
  return tiles.find((t) => t.pos[0] === pos[0] && t.pos[1] === pos[1] && t.pos[2] === pos[2])?.value;
}
/** Values along a line on `axis` at (u, v), ordered from coordinate 0 to N-1. */
function lineValues(tiles: readonly Tile[], axis: 0 | 1 | 2, u: number, v: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  for (let k = 0; k < N; k++) out.push(at(tiles, makePos(axis, k, u, v)));
  return out;
}
/** Place values along a line on `axis` at (u, v). `undefined` leaves a gap. */
function lineTiles(axis: 0 | 1 | 2, u: number, v: number, values: (number | undefined)[]): Tile[] {
  const out: Tile[] = [];
  values.forEach((val, k) => {
    if (val !== undefined) out.push(tile(val, makePos(axis, k, u, v)));
  });
  return out;
}
const ALL_DIRS = Object.entries(DIRS) as [DirName, Dir][];

describe('coordinates', () => {
  it('posIndex is a bijection over the cube', () => {
    const seen = new Set<number>();
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) seen.add(posIndex([x, y, z]));
    expect(seen.size).toBe(CELLS);
  });
  it('makePos puts coordinates on the right axes', () => {
    expect(makePos(0, 2, 0, 1)).toEqual([2, 0, 1]);
    expect(makePos(1, 2, 0, 1)).toEqual([0, 2, 1]);
    expect(makePos(2, 2, 0, 1)).toEqual([0, 1, 2]);
    expect(otherAxes(0)).toEqual([1, 2]);
    expect(otherAxes(1)).toEqual([0, 2]);
    expect(otherAxes(2)).toEqual([0, 1]);
  });
});

describe('applyMove: sliding', () => {
  it.each(ALL_DIRS)('slides a lone tile to the %s wall', (_name, dir) => {
    const start = makePos(dir.axis, 1, 1, 1);
    const result = applyMove([tile(3, start)], dir);
    expect(result.moved).toBe(true);
    expect(result.tiles).toHaveLength(1);
    const wall = dir.sign === 1 ? N - 1 : 0;
    expect(result.tiles[0]?.pos[dir.axis]).toBe(wall);
    expect(result.merges).toHaveLength(0);
    expect(result.gained).toBe(0);
  });

  it.each(ALL_DIRS)('reports moved=false when nothing can slide %s', (_name, dir) => {
    const wall = dir.sign === 1 ? N - 1 : 0;
    const tiles = [tile(3, makePos(dir.axis, wall, 0, 0)), tile(6, makePos(dir.axis, wall, 2, 1))];
    const result = applyMove(tiles, dir);
    expect(result.moved).toBe(false);
    expect(result.tiles).toEqual(tiles);
  });

  it('keeps the other two coordinates of every tile', () => {
    const tiles = [tile(3, [0, 2, 1]), tile(6, [1, 0, 2]), tile(12, [2, 1, 0])];
    const result = applyMove(tiles, DIRS.up);
    for (const m of result.moves) {
      expect(m.to[0]).toBe(m.from[0]);
      expect(m.to[2]).toBe(m.from[2]);
      expect(m.to[1]).toBe(N - 1);
    }
  });

  it('closes gaps while preserving order', () => {
    const tiles = lineTiles(0, 0, 0, [3, undefined, 6]);
    const result = applyMove(tiles, DIRS.right);
    expect(lineValues(result.tiles, 0, 0, 0)).toEqual([undefined, 3, 6]);
    expect(result.moved).toBe(true);
  });
});

describe('applyMove: merging', () => {
  it('merges two equal neighbours into one tile of double value', () => {
    const [a, b] = lineTiles(0, 0, 0, [3, 3]);
    const result = applyMove([a!, b!], DIRS.right);
    expect(lineValues(result.tiles, 0, 0, 0)).toEqual([undefined, undefined, 6]);
    expect(result.gained).toBe(6);
    expect(result.merges).toEqual([{ id: b!.id, value: 6, pos: [2, 0, 0] }]);
    const absorbed = result.moves.find((m) => m.id === a!.id);
    expect(absorbed?.mergedInto).toBe(b!.id);
    expect(absorbed?.to).toEqual([2, 0, 0]);
  });

  it('merges across a gap', () => {
    const result = applyMove(lineTiles(1, 2, 2, [3, undefined, 3]), DIRS.down);
    expect(lineValues(result.tiles, 1, 2, 2)).toEqual([6, undefined, undefined]);
  });

  it('merges the pair nearest the wall first: [3,3,3] → [_,3,6] moving toward the high wall', () => {
    const result = applyMove(lineTiles(2, 0, 0, [3, 3, 3]), DIRS.forward);
    expect(lineValues(result.tiles, 2, 0, 0)).toEqual([undefined, 3, 6]);
    expect(result.gained).toBe(6);
  });

  it('merges the pair nearest the wall first: [3,3,3] → [6,3,_] moving toward the low wall', () => {
    const result = applyMove(lineTiles(2, 0, 0, [3, 3, 3]), DIRS.back);
    expect(lineValues(result.tiles, 2, 0, 0)).toEqual([6, 3, undefined]);
  });

  it('never merges a tile twice in one move: [3,3,6] → [_,_,12]? no, → [_,6,6]', () => {
    const result = applyMove(lineTiles(0, 1, 1, [3, 3, 6]), DIRS.right);
    expect(lineValues(result.tiles, 0, 1, 1)).toEqual([undefined, 6, 6]);
    expect(result.gained).toBe(6);
    expect(result.merges).toHaveLength(1);
  });

  it('does not chain: [6,3,3] → [_,6,6]', () => {
    const result = applyMove(lineTiles(0, 1, 1, [6, 3, 3]), DIRS.right);
    expect(lineValues(result.tiles, 0, 1, 1)).toEqual([undefined, 6, 6]);
  });

  it('a merge with no slide still counts as a move', () => {
    const result = applyMove(lineTiles(0, 0, 0, [undefined, 3, 3]), DIRS.right);
    expect(result.moved).toBe(true);
    expect(lineValues(result.tiles, 0, 0, 0)).toEqual([undefined, undefined, 6]);
  });

  it('sums gained over every merge in every line', () => {
    const tiles = [...lineTiles(1, 0, 0, [3, 3, undefined]), ...lineTiles(1, 2, 2, [12, 12, 24])];
    const result = applyMove(tiles, DIRS.up);
    expect(result.gained).toBe(6 + 24);
    expect(lineValues(result.tiles, 1, 0, 0)).toEqual([undefined, undefined, 6]);
    expect(lineValues(result.tiles, 1, 2, 2)).toEqual([undefined, 24, 24]);
  });

  it('tiles in different lines never interact', () => {
    const tiles = [tile(3, [0, 0, 0]), tile(3, [0, 1, 0]), tile(3, [0, 0, 1])];
    const result = applyMove(tiles, DIRS.right);
    expect(result.tiles).toHaveLength(3);
    expect(result.merges).toHaveLength(0);
    for (const t of result.tiles) expect(t.pos[0]).toBe(N - 1);
  });
});

describe('applyMove: invariants under random play', () => {
  it('keeps the board valid, conserves total value, and compacts every line', () => {
    const rng = createRng(12345);
    for (let iter = 0; iter < 2000; iter++) {
      // Random board: each cell filled with probability 0.55, value 3·2^k for k in 0..6.
      const tiles: Tile[] = [];
      for (let z = 0; z < N; z++)
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            if (rng.next() < 0.55) tiles.push(tile(3 * 2 ** Math.floor(rng.next() * 7), [x, y, z]));
          }
      const dir = ALL_DIRS[Math.floor(rng.next() * ALL_DIRS.length)]![1];
      const before = tiles.reduce((s, t) => s + t.value, 0);
      const result = applyMove(tiles, dir);

      assertValidBoard(result.tiles);
      expect(result.tiles.reduce((s, t) => s + t.value, 0)).toBe(before);
      expect(result.tiles.length).toBe(tiles.length - result.merges.length);
      expect(result.moves).toHaveLength(tiles.length);
      expect(result.gained).toBe(result.merges.reduce((s, m) => s + m.value, 0));

      // Every surviving id was in the input and every input id appears in moves exactly once.
      const inputIds = new Set(tiles.map((t) => t.id));
      for (const t of result.tiles) expect(inputIds.has(t.id)).toBe(true);
      expect(new Set(result.moves.map((m) => m.id)).size).toBe(tiles.length);

      // Compacted: along the move axis no gap sits between the wall and a tile.
      for (let u = 0; u < N; u++)
        for (let v = 0; v < N; v++) {
          const vals = lineValues(result.tiles, dir.axis, u, v);
          const ordered = dir.sign === 1 ? [...vals].reverse() : vals;
          let seenGap = false;
          for (const val of ordered) {
            if (val === undefined) seenGap = true;
            else expect(seenGap).toBe(false);
          }
        }

      // A move that changed nothing must say so, and vice versa.
      const same =
        result.merges.length === 0 &&
        result.tiles.every((t) => {
          const o = tiles.find((x) => x.id === t.id)!;
          return o.pos[0] === t.pos[0] && o.pos[1] === t.pos[1] && o.pos[2] === t.pos[2];
        });
      expect(result.moved).toBe(!same);
    }
  });
});

describe('emptyCells / canMove', () => {
  it('lists every cell on an empty board and none on a full one', () => {
    expect(emptyCells([])).toHaveLength(CELLS);
    const full: Tile[] = [];
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) full.push(tile(3, [x, y, z]));
    expect(emptyCells(full)).toHaveLength(0);
  });

  it('canMove is true with any empty cell', () => {
    expect(canMove([tile(3, [0, 0, 0])])).toBe(true);
  });

  /** A full board where every neighbouring pair differs, so no move is possible. */
  function deadBoard(): Tile[] {
    const out: Tile[] = [];
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) out.push(tile(3 * 2 ** (((x + 2 * y + 4 * z) % 8) + 1), [x, y, z]));
    return out;
  }

  it('canMove is false on a full board with no equal neighbours', () => {
    const board = deadBoard();
    expect(canMove(board)).toBe(false);
    for (const [, dir] of ALL_DIRS) expect(applyMove(board, dir).moved).toBe(false);
  });

  it.each([
    ['x', [1, 1, 1], [2, 1, 1]],
    ['y', [1, 1, 1], [1, 2, 1]],
    ['z', [1, 1, 1], [1, 1, 2]],
  ] as const)('canMove is true on a full board with one equal pair along %s', (_axis, a, b) => {
    const board = deadBoard().map((t) => (t.pos[0] === b[0] && t.pos[1] === b[1] && t.pos[2] === b[2] ? { ...t, value: at(deadBoard(), a)! } : t));
    expect(canMove(board)).toBe(true);
  });
});

describe('spawnTile', () => {
  it('spawns only into empty cells with a legal value', () => {
    const rng = createRng(7);
    let tiles: Tile[] = [];
    for (let i = 0; i < CELLS; i++) {
      const t = spawnTile(tiles, rng, 1000 + i);
      expect(at(tiles, t.pos)).toBeUndefined();
      expect([3, 6]).toContain(t.value);
      tiles = [...tiles, t];
    }
    assertValidBoard(tiles);
    expect(() => spawnTile(tiles, rng, 9999)).toThrow();
  });

  it('spawns 6 about one time in ten', () => {
    const rng = createRng(99);
    let sixes = 0;
    const trials = 5000;
    for (let i = 0; i < trials; i++) if (spawnTile([], rng, i).value === 6) sixes++;
    expect(sixes / trials).toBeGreaterThan(0.07);
    expect(sixes / trials).toBeLessThan(0.13);
  });
});

describe('assertValidBoard', () => {
  it('rejects overlapping tiles, off-board tiles, duplicate ids and bad values', () => {
    expect(() => assertValidBoard([tile(3, [0, 0, 0]), tile(3, [0, 0, 0])])).toThrow(/share/);
    expect(() => assertValidBoard([tile(3, [3, 0, 0])])).toThrow(/off the board/);
    expect(() => assertValidBoard([{ id: 1, value: 3, pos: [0, 0, 0] }, { id: 1, value: 3, pos: [1, 0, 0] }])).toThrow(/Duplicate/);
    expect(() => assertValidBoard([tile(5, [0, 0, 0])])).toThrow(/impossible/);
    expect(() => assertValidBoard([tile(9, [0, 0, 0])])).toThrow(/impossible/);
    expect(() => assertValidBoard([tile(3072, [0, 0, 0])])).not.toThrow();
  });
});

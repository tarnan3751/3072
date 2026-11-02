import { describe, expect, it } from 'vitest';
import { Game, type KeyValueStorage } from './game';
import { createRng, type Rng } from './rng';
import { DIRS, N, TARGET, type Tile } from './types';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
/** An rng that always returns the same value: picks the first empty cell and spawns a 3. */
const zeroRng: Rng = { next: () => 0 };

function sum(tiles: readonly Tile[]): number {
  return tiles.reduce((s, t) => s + t.value, 0);
}

describe('Game: start and moves', () => {
  it('starts with two tiles and no score', () => {
    const g = new Game({ rng: createRng(1), storage: null });
    expect(g.tiles).toHaveLength(2);
    expect(g.score).toBe(0);
    expect(g.moveCount).toBe(0);
    expect(g.won).toBe(false);
    expect(g.over).toBe(false);
    expect(g.canUndo).toBe(false);
  });

  it('a valid move spawns exactly one tile, scores, and records history', () => {
    const g = new Game({ rng: createRng(2), storage: null });
    // Find a direction that moves something.
    const before = g.tiles;
    let outcome = null;
    for (const dir of Object.values(DIRS)) {
      outcome = g.move(dir);
      if (outcome) break;
    }
    expect(outcome).not.toBeNull();
    expect(g.tiles.length).toBe(before.length - outcome!.merges.length + 1);
    expect(g.moveCount).toBe(1);
    expect(g.score).toBe(outcome!.gained);
    expect(g.best).toBe(g.score);
    expect(g.canUndo).toBe(true);
    expect(outcome!.tiles).toBe(g.tiles);
    expect(g.tiles.some((t) => t.id === outcome!.spawned.id)).toBe(true);
  });

  it('an invalid move returns null and changes nothing', () => {
    const g = new Game({ rng: zeroRng, storage: null });
    // zeroRng puts both start tiles at the first empty cells: (0,0,0) and (1,0,0), both 3s.
    expect(g.tiles.map((t) => t.pos)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const snapshot = JSON.stringify(g.tiles);
    expect(g.move(DIRS.down)).toBeNull();
    expect(g.move(DIRS.back)).toBeNull();
    expect(JSON.stringify(g.tiles)).toBe(snapshot);
    expect(g.moveCount).toBe(0);
    expect(g.canUndo).toBe(false);
  });

  it('total tile value grows by exactly the spawned value each move', () => {
    const g = new Game({ rng: createRng(3), storage: null });
    for (let i = 0; i < 200 && !g.over; i++) {
      const before = sum(g.tiles);
      const dir = Object.values(DIRS)[i % 6]!;
      const out = g.move(dir);
      if (out) expect(sum(g.tiles)).toBe(before + out.spawned.value);
      else expect(sum(g.tiles)).toBe(before);
    }
  });
});

describe('Game: undo', () => {
  it('restores the previous board and score, one step per call', () => {
    const g = new Game({ rng: createRng(4), storage: null });
    const states: string[] = [JSON.stringify([g.tiles, g.score])];
    let made = 0;
    for (let i = 0; i < 30 && made < 5; i++) {
      if (g.move(Object.values(DIRS)[i % 6]!)) {
        made++;
        states.push(JSON.stringify([g.tiles, g.score]));
      }
    }
    expect(made).toBe(5);
    for (let i = states.length - 1; i > 0; i--) {
      expect(g.undo()).toBe(true);
      expect(JSON.stringify([g.tiles, g.score])).toBe(states[i - 1]);
      expect(g.moveCount).toBe(i - 1);
    }
    expect(g.undo()).toBe(false);
  });

  it('keeps best score after undo', () => {
    const g = new Game({ rng: createRng(5), storage: null });
    for (let i = 0; i < 40; i++) g.move(Object.values(DIRS)[i % 6]!);
    const best = g.best;
    while (g.undo()) {
      /* rewind */
    }
    expect(g.score).toBe(0);
    expect(g.best).toBe(best);
  });

  it('caps the history length', () => {
    const g = new Game({ rng: createRng(6), storage: null, historyLimit: 3 });
    let made = 0;
    for (let i = 0; i < 60 && made < 10; i++) if (g.move(Object.values(DIRS)[i % 6]!)) made++;
    let undone = 0;
    while (g.undo()) undone++;
    expect(undone).toBe(3);
  });
});

describe('Game: win and game over', () => {
  function withBoard(tiles: Tile[], extra: Partial<{ score: number; won: boolean }> = {}): Game {
    const storage = memoryStorage();
    storage.setItem(
      '3072.state',
      JSON.stringify({ tiles, score: extra.score ?? 0, moveCount: 0, won: extra.won ?? false, over: false, nextId: 100 }),
    );
    return new Game({ rng: zeroRng, storage });
  }

  it('reports justWon on the move that makes the target, then never again', () => {
    const half = TARGET / 2;
    const g = withBoard([
      { id: 1, value: half, pos: [0, 0, 0] },
      { id: 2, value: half, pos: [2, 0, 0] },
    ]);
    const out = g.move(DIRS.right);
    expect(out?.justWon).toBe(true);
    expect(out?.gained).toBe(TARGET);
    expect(g.won).toBe(true);
    expect(g.tiles.some((t) => t.value === TARGET)).toBe(true);
    const next = g.move(DIRS.left);
    expect(next?.justWon).toBe(false);
    expect(g.won).toBe(true);
  });

  it('a loaded game that already won does not report justWon again', () => {
    const g = withBoard([{ id: 1, value: TARGET, pos: [0, 0, 0] }], { won: true });
    const out = g.move(DIRS.right);
    expect(out?.justWon).toBe(false);
  });

  it('detects game over when the spawn fills the last cell with no merge available', () => {
    // Full dead board (all neighbours differ) minus the cell (0,0,0).
    const tiles: Tile[] = [];
    let id = 1;
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          if (x === 0 && y === 0 && z === 0) continue;
          tiles.push({ id: id++, value: 3 * 2 ** (((x + 2 * y + 4 * z) % 8) + 1), pos: [x, y, z] });
        }
    const g = withBoard(tiles);
    expect(g.over).toBe(false);
    // Sliding left compacts line (·,0,0); the only empty cell becomes (2,0,0) and zeroRng spawns a 3 there,
    // next to 24, 96 and 384: no merge anywhere.
    const out = g.move(DIRS.left);
    expect(out).not.toBeNull();
    expect(out?.over).toBe(true);
    expect(g.over).toBe(true);
    expect(g.tiles).toHaveLength(N * N * N);
    // No further move is accepted until undo or a new game.
    expect(g.move(DIRS.right)).toBeNull();
    expect(g.undo()).toBe(true);
    expect(g.over).toBe(false);
    expect(g.tiles).toHaveLength(N * N * N - 1);
  });
});

describe('Game: persistence', () => {
  it('saves after every change and restores into a new instance', () => {
    const storage = memoryStorage();
    const g = new Game({ rng: createRng(8), storage });
    for (let i = 0; i < 25; i++) g.move(Object.values(DIRS)[i % 6]!);
    const g2 = new Game({ rng: createRng(9), storage });
    expect(g2.tiles).toEqual(g.tiles);
    expect(g2.score).toBe(g.score);
    expect(g2.best).toBe(g.best);
    expect(g2.moveCount).toBe(g.moveCount);
    expect(g2.canUndo).toBe(false);
  });

  it('ignores corrupt saved state and starts fresh', () => {
    const storage = memoryStorage();
    storage.setItem('3072.state', '{not json');
    const g = new Game({ rng: createRng(10), storage });
    expect(g.tiles).toHaveLength(2);
    storage.setItem('3072.state', JSON.stringify({ tiles: [{ id: 1, value: 5, pos: [0, 0, 0] }] }));
    const g2 = new Game({ rng: createRng(10), storage });
    expect(g2.tiles).toHaveLength(2);
    storage.setItem('3072.state', JSON.stringify({ tiles: [{ id: 1, value: 3, pos: [0, 0, 0] }, { id: 2, value: 3, pos: [0, 0, 0] }] }));
    const g3 = new Game({ rng: createRng(10), storage });
    expect(g3.tiles).toHaveLength(2);
    expect(new Set(g3.tiles.map((t) => t.pos.join())).size).toBe(2);
  });

  it('new game clears the board but keeps best', () => {
    const storage = memoryStorage();
    const g = new Game({ rng: createRng(11), storage });
    for (let i = 0; i < 25; i++) g.move(Object.values(DIRS)[i % 6]!);
    const best = g.best;
    expect(best).toBeGreaterThan(0);
    g.newGame();
    expect(g.score).toBe(0);
    expect(g.tiles).toHaveLength(2);
    expect(g.best).toBe(best);
    expect(g.canUndo).toBe(false);
    expect(new Game({ rng: createRng(12), storage }).best).toBe(best);
  });

  it('works with no storage at all', () => {
    const g = new Game({ rng: createRng(13), storage: null });
    expect(() => g.move(DIRS.up)).not.toThrow();
    expect(() => g.newGame()).not.toThrow();
  });
});

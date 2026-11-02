import { applyMove, assertValidBoard, canMove, maxValue, spawnTile, type Merge, type TileMove } from './board';
import { createRng, randomSeed, type Rng } from './rng';
import { TARGET, type Dir, type Tile } from './types';

export interface MoveOutcome {
  readonly dir: Dir;
  readonly moves: readonly TileMove[];
  readonly merges: readonly Merge[];
  readonly spawned: Tile;
  readonly gained: number;
  /** The board after the move and the spawn. */
  readonly tiles: readonly Tile[];
  /** True only on the move that first produces the target tile. */
  readonly justWon: boolean;
  readonly over: boolean;
}

interface Snapshot {
  readonly tiles: readonly Tile[];
  readonly score: number;
  readonly moveCount: number;
  readonly won: boolean;
  readonly over: boolean;
  readonly nextId: number;
}

/** The subset of Storage the game needs, so tests can pass a plain object. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameOptions {
  rng?: Rng;
  storage?: KeyValueStorage | null;
  storageKey?: string;
  historyLimit?: number;
  startTiles?: number;
}

const DEFAULT_KEY = '3072';

export class Game {
  tiles: readonly Tile[] = [];
  score = 0;
  best = 0;
  moveCount = 0;
  won = false;
  over = false;

  private nextId = 1;
  private history: Snapshot[] = [];
  private readonly rng: Rng;
  private readonly storage: KeyValueStorage | null;
  private readonly key: string;
  private readonly historyLimit: number;
  private readonly startTiles: number;

  constructor(opts: GameOptions = {}) {
    this.rng = opts.rng ?? createRng(randomSeed());
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.key = opts.storageKey ?? DEFAULT_KEY;
    this.historyLimit = opts.historyLimit ?? 100;
    this.startTiles = opts.startTiles ?? 2;
    this.best = this.loadBest();
    if (!this.restore()) this.newGame();
  }

  newGame(): void {
    this.tiles = [];
    this.score = 0;
    this.moveCount = 0;
    this.won = false;
    this.over = false;
    this.nextId = 1;
    this.history = [];
    for (let i = 0; i < this.startTiles; i++) this.tiles = [...this.tiles, spawnTile(this.tiles, this.rng, this.nextId++)];
    this.save();
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Apply a slide. Returns null, and changes nothing, when the slide would not move any tile. */
  move(dir: Dir): MoveOutcome | null {
    if (this.over) return null;
    const result = applyMove(this.tiles, dir);
    if (!result.moved) return null;

    this.pushHistory();

    const spawned = spawnTile(result.tiles, this.rng, this.nextId++);
    const tiles = [...result.tiles, spawned];
    const wasWon = this.won;

    this.tiles = tiles;
    this.score += result.gained;
    this.moveCount += 1;
    if (this.score > this.best) {
      this.best = this.score;
      this.saveBest();
    }
    this.won = wasWon || maxValue(tiles) >= TARGET;
    this.over = !canMove(tiles);
    this.save();

    return {
      dir,
      moves: result.moves,
      merges: result.merges,
      spawned,
      gained: result.gained,
      tiles,
      justWon: this.won && !wasWon,
      over: this.over,
    };
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.tiles = snap.tiles;
    this.score = snap.score;
    this.moveCount = snap.moveCount;
    this.won = snap.won;
    this.over = snap.over;
    this.nextId = snap.nextId;
    this.save();
    return true;
  }

  private pushHistory(): void {
    this.history.push({
      tiles: this.tiles,
      score: this.score,
      moveCount: this.moveCount,
      won: this.won,
      over: this.over,
      nextId: this.nextId,
    });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  private save(): void {
    if (!this.storage) return;
    const snap: Snapshot = {
      tiles: this.tiles,
      score: this.score,
      moveCount: this.moveCount,
      won: this.won,
      over: this.over,
      nextId: this.nextId,
    };
    try {
      this.storage.setItem(`${this.key}.state`, JSON.stringify(snap));
    } catch {
      /* storage may be full or blocked; the game still works in memory */
    }
  }

  private restore(): boolean {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(`${this.key}.state`);
      if (!raw) return false;
      const snap = JSON.parse(raw) as Partial<Snapshot>;
      if (!Array.isArray(snap.tiles) || snap.tiles.length === 0) return false;
      const tiles: Tile[] = snap.tiles.map((t) => ({ id: Number(t.id), value: Number(t.value), pos: [Number(t.pos[0]), Number(t.pos[1]), Number(t.pos[2])] }));
      assertValidBoard(tiles);
      this.tiles = tiles;
      this.score = Number(snap.score) || 0;
      this.moveCount = Number(snap.moveCount) || 0;
      this.won = Boolean(snap.won);
      this.over = Boolean(snap.over);
      this.nextId = Math.max(Number(snap.nextId) || 1, ...tiles.map((t) => t.id + 1));
      this.history = [];
      return true;
    } catch {
      return false;
    }
  }

  private loadBest(): number {
    if (!this.storage) return 0;
    try {
      return Number(this.storage.getItem(`${this.key}.best`)) || 0;
    } catch {
      return 0;
    }
  }

  private saveBest(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(`${this.key}.best`, String(this.best));
    } catch {
      /* ignore */
    }
  }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__3072_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

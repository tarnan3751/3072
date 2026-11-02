export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Entry {
  start: number;
  duration: number;
  ease: Ease;
  onUpdate: (t: number) => void;
  onDone?: (() => void) | undefined;
  done: boolean;
}

export interface TweenOptions {
  ease?: Ease;
  delay?: number;
  onDone?: () => void;
}

/** A tiny scheduler for time-based animations. `finishAll` jumps everything to its end state in order. */
export class Tweens {
  private list: Entry[] = [];

  add(duration: number, onUpdate: (t: number) => void, opts: TweenOptions = {}): void {
    const now = performance.now();
    const entry: Entry = {
      start: now + (opts.delay ?? 0),
      duration: Math.max(0, duration),
      ease: opts.ease ?? easeOutCubic,
      onUpdate,
      onDone: opts.onDone,
      done: false,
    };
    this.list.push(entry);
    if (entry.duration === 0 && entry.start <= now) this.complete(entry);
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  /** Advance to `now`. Returns true if anything changed. */
  update(now: number): boolean {
    if (this.list.length === 0) return false;
    for (const e of this.list) {
      if (now < e.start) continue;
      const t = e.duration === 0 ? 1 : Math.min(1, (now - e.start) / e.duration);
      if (t >= 1) this.complete(e);
      else e.onUpdate(e.ease(t));
    }
    this.list = this.list.filter((e) => !e.done);
    return true;
  }

  finishAll(): void {
    const pending = this.list;
    this.list = [];
    for (const e of pending) if (!e.done) this.complete(e);
  }

  private complete(e: Entry): void {
    e.done = true;
    e.onUpdate(1);
    e.onDone?.();
  }
}

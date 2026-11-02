/** A seedable random source so games and tests are reproducible. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

/** mulberry32: small, fast, good enough for tile spawning. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] ?? 0;
  }
  return Math.floor(Math.random() * 4294967296);
}

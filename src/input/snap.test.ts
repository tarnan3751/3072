import { describe, expect, it } from 'vitest';
import { basisFromForward, keyToDir, snapToAxis, swipeToDir } from './snap';
import { DIRS } from '../game/types';

describe('snapToAxis', () => {
  it('picks the dominant axis and sign', () => {
    expect(snapToAxis({ x: 0.9, y: 0.1, z: -0.3 })).toEqual(DIRS.right);
    expect(snapToAxis({ x: -0.9, y: 0.1, z: -0.3 })).toEqual(DIRS.left);
    expect(snapToAxis({ x: 0.1, y: 0.8, z: 0.2 })).toEqual(DIRS.up);
    expect(snapToAxis({ x: 0.1, y: -0.8, z: 0.2 })).toEqual(DIRS.down);
    expect(snapToAxis({ x: 0.1, y: 0.2, z: 0.8 })).toEqual(DIRS.forward);
    expect(snapToAxis({ x: 0.1, y: 0.2, z: -0.8 })).toEqual(DIRS.back);
  });
  it('is deterministic on ties', () => {
    expect(snapToAxis({ x: 1, y: 1, z: 1 })).toEqual(DIRS.right);
    expect(snapToAxis({ x: 0, y: 1, z: 1 })).toEqual(DIRS.up);
  });
});

describe('camera-relative keys from the default view', () => {
  // Default camera: in front of the cube (+z), to the right (+x), looking down a little.
  const basis = basisFromForward({ x: -0.5, y: -0.4, z: -0.77 });

  it('arrows map to screen left/right/up/down', () => {
    expect(keyToDir('left', basis)).toEqual(DIRS.left);
    expect(keyToDir('right', basis)).toEqual(DIRS.right);
    expect(keyToDir('up', basis)).toEqual(DIRS.up);
    expect(keyToDir('down', basis)).toEqual(DIRS.down);
  });
  it('away pushes into the screen, toward pulls out of it', () => {
    expect(keyToDir('away', basis)).toEqual(DIRS.back);
    expect(keyToDir('toward', basis)).toEqual(DIRS.forward);
  });
  it('swipes follow the same mapping', () => {
    expect(swipeToDir(80, 5, basis)).toEqual(DIRS.right);
    expect(swipeToDir(-80, 5, basis)).toEqual(DIRS.left);
    expect(swipeToDir(3, -80, basis)).toEqual(DIRS.up);
    expect(swipeToDir(3, 80, basis)).toEqual(DIRS.down);
  });
});

describe('camera-relative keys after orbiting', () => {
  it('orbiting 90° to the right side swaps the horizontal axes', () => {
    // Camera at +x looking toward -x.
    const basis = basisFromForward({ x: -0.9, y: -0.4, z: 0 });
    expect(keyToDir('right', basis)).toEqual(DIRS.back);
    expect(keyToDir('left', basis)).toEqual(DIRS.forward);
    expect(keyToDir('away', basis)).toEqual(DIRS.left);
    expect(keyToDir('up', basis)).toEqual(DIRS.up);
  });
  it('looking from behind mirrors left and right', () => {
    const basis = basisFromForward({ x: 0, y: -0.3, z: 0.95 });
    expect(keyToDir('right', basis)).toEqual(DIRS.left);
    expect(keyToDir('away', basis)).toEqual(DIRS.forward);
  });
  it('a near top-down view keeps a usable basis', () => {
    const basis = basisFromForward({ x: 0.001, y: -1, z: 0.001 });
    const dirs = new Set(['left', 'right', 'up', 'down', 'away', 'toward'].map((k) => JSON.stringify(keyToDir(k as never, basis))));
    expect(dirs.size).toBe(6);
    expect(keyToDir('away', basis)).toEqual(DIRS.down);
  });
});

describe('screen axes never collide', () => {
  it('gives six distinct directions from every orbit angle, including exact diagonals', () => {
    const seen: string[] = [];
    for (let az = 0; az < 360; az += 15) {
      for (let el = -85; el <= 85; el += 17) {
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        // Camera on a sphere looking at the origin.
        const forward = { x: -Math.cos(e) * Math.sin(a), y: -Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
        const basis = basisFromForward(forward);
        const dirs = (['left', 'right', 'up', 'down', 'away', 'toward'] as const).map((k) => keyToDir(k, basis));
        const set = new Set(dirs.map((d) => `${d.axis}${d.sign}`));
        if (set.size !== 6) seen.push(`az=${az} el=${el}`);
      }
    }
    expect(seen).toEqual([]);
  });
});

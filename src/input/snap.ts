import type { Axis, Dir } from '../game/types';

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera's screen axes in world space. All three are unit vectors. */
export interface Basis {
  readonly right: V3;
  readonly up: V3;
  readonly forward: V3;
}

export type MoveKey = 'left' | 'right' | 'up' | 'down' | 'away' | 'toward';

/** The world axis a vector points along most, with its sign. Ties resolve x before y before z. */
export function snapToAxis(v: V3): Dir {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  let axis: Axis = 0;
  let value = v.x;
  if (ay > ax && ay >= az) {
    axis = 1;
    value = v.y;
  } else if (az > ax && az > ay) {
    axis = 2;
    value = v.z;
  }
  return { axis, sign: value < 0 ? -1 : 1 };
}

export interface ScreenDirs {
  readonly right: Dir;
  readonly up: Dir;
  readonly forward: Dir;
}

const COMPONENTS: readonly (keyof V3)[] = ['x', 'y', 'z'];

/**
 * Assign the three screen axes to three distinct world axes, strongest alignment first.
 * Snapping each vector on its own can give two keys the same world axis when the camera
 * sits near a diagonal; this never does.
 */
export function screenDirs(basis: Basis): ScreenDirs {
  const keys: (keyof Basis)[] = ['right', 'up', 'forward'];
  const freeKeys = new Set(keys);
  const freeAxes = new Set<Axis>([0, 1, 2]);
  const out: Partial<Record<keyof Basis, Dir>> = {};
  while (freeKeys.size > 0) {
    let bestKey: keyof Basis | null = null;
    let bestAxis: Axis = 0;
    let bestMag = -1;
    for (const key of freeKeys) {
      for (const axis of freeAxes) {
        const mag = Math.abs(basis[key][COMPONENTS[axis] as keyof V3]);
        if (mag > bestMag) {
          bestMag = mag;
          bestKey = key;
          bestAxis = axis;
        }
      }
    }
    if (bestKey === null) break;
    const value = basis[bestKey][COMPONENTS[bestAxis] as keyof V3];
    out[bestKey] = { axis: bestAxis, sign: value < 0 ? -1 : 1 };
    freeKeys.delete(bestKey);
    freeAxes.delete(bestAxis);
  }
  return out as ScreenDirs;
}

function opposite(d: Dir): Dir {
  return { axis: d.axis, sign: d.sign === 1 ? -1 : 1 };
}

/** Map a key press to a world direction, relative to how the camera is looking. */
export function keyToDir(key: MoveKey, basis: Basis): Dir {
  const dirs = screenDirs(basis);
  switch (key) {
    case 'left':
      return opposite(dirs.right);
    case 'right':
      return dirs.right;
    case 'up':
      return dirs.up;
    case 'down':
      return opposite(dirs.up);
    case 'away':
      return dirs.forward;
    case 'toward':
      return opposite(dirs.forward);
  }
}

/** Map a swipe (dx right, dy down, in screen pixels) to a world direction. */
export function swipeToDir(dx: number, dy: number, basis: Basis): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return keyToDir(dx >= 0 ? 'right' : 'left', basis);
  return keyToDir(dy < 0 ? 'up' : 'down', basis);
}

/** Camera basis from a forward vector and the world up, so the keyboard stays usable at any orbit angle. */
export function basisFromForward(forward: V3, worldUp: V3 = { x: 0, y: 1, z: 0 }): Basis {
  let right = cross(forward, worldUp);
  if (length(right) < 1e-2) {
    // Looking almost straight up or down: take "right" from the world x axis instead.
    right = { x: 1, y: 0, z: 0 };
  }
  right = normalize(right);
  const up = normalize(cross(right, forward));
  return { right, up, forward: normalize(forward) };
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(v: V3): number {
  return Math.hypot(v.x, v.y, v.z);
}
function normalize(v: V3): V3 {
  const l = length(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

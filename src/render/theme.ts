export type ThemeName = 'light' | 'dark';

export interface TileStyle {
  readonly bg: string;
  readonly fg: string;
}

export interface Theme {
  readonly name: ThemeName;
  /** Scene clear colour. */
  readonly background: string;
  readonly tiles: Readonly<Record<number, TileStyle>>;
  readonly emptyCell: string;
  readonly tileFont: string;
  readonly tileFontWeight: number;
  /** Hairline drawn around each face in the texture, or null. */
  readonly faceBorder: string | null;
  /** Corner radius as a fraction of the tile size. */
  readonly cornerRadius: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number;
  /** Self-illumination by tile value. 0 = none. */
  readonly emissive: (value: number) => number;
  readonly edgeLines: { color: string; opacity: number } | null;
  /** Additive glow for self-lit tiles, or null. See render/glow.ts. */
  readonly glow: { strength: number; threshold: number; softness: number; minValue: number } | null;
  readonly lights: {
    readonly hemiSky: string;
    readonly hemiGround: string;
    readonly hemiIntensity: number;
    readonly keyColor: string;
    readonly keyIntensity: number;
    readonly ambient: number;
    readonly shadows: boolean;
  };
  readonly floor: { kind: 'shadow'; opacity: number; color: string } | { kind: 'grid'; color: string; opacity: number };
  readonly motion: {
    readonly slide: number;
    readonly merge: number;
    readonly spawn: number;
    readonly explode: number;
    readonly camera: number;
    readonly easing: 'out' | 'linear';
    readonly mergeStyle: 'pop' | 'flash';
    readonly mergeScale: number;
    readonly spawnFrom: number;
  };
}

function ladder(entries: [number, string, string][]): Record<number, TileStyle> {
  const out: Record<number, TileStyle> = {};
  for (const [v, bg, fg] of entries) out[v] = { bg, fg };
  return out;
}

export const PAPER: Theme = {
  name: 'light',
  background: '#F3EDE2',
  tiles: ladder([
    [3, '#EFE7D8', '#3B3530'],
    [6, '#E9DCBE', '#3B3530'],
    [12, '#F3C58F', '#4A2E1A'],
    [24, '#F1AC6E', '#4A2E1A'],
    [48, '#EC8E5A', '#3A2112'],
    [96, '#C94A2B', '#FFF6EA'],
    [192, '#EBC86C', '#4A3A0E'],
    [384, '#E2B23E', '#3E2E08'],
    [768, '#CF9227', '#2E2104'],
    [1536, '#A8541A', '#FFF6EA'],
    [3072, '#2E2A26', '#F2C14E'],
  ]),
  emptyCell: '#DED5C3',
  tileFont: "'DM Sans', system-ui, sans-serif",
  tileFontWeight: 700,
  faceBorder: 'rgba(59,53,48,0.10)',
  cornerRadius: 0.13,
  roughness: 0.9,
  metalness: 0,
  opacity: 1,
  emissive: () => 0,
  edgeLines: null,
  glow: null,
  lights: {
    hemiSky: '#FFFBF2',
    hemiGround: '#D9CFBC',
    hemiIntensity: 1.6,
    keyColor: '#FFF1DC',
    keyIntensity: 2.2,
    ambient: 0,
    shadows: true,
  },
  floor: { kind: 'shadow', opacity: 0.18, color: '#3B3530' },
  motion: { slide: 140, merge: 120, spawn: 100, explode: 220, camera: 500, easing: 'out', mergeStyle: 'pop', mergeScale: 1.08, spawnFrom: 0.6 },
};

export const LATTICE: Theme = {
  name: 'dark',
  background: '#070A12',
  tiles: ladder([
    [3, '#1E2A3F', '#B9CCEE'],
    [6, '#243B66', '#C9D8F5'],
    [12, '#1F5C9A', '#EAF3FF'],
    [24, '#0B6E93', '#F0FBFF'],
    [48, '#119FBF', '#04202A'],
    [96, '#22D3EE', '#062A33'],
    [192, '#5B48D9', '#F3F0FF'],
    [384, '#9333EA', '#FBF5FF'],
    [768, '#D946EF', '#2B0A33'],
    [1536, '#F472B6', '#3A0A24'],
    [3072, '#FFD166', '#2B1D00'],
  ]),
  emptyCell: '#121A2A',
  tileFont: "'Orbitron', system-ui, sans-serif",
  tileFontWeight: 700,
  faceBorder: 'rgba(255,255,255,0.16)',
  cornerRadius: 0.06,
  roughness: 0.35,
  metalness: 0,
  opacity: 0.93,
  emissive: (value) => Math.min(0.95, 0.36 + 0.065 * Math.log2(Math.max(1, value / 3))),
  edgeLines: { color: '#FFFFFF', opacity: 0.16 },
  glow: { strength: 0.75, threshold: 0.24, softness: 0.18, minValue: 48 },
  lights: {
    hemiSky: '#2A3B5E',
    hemiGround: '#070A12',
    hemiIntensity: 0.5,
    keyColor: '#BFD9FF',
    keyIntensity: 0.6,
    ambient: 0.25,
    shadows: false,
  },
  floor: { kind: 'grid', color: '#22D3EE', opacity: 0.22 },
  motion: { slide: 90, merge: 80, spawn: 120, explode: 180, camera: 400, easing: 'linear', mergeStyle: 'flash', mergeScale: 1.05, spawnFrom: 0.4 },
};

export const THEMES: Record<ThemeName, Theme> = { light: PAPER, dark: LATTICE };

export function tileStyle(theme: Theme, value: number): TileStyle {
  return theme.tiles[value] ?? theme.tiles[3072] ?? { bg: '#888888', fg: '#000000' };
}

import * as THREE from 'three';
import { tileStyle, type Theme } from './theme';

const SIZE = 256;
const cache = new Map<string, THREE.CanvasTexture>();

/** A square face texture: tile colour, optional hairline border, the value centred. One per theme and value. */
export function tileTexture(theme: Theme, value: number, anisotropy = 1): THREE.CanvasTexture {
  const key = `${theme.name}:${value}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');

  const { bg, fg } = tileStyle(theme, value);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (theme.faceBorder) {
    ctx.strokeStyle = theme.faceBorder;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  }

  const label = String(value);
  let fontSize = label.length <= 1 ? 130 : label.length === 2 ? 118 : label.length === 3 ? 96 : 76;
  ctx.font = `${theme.tileFontWeight} ${fontSize}px ${theme.tileFont}`;
  const maxWidth = SIZE * 0.76;
  const width = ctx.measureText(label).width;
  if (width > maxWidth) {
    fontSize = Math.floor((fontSize * maxWidth) / width);
    ctx.font = `${theme.tileFontWeight} ${fontSize}px ${theme.tileFont}`;
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, SIZE / 2, SIZE / 2 + fontSize * 0.04);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  cache.set(key, texture);
  return texture;
}

/** A fading square grid for the dark floor. */
export function gridTexture(color: string, opacity: number): THREE.CanvasTexture {
  const key = `grid:${color}:${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const step = size / 16;
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Drop every cached texture (used when fonts finish loading after the first draw). */
export function clearTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

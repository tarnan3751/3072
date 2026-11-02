// Frame-cost benchmark for both themes at a Retina-like pixel ratio. Usage: node scripts/bench.mjs
// Headless Chromium renders with SwiftShader (CPU), so absolute numbers are high; compare light vs dark and before vs after.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const port = 4175;
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const url = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
const ladder = [3, 6, 12, 24, 48, 96, 192, 384, 768, 1536, 3072];
const cells = [[0, 0, 2], [1, 0, 2], [2, 0, 2], [0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 1, 2], [1, 1, 2], [2, 1, 2], [0, 2, 2], [1, 2, 1]];
const tiles = ladder.map((value, i) => ({ id: i + 1, value, pos: cells[i] }));
for (let i = 0; i < 16; i++) tiles.push({ id: 30 + i, value: 3 * 2 ** (i % 6), pos: [i % 3, Math.floor(i / 3) % 3, 0] });
const seen = new Set(); const full = [];
for (const t of tiles) { const k = t.pos.join(); if (!seen.has(k)) { seen.add(k); full.push(t); } }
const state = JSON.stringify({ tiles: full, score: 0, moveCount: 0, won: true, over: false, nextId: 99 });

try {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const dpr of [1, 2]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      await page.addInitScript(({ state, theme }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        localStorage.setItem('3072.state', state);
        localStorage.setItem('3072.theme', theme);
      }, { state, theme });
      await page.goto(url);
      await page.waitForFunction(() => Boolean(window.__3072));
      await page.waitForTimeout(500);
      const moving = await page.evaluate(() => window.__3072.view.benchmark(30, { moving: true }));
      const still = await page.evaluate(() => window.__3072.view.benchmark(30, { moving: false }));
      console.log(`dpr ${dpr}  ${theme.padEnd(5)}  tiles moving ${moving.msPerFrame.toFixed(1)} ms   camera only ${still.msPerFrame.toFixed(1)} ms`);
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}

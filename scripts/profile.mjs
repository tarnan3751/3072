// Where does a dark-mode frame spend its time? Toggles one thing at a time and re-measures. Usage: node scripts/profile.mjs
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const port = 4176;
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
for (let i = 0; i < 9; i++) tiles.push({ id: 30 + i, value: 3 * 2 ** (i % 6), pos: [i % 3, Math.floor(i / 3), 0] });
const state = JSON.stringify({ tiles, score: 0, moveCount: 0, won: true, over: false, nextId: 99 });

const experiments = {
  baseline: () => undefined,
  'glow off': () => window.__3072.view.setGlow(false),
  'floor hidden': () => window.__3072.view.scene.traverse((o) => { if (o.isMesh && o.geometry.type === 'PlaneGeometry') o.visible = false; }),
  'edges hidden': () => window.__3072.view.scene.traverse((o) => { if (o.isLineSegments) o.visible = false; }),
  'tiles opaque': () => window.__3072.view.scene.traverse((o) => { if (o.isMesh && o.material.transparent) { o.material.transparent = false; o.material.opacity = 1; o.material.needsUpdate = true; } }),
  'no emissive map': () => window.__3072.view.scene.traverse((o) => { if (o.isMesh && o.material.emissiveMap) { o.material.emissiveMap = null; o.material.needsUpdate = true; } }),
  'everything off': () => { const v = window.__3072.view; v.setGlow(false); v.scene.traverse((o) => { if (o.isMesh && o.geometry.type === 'PlaneGeometry') o.visible = false; if (o.isLineSegments) o.visible = false; if (o.isMesh && o.material.transparent) { o.material.transparent = false; o.material.opacity = 1; o.material.needsUpdate = true; } }); },
};

try {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const theme of ['dark', 'light']) {
    for (const [name, fn] of Object.entries(experiments)) {
      if (theme === 'light' && !['baseline', 'floor hidden', 'everything off'].includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
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
      await page.waitForTimeout(400);
      await page.evaluate(fn);
      const r = await page.evaluate(() => window.__3072.view.benchmark(24, { moving: true }));
      console.log(`${theme.padEnd(5)} ${name.padEnd(16)} ${r.msPerFrame.toFixed(1)} ms`);
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}

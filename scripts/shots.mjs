// Visual QA: screenshots of a seeded high-value board in both themes and both layouts.
// Usage: node scripts/shots.mjs [outDir]   (expects a prior `npm run build`)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] ?? 'test-results/shots';
mkdirSync(out, { recursive: true });
const port = 4174;
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
tiles.push({ id: 20, value: 3, pos: [1, 1, 1] }, { id: 21, value: 6, pos: [2, 2, 0] });
const state = JSON.stringify({ tiles, score: 9999, moveCount: 321, won: true, over: false, nextId: 50 });

const seed = ({ state, theme }) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  localStorage.setItem('3072.state', state);
  localStorage.setItem('3072.theme', theme);
};

try {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.addInitScript(seed, { state, theme });
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__3072));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${theme}-ladder.png` });
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${theme}-exploded.png` });
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${theme}-cube.png`, clip: { x: 150, y: 150, width: 700, height: 600 } });
    await ctx.close();

    const phone = await browser.newContext({ ...devices['Pixel 7'] });
    const ppage = await phone.newPage();
    await ppage.addInitScript(seed, { state, theme });
    await ppage.goto(url);
    await ppage.waitForFunction(() => Boolean(window.__3072));
    await ppage.waitForTimeout(600);
    await ppage.screenshot({ path: `${out}/${theme}-phone.png` });
    await phone.close();
  }
  // A fresh two-tile board in dark mode, for a clean background sample.
  const fresh = JSON.stringify({ tiles: [{ id: 1, value: 3, pos: [0, 0, 2] }, { id: 2, value: 6, pos: [2, 1, 0] }], score: 0, moveCount: 0, won: false, over: false, nextId: 3 });
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const fpage = await fctx.newPage();
  await fpage.addInitScript(seed, { state: fresh, theme: 'dark' });
  await fpage.goto(url);
  await fpage.waitForFunction(() => Boolean(window.__3072));
  await fpage.waitForTimeout(600);
  await fpage.screenshot({ path: `${out}/dark-fresh.png` });
  await fctx.close();
  await browser.close();
  console.log('done', out);
} finally {
  server.kill();
}

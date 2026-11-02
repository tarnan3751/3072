import { expect, test, type Page } from '@playwright/test';

/** The debug handle main.ts exposes. Only the fields the tests read are typed. */
interface Handle {
  game: { tiles: { id: number; value: number; pos: [number, number, number] }[]; score: number; best: number; moveCount: number; won: boolean; over: boolean; canUndo: boolean };
}

const PRESS_ALL = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'KeyW', 'KeyS'];

async function state(page: Page) {
  return page.evaluate(() => {
    const h = (window as unknown as { __3072: Handle }).__3072;
    const g = h.game;
    return { tiles: g.tiles, score: g.score, best: g.best, moveCount: g.moveCount, won: g.won, over: g.over, canUndo: g.canUndo };
  });
}

async function openFresh(page: Page, saved?: Record<string, string>) {
  // Seed storage once per test; reloads within the test must keep what the game saved.
  await page.addInitScript((entries: Record<string, string>) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, saved ?? {});
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { __3072?: unknown }).__3072));
}

/** Press keys until a move is accepted; returns how many presses it took. */
async function makeOneMove(page: Page): Promise<number> {
  const before = (await state(page)).moveCount;
  for (let i = 0; i < PRESS_ALL.length; i++) {
    await page.keyboard.press(PRESS_ALL[i]!);
    if ((await state(page)).moveCount > before) return i + 1;
  }
  throw new Error('No key produced a move');
}

test.describe('3072', () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
  });
  test.afterEach(() => {
    expect(errors, 'no errors in the console').toEqual([]);
  });

  test('loads a fresh game with two tiles, a canvas and the layer readout', async ({ page }) => {
    await openFresh(page);
    const s = await state(page);
    expect(s.tiles).toHaveLength(2);
    expect(s.score).toBe(0);
    await expect(page.locator('canvas.stage-canvas')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('Move 0 · 2 tiles');
    await expect(page.locator('.layer-cell[data-value]')).toHaveCount(2);
    await expect(page.locator('#btn-undo')).toBeDisabled();
    const webgl = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return Boolean(c && (c.getContext('webgl2') || c.getContext('webgl')));
    });
    expect(webgl).toBe(true);
  });

  test('keyboard moves, score, undo and persistence', async ({ page }) => {
    await openFresh(page);
    await makeOneMove(page);
    let s = await state(page);
    expect(s.moveCount).toBe(1);
    expect(s.tiles.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#status')).toContainText('Move 1');
    await expect(page.locator('#btn-undo')).toBeEnabled();

    // Play a while: the board must always stay consistent with the readout.
    for (let i = 0; i < 40; i++) await page.keyboard.press(PRESS_ALL[i % PRESS_ALL.length]!);
    s = await state(page);
    expect(s.moveCount).toBeGreaterThan(5);
    await expect(page.locator('.layer-cell[data-value]')).toHaveCount(s.tiles.length);
    await expect(page.locator('#score')).toHaveText(s.score.toLocaleString('en-US'));
    expect(s.best).toBeGreaterThanOrEqual(s.score);

    // Undo steps back exactly one move.
    const before = s;
    await page.keyboard.press('KeyZ');
    s = await state(page);
    expect(s.moveCount).toBe(before.moveCount - 1);
    await expect(page.locator('.layer-cell[data-value]')).toHaveCount(s.tiles.length);

    // Reload: the same board comes back.
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { __3072?: unknown }).__3072));
    const after = await state(page);
    expect(after.tiles).toEqual(s.tiles);
    expect(after.score).toBe(s.score);
    expect(after.moveCount).toBe(s.moveCount);
  });

  test('new game resets the board and keeps best', async ({ page }) => {
    await openFresh(page);
    for (let i = 0; i < 30; i++) await page.keyboard.press(PRESS_ALL[i % PRESS_ALL.length]!);
    const played = await state(page);
    expect(played.best).toBeGreaterThan(0);
    // Mid-game, both the button and R ask first; "Keep playing" leaves the board alone.
    await page.keyboard.press('KeyR');
    await expect(page.locator('#modal-title')).toHaveText('Start a new game?');
    await page.click('#modal-secondary');
    await expect(page.locator('#modal')).toBeHidden();
    expect((await state(page)).moveCount).toBe(played.moveCount);
    await page.click('#btn-new');
    await expect(page.locator('#modal-title')).toHaveText('Start a new game?');
    await page.click('#modal-primary');
    await expect(page.locator('#modal')).toBeHidden();
    const fresh = await state(page);
    expect(fresh.tiles).toHaveLength(2);
    expect(fresh.score).toBe(0);
    expect(fresh.best).toBe(played.best);
    await expect(page.locator('#best')).toHaveText(played.best.toLocaleString('en-US'));
  });

  test('theme toggle switches light and dark and remembers it', async ({ page }, testInfo) => {
    await openFresh(page, { '3072.theme': 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    for (let i = 0; i < 12; i++) await page.keyboard.press(PRESS_ALL[i % PRESS_ALL.length]!);
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('light.png') });

    await page.click('#btn-theme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#btn-theme')).toHaveAttribute('aria-label', 'Switch to light mode');
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('dark.png') });

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('3072.theme'))).toBe('dark');

    // Switching back works too.
    await page.waitForFunction(() => Boolean((window as unknown as { __3072?: unknown }).__3072));
    await page.click('#btn-theme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('explode view: hold Space, or toggle the button', async ({ page }, testInfo) => {
    await openFresh(page);
    const explode = page.locator('#btn-explode');
    await expect(explode).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.down('Space');
    await expect(explode).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath('exploded.png') });
    await page.keyboard.up('Space');
    await expect(explode).toHaveAttribute('aria-pressed', 'false');
    await explode.click();
    await expect(explode).toHaveAttribute('aria-pressed', 'true');
    await explode.click();
    await expect(explode).toHaveAttribute('aria-pressed', 'false');
  });

  test('reaching 3072 shows the win card once; keep going continues', async ({ page }, testInfo) => {
    const tiles = [
      { id: 1, value: 1536, pos: [0, 0, 0] },
      { id: 2, value: 1536, pos: [2, 0, 0] },
      { id: 3, value: 3, pos: [1, 2, 2] },
    ];
    await openFresh(page, { '3072.state': JSON.stringify({ tiles, score: 10, moveCount: 5, won: false, over: false, nextId: 10 }) });
    await page.keyboard.press('ArrowRight');
    const modal = page.locator('#modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#modal-title')).toHaveText('You made 3072.');
    await page.waitForTimeout(200);
    await page.screenshot({ path: testInfo.outputPath('win.png') });
    const s = await state(page);
    expect(s.won).toBe(true);
    expect(s.tiles.some((t) => t.value === 3072)).toBe(true);
    // Keys are ignored while the card is open.
    await page.keyboard.press('ArrowLeft');
    expect((await state(page)).moveCount).toBe(s.moveCount);
    await page.click('#modal-primary');
    await expect(modal).toBeHidden();
    await makeOneMove(page);
    await expect(modal).toBeHidden();
  });

  test('a dead board shows the game-over card; undo brings it back to life', async ({ page }, testInfo) => {
    // Full board where every neighbour differs, minus (0,0,0). Sliding left then spawning fills it.
    const tiles: { id: number; value: number; pos: number[] }[] = [];
    let id = 1;
    for (let z = 0; z < 3; z++)
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          if (x === 0 && y === 0 && z === 0) continue;
          tiles.push({ id: id++, value: 3 * 2 ** (((x + 2 * y + 4 * z) % 8) + 1), pos: [x, y, z] });
        }
    await openFresh(page, { '3072.state': JSON.stringify({ tiles, score: 0, moveCount: 0, won: false, over: false, nextId: 100 }) });
    // Press until a move is accepted; with 26 tiles and no merges available only x-moves can slide.
    const keys = ['ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'];
    for (const k of keys) {
      await page.keyboard.press(k);
      if ((await state(page)).moveCount > 0) break;
    }
    const s = await state(page);
    expect(s.moveCount).toBe(1);
    if (s.over) {
      const modal = page.locator('#modal');
      await expect(modal).toBeVisible();
      await expect(page.locator('#modal-title')).toHaveText('No moves left.');
      await page.screenshot({ path: testInfo.outputPath('over.png') });
      await page.click('#modal-secondary');
      await expect(modal).toBeHidden();
      expect((await state(page)).over).toBe(false);
    } else {
      // The spawn happened to be a 6 next to a 6, or similar: the board is still alive. That is legal.
      expect(s.tiles.length).toBe(27);
    }
  });

  test('one-finger swipes move tiles on touch screens', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'touch layout only');
    await openFresh(page);
    const before = await state(page);
    const stage = page.locator('#stage');
    const box = (await stage.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Swipe left, right, up, down with synthetic touch pointer events on the stage.
    const swipes = [
      [-120, 0],
      [120, 0],
      [0, -120],
      [0, 120],
    ];
    for (const [dx, dy] of swipes) {
      await page.evaluate(
        ({ x, y, dx, dy }) => {
          const el = document.getElementById('stage')!;
          const opts = { bubbles: true, pointerType: 'touch', pointerId: 7, isPrimary: true } as PointerEventInit;
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x, clientY: y }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x + dx, clientY: y + dy }));
        },
        { x: cx, y: cy, dx: dx!, dy: dy! },
      );
    }
    const after = await state(page);
    expect(after.moveCount).toBeGreaterThan(before.moveCount);
    await expect(page.locator('#btn-away')).toBeVisible();
    await page.click('#btn-away');
    await page.click('#btn-toward');
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath('phone.png'), fullPage: true });
  });

  test('many fast moves stay consistent and quick', async ({ page }) => {
    await openFresh(page);
    const start = Date.now();
    for (let i = 0; i < 120; i++) await page.keyboard.press(PRESS_ALL[(i * 5) % PRESS_ALL.length]!);
    const elapsed = Date.now() - start;
    const s = await state(page);
    await expect(page.locator('.layer-cell[data-value]')).toHaveCount(s.tiles.length);
    const positions = new Set(s.tiles.map((t) => t.pos.join()));
    expect(positions.size).toBe(s.tiles.length);
    // Once the animations settle, the view must hold exactly one mesh per tile: no leaks, no stragglers.
    const meshCount = await page.evaluate(async () => {
      const h = (window as unknown as { __3072: { view: { settled(): Promise<void>; scene: { traverse(cb: (o: { isMesh?: boolean; geometry?: { type: string } }) => void): void } } } }).__3072;
      await h.view.settled();
      let n = 0;
      h.view.scene.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'RoundedBoxGeometry') n++;
      });
      return n;
    });
    expect(meshCount).toBe(s.tiles.length);
    expect(elapsed).toBeLessThan(20_000);
  });
});

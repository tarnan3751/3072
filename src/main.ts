import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';

import { Game } from './game/game';
import type { Dir } from './game/types';
import { attachInput } from './input/input';
import { keyToDir } from './input/snap';
import { CubeView } from './render/scene';
import { THEMES, type ThemeName } from './render/theme';
import { Hud } from './ui/hud';

const THEME_KEY = '3072.theme';

function readTheme(): ThemeName {
  const fromDom = document.documentElement.dataset['theme'];
  if (fromDom === 'light' || fromDom === 'dark') return fromDom;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function loadFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const wanted = ["700 64px 'DM Sans'", "700 64px 'Orbitron'", "700 32px 'Fraunces'", "600 16px 'Space Grotesk'"];
  await Promise.race([Promise.allSettled(wanted.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))]);
}

async function boot(): Promise<void> {
  await loadFonts();

  const stage = document.getElementById('stage');
  if (!stage) throw new Error('Missing #stage');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (navigator.maxTouchPoints > 0) document.documentElement.classList.add('touch');
  let themeName = readTheme();
  const game = new Game();
  const hud = new Hud();
  const view = new CubeView(stage, THEMES[themeName], { reducedMotion });

  let spaceHeld = false;
  let explodeToggled = false;

  const syncHud = () => {
    hud.setScore(game.score, game.best);
    hud.setStatus(game.moveCount, game.tiles.length);
    hud.setLayers(game.tiles, THEMES[themeName]);
    hud.setUndoEnabled(game.canUndo);
  };

  const applyTheme = (name: ThemeName) => {
    themeName = name;
    hud.setTheme(name);
    view.setTheme(THEMES[name]);
    hud.setLayers(game.tiles, THEMES[name]);
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch {
      /* ignore */
    }
  };

  const updateExplode = () => {
    const on = spaceHeld || explodeToggled;
    view.setExploded(on);
    hud.setExplodePressed(on);
  };

  const newGame = () => {
    hud.hideModal();
    game.newGame();
    view.setTiles(game.tiles);
    syncHud();
  };

  /** New game straight away when nothing would be lost; otherwise ask first. */
  const requestNewGame = () => {
    if (hud.modalOpen) return;
    if (game.moveCount === 0 || game.over) {
      newGame();
      return;
    }
    hud.showConfirmNew(newGame, () => hud.hideModal(), game.moveCount, game.score);
  };

  const undo = () => {
    if (!game.undo()) return;
    hud.hideModal();
    view.setTiles(game.tiles);
    syncHud();
  };

  const move = (dir: Dir) => {
    if (hud.modalOpen) return;
    const outcome = game.move(dir);
    if (!outcome) return;
    view.animateMove(outcome);
    hud.setScore(game.score, game.best, outcome.gained);
    hud.setStatus(game.moveCount, game.tiles.length);
    hud.setLayers(game.tiles, THEMES[themeName]);
    hud.setUndoEnabled(true);
    if (outcome.justWon || outcome.over) {
      void view.settled().then(() => {
        if (outcome.justWon) hud.showWin(() => hud.hideModal(), newGame, game.moveCount, game.score);
        else hud.showOver(newGame, game.canUndo ? undo : null, game.moveCount, game.score);
      });
    }
  };

  hud.setTheme(themeName);
  view.setTiles(game.tiles);
  syncHud();
  if (game.over) hud.showOver(newGame, game.canUndo ? undo : null, game.moveCount, game.score);

  hud.on('new', requestNewGame);
  hud.on('undo', undo);
  hud.on('theme', () => applyTheme(themeName === 'light' ? 'dark' : 'light'));
  hud.on('explode', () => {
    explodeToggled = !explodeToggled;
    updateExplode();
  });
  hud.on('recenter', () => view.recenter());
  hud.on('away', () => move(keyToDir('away', view.basis())));
  hud.on('toward', () => move(keyToDir('toward', view.basis())));

  attachInput(stage, () => view.basis(), {
    onMove: move,
    onUndo: undo,
    onNewGame: requestNewGame,
    onExplode: (held) => {
      spaceHeld = held;
      updateExplode();
    },
    onRecenter: () => view.recenter(),
  });

  // A small handle for debugging and end-to-end tests.
  (window as unknown as { __3072: unknown }).__3072 = { game, view, hud, move, applyTheme };
}

void boot();

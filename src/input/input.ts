import type { Dir } from '../game/types';
import { keyToDir, swipeToDir, type Basis, type MoveKey } from './snap';

export interface InputHandlers {
  onMove(dir: Dir): void;
  onUndo(): void;
  onNewGame(): void;
  /** Called with true while Space is held and false on release. */
  onExplode(held: boolean): void;
  onRecenter(): void;
}

const KEY_TO_MOVE: Record<string, MoveKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  w: 'away',
  W: 'away',
  s: 'toward',
  S: 'toward',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isButtonLike(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'A');
}

/**
 * Keyboard on the window, one-finger swipes on the stage. Mouse drags are left to the
 * orbit controls, and two-finger touch gestures are too.
 */
export function attachInput(stage: HTMLElement, basis: () => Basis, handlers: InputHandlers): () => void {
  let spaceHeld = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    const move = KEY_TO_MOVE[e.key];
    if (move) {
      e.preventDefault();
      handlers.onMove(keyToDir(move, basis()));
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      // Let a focused button take its own Space press.
      if (isButtonLike(e.target)) return;
      e.preventDefault();
      if (!e.repeat && !spaceHeld) {
        spaceHeld = true;
        handlers.onExplode(true);
      }
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      handlers.onUndo();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      handlers.onNewGame();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      handlers.onRecenter();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.code === 'Space') {
      if (spaceHeld) {
        spaceHeld = false;
        handlers.onExplode(false);
      }
    }
  };

  const onBlur = () => {
    if (spaceHeld) {
      spaceHeld = false;
      handlers.onExplode(false);
    }
  };

  // Swipes: track touch pointers only; a second finger cancels the swipe (that is an orbit).
  const active = new Map<number, { x: number; y: number; t: number }>();
  let swipeCancelled = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (active.size > 1) swipeCancelled = true;
  };
  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    if (!start) return;
    if (active.size === 0) {
      const cancelled = swipeCancelled;
      swipeCancelled = false;
      if (cancelled || e.type !== 'pointerup') return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dt = performance.now() - start.t;
      const dist = Math.hypot(dx, dy);
      if (dist >= 28 && dt <= 600) handlers.onMove(swipeToDir(dx, dy, basis()));
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  stage.addEventListener('pointerdown', onPointerDown, { capture: true });
  stage.addEventListener('pointerup', onPointerEnd, { capture: true });
  stage.addEventListener('pointercancel', onPointerEnd, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    stage.removeEventListener('pointerdown', onPointerDown, { capture: true });
    stage.removeEventListener('pointerup', onPointerEnd, { capture: true });
    stage.removeEventListener('pointercancel', onPointerEnd, { capture: true });
  };
}

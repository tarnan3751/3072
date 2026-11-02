import { N, type Tile } from '../game/types';
import { tileStyle, type Theme, type ThemeName } from '../render/theme';

export type HudButton = 'new' | 'undo' | 'theme' | 'explode' | 'recenter' | 'away' | 'toward';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export class Hud {
  private readonly score = byId<HTMLElement>('score');
  private readonly best = byId<HTMLElement>('best');
  private readonly status = byId<HTMLElement>('status');
  private readonly layers = byId<HTMLElement>('layers');
  private readonly modal = byId<HTMLElement>('modal');
  private readonly modalTile = byId<HTMLElement>('modal-tile');
  private readonly modalTitle = byId<HTMLElement>('modal-title');
  private readonly modalBody = byId<HTMLElement>('modal-body');
  private readonly modalPrimary = byId<HTMLButtonElement>('modal-primary');
  private readonly modalSecondary = byId<HTMLButtonElement>('modal-secondary');
  private readonly buttons: Record<HudButton, HTMLButtonElement> = {
    new: byId('btn-new'),
    undo: byId('btn-undo'),
    theme: byId('btn-theme'),
    explode: byId('btn-explode'),
    recenter: byId('btn-recenter'),
    away: byId('btn-away'),
    toward: byId('btn-toward'),
  };
  private readonly cells: HTMLElement[] = [];
  private lastScore = 0;
  private modalActions: { primary: () => void; secondary: (() => void) | null } = { primary: () => undefined, secondary: null };

  constructor() {
    this.buildLayers();
    this.modalPrimary.addEventListener('click', () => this.modalActions.primary());
    this.modalSecondary.addEventListener('click', () => this.modalActions.secondary?.());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalOpen) {
        e.preventDefault();
        (this.modalActions.secondary ?? this.modalActions.primary)();
      }
    });
  }

  on(button: HudButton, handler: () => void): void {
    this.buttons[button].addEventListener('click', (e) => {
      handler();
      (e.currentTarget as HTMLButtonElement).blur();
    });
  }

  get modalOpen(): boolean {
    return !this.modal.hidden;
  }

  setScore(score: number, best: number, gained = 0): void {
    this.score.textContent = score.toLocaleString();
    this.best.textContent = best.toLocaleString();
    if (gained > 0 && score !== this.lastScore) {
      const bump = document.createElement('span');
      bump.className = 'score-bump';
      bump.textContent = `+${gained.toLocaleString()}`;
      this.score.parentElement?.appendChild(bump);
      bump.addEventListener('animationend', () => bump.remove());
    }
    this.lastScore = score;
  }

  setStatus(moveCount: number, tileCount: number): void {
    this.status.textContent = `Move ${moveCount.toLocaleString()} · ${tileCount} ${tileCount === 1 ? 'tile' : 'tiles'}`;
  }

  setUndoEnabled(enabled: boolean): void {
    this.buttons.undo.disabled = !enabled;
  }

  setExplodePressed(pressed: boolean): void {
    this.buttons.explode.setAttribute('aria-pressed', String(pressed));
  }

  setTheme(name: ThemeName): void {
    document.documentElement.dataset['theme'] = name;
    const next = name === 'light' ? 'dark' : 'light';
    this.buttons.theme.setAttribute('aria-label', `Switch to ${next} mode`);
    this.buttons.theme.title = `Switch to ${next} mode`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = name === 'light' ? '#F3EDE2' : '#070A12';
  }

  /** Three 3×3 grids, top layer first, each seen from above with the back row at the top. */
  setLayers(tiles: readonly Tile[], theme: Theme): void {
    const byCell = new Map<string, Tile>();
    for (const t of tiles) byCell.set(t.pos.join(','), t);
    let i = 0;
    for (let y = N - 1; y >= 0; y--) {
      for (let z = 0; z < N; z++) {
        for (let x = 0; x < N; x++) {
          const cell = this.cells[i++];
          if (!cell) continue;
          const t = byCell.get(`${x},${y},${z}`);
          if (t) {
            const s = tileStyle(theme, t.value);
            cell.textContent = String(t.value);
            cell.style.background = s.bg;
            cell.style.color = s.fg;
            cell.dataset['value'] = String(t.value);
          } else {
            cell.textContent = '';
            cell.style.background = theme.emptyCell;
            cell.style.color = '';
            delete cell.dataset['value'];
          }
        }
      }
    }
  }

  showWin(onKeepGoing: () => void, onNewGame: () => void, moves: number, score: number): void {
    this.modal.dataset['kind'] = 'win';
    this.modalTile.textContent = '3072';
    this.modalTitle.textContent = 'You made 3072.';
    this.modalBody.textContent = `${moves.toLocaleString()} moves · ${score.toLocaleString()} points. The cube still has room, if you want it.`;
    this.modalPrimary.textContent = 'Keep going';
    this.modalSecondary.textContent = 'New game';
    this.modalSecondary.hidden = false;
    this.modalActions = { primary: onKeepGoing, secondary: onNewGame };
    this.openModal();
  }

  showOver(onNewGame: () => void, onUndo: (() => void) | null, moves: number, score: number): void {
    this.modal.dataset['kind'] = 'over';
    this.modalTile.textContent = '×';
    this.modalTitle.textContent = 'No moves left.';
    this.modalBody.textContent = `${moves.toLocaleString()} moves · ${score.toLocaleString()} points. Every cell is full and nothing touches its twin.`;
    this.modalPrimary.textContent = 'New game';
    this.modalSecondary.textContent = 'Undo last move';
    this.modalSecondary.hidden = onUndo === null;
    this.modalActions = { primary: onNewGame, secondary: onUndo };
    this.openModal();
  }

  showConfirmNew(onConfirm: () => void, onCancel: () => void, moves: number, score: number): void {
    this.modal.dataset['kind'] = 'confirm';
    this.modalTile.textContent = '?';
    this.modalTitle.textContent = 'Start a new game?';
    this.modalBody.textContent = `This game has ${moves.toLocaleString()} ${moves === 1 ? 'move' : 'moves'} and ${score.toLocaleString()} points. It will be cleared.`;
    this.modalPrimary.textContent = 'New game';
    this.modalSecondary.textContent = 'Keep playing';
    this.modalSecondary.hidden = false;
    this.modalActions = { primary: onConfirm, secondary: onCancel };
    this.openModal();
  }

  hideModal(): void {
    this.modal.hidden = true;
  }

  private openModal(): void {
    this.modal.hidden = false;
    this.modalPrimary.focus();
  }

  private buildLayers(): void {
    this.layers.replaceChildren();
    const names = ['Top', 'Middle', 'Bottom'];
    for (let layer = 0; layer < N; layer++) {
      const wrap = document.createElement('div');
      wrap.className = 'layer';
      const grid = document.createElement('div');
      grid.className = 'layer-grid';
      grid.setAttribute('role', 'img');
      grid.setAttribute('aria-label', `${names[layer]} layer`);
      for (let i = 0; i < N * N; i++) {
        const cell = document.createElement('div');
        cell.className = 'layer-cell';
        grid.appendChild(cell);
        this.cells.push(cell);
      }
      const label = document.createElement('span');
      label.className = 'layer-label';
      label.textContent = names[layer] ?? '';
      wrap.append(grid, label);
      this.layers.appendChild(wrap);
    }
  }
}

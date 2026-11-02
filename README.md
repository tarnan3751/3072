# 3072

2048, cubed. Slide tiles through a 3×3×3 cube in six directions, merge equal neighbours, reach 3072.

Two looks, toggled from the top bar: **Paper** (light) and **Lattice** (dark).

## Run

```sh
npm install
npm run dev
```

## Play

| Keys | Action |
| --- | --- |
| Arrows | Slide across the screen |
| W / S | Push away / pull toward you |
| Space (hold) | Explode the layers to see inside |
| Drag | Orbit the cube |
| Z / R | Undo / new game |

On touch screens: swipe to slide, two fingers to orbit, buttons for away and toward.

## Check

```sh
npm test        # game core and input mapping
npm run e2e     # browser tests (first: npx playwright install chromium)
npm run bench   # frame cost per theme
```

TypeScript, Three.js, Vite. Game logic in `src/game`, rendering in `src/render`, input in `src/input`, HUD in `src/ui`.

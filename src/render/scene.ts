import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { MoveOutcome } from '../game/game';
import { N, type Pos, type Tile } from '../game/types';
import type { Basis } from '../input/snap';
import { basisFromForward } from '../input/snap';
import { Glow, GLOW_LAYER } from './glow';
import { gridTexture, tileTexture } from './textures';
import { easeInOutCubic, easeOutCubic, linear, Tweens } from './tween';
import type { Theme } from './theme';

/** Distance between cell centres. Tiles are 1 unit wide, so the gap is PITCH - 1. */
const PITCH = 1.24;
const EXPLODE_FACTOR = 1.8;
/** How much the field of view widens at full explode, so the spread layers stay in frame. */
const EXPLODE_ZOOM = 0.22;
const HOME = { radius: 12, polar: 1.15, azimuth: 0.62 };

interface TileNode {
  readonly id: number;
  value: number;
  /** Logical cell. During a slide this is the destination. */
  pos: Pos;
  /** Where the mesh sits in cell units, animated; equals pos when idle. */
  anim: [number, number, number];
  readonly mesh: THREE.Mesh;
  edges: THREE.LineSegments | null;
}

export interface CubeViewOptions {
  reducedMotion?: boolean;
}

export class CubeView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private theme: Theme;
  private readonly container: HTMLElement;
  private readonly root = new THREE.Group();
  private readonly tiles = new Map<number, TileNode>();
  private readonly tweens = new Tweens();
  private readonly lights = new THREE.Group();
  private floor: THREE.Mesh | null = null;
  private glow: Glow | null = null;
  private glowEnabled = true;
  private shadowDirty = true;
  private readonly frameGaps: number[] = [];
  private lastFrameAt = 0;
  private geometry: RoundedBoxGeometry;
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.16, color: 0xffffff });
  private readonly edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, 1.0, 1.0));
  private explode = 1;
  private explodeTarget = 1;
  private frame = 0;
  private dirty = true;
  private resizeObserver: ResizeObserver | null = null;
  private readonly reducedMotion: boolean;
  private disposed = false;

  constructor(container: HTMLElement, theme: Theme, opts: CubeViewOptions = {}) {
    this.container = container;
    this.theme = theme;
    this.reducedMotion = opts.reducedMotion ?? false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The light never moves, so the shadow map only needs redrawing when tiles do.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.classList.add('stage-canvas');
    this.renderer.domElement.setAttribute('aria-label', 'The 3072 cube');
    this.renderer.domElement.setAttribute('role', 'img');
    container.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.placeCameraHome();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.6;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 18;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.5;
    // One finger is a swipe (a move). Two fingers orbit and zoom.
    this.controls.touches.ONE = null;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => this.invalidate());

    this.scene.add(this.root);
    this.scene.add(this.lights);
    this.geometry = new RoundedBoxGeometry(1, 1, 1, 4, theme.cornerRadius);
    this.applyTheme(theme);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---- public API -------------------------------------------------------

  setTheme(theme: Theme): void {
    if (theme.name === this.theme.name) return;
    this.theme = theme;
    this.geometry.dispose();
    this.geometry = new RoundedBoxGeometry(1, 1, 1, 4, theme.cornerRadius);
    for (const node of this.tiles.values()) {
      node.mesh.geometry = this.geometry;
      node.mesh.material = this.material(node.value);
      this.applyEdges(node);
    }
    this.applyTheme(theme);
    this.invalidate();
  }

  /** Put the board in this exact state with no animation (new game, undo, restore). */
  setTiles(tiles: readonly Tile[]): void {
    this.tweens.finishAll();
    const keep = new Set<number>();
    for (const t of tiles) {
      keep.add(t.id);
      const node = this.tiles.get(t.id);
      if (node) {
        node.value = t.value;
        node.pos = t.pos;
        node.anim = [t.pos[0], t.pos[1], t.pos[2]];
        node.mesh.material = this.material(t.value);
        node.mesh.scale.setScalar(1);
      } else {
        this.addTile(t, 1);
      }
    }
    for (const id of [...this.tiles.keys()]) if (!keep.has(id)) this.removeTile(id);
    this.layout();
    this.invalidate();
  }

  /** Animate a move: slide, then merge pops and the spawn. Any animation still running is completed first. */
  animateMove(outcome: MoveOutcome): void {
    this.tweens.finishAll();
    const m = this.theme.motion;
    const slide = this.reducedMotion ? 0 : m.slide;
    const ease = m.easing === 'linear' ? linear : easeOutCubic;

    for (const mv of outcome.moves) {
      const node = this.tiles.get(mv.id);
      if (!node) continue;
      const from: [number, number, number] = [...node.anim];
      const to = mv.to;
      node.pos = to;
      const mergedInto = mv.mergedInto;
      this.tweens.add(
        slide,
        (t) => {
          node.anim = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
          this.place(node);
        },
        {
          ease,
          onDone: () => {
            if (mergedInto !== undefined) this.removeTile(mv.id);
          },
        },
      );
    }

    for (const merge of outcome.merges) {
      const node = this.tiles.get(merge.id);
      if (!node) continue;
      const mergeMs = this.reducedMotion ? 0 : m.merge;
      this.tweens.add(0, () => undefined, {
        delay: slide,
        onDone: () => {
          node.value = merge.value;
          if (m.mergeStyle === 'flash' && mergeMs > 0) {
            node.mesh.material = this.flashMaterial;
            this.tweens.add(mergeMs * 0.5, () => undefined, {
              onDone: () => {
                node.mesh.material = this.material(merge.value);
              },
            });
          } else {
            node.mesh.material = this.material(merge.value);
          }
          const peak = m.mergeScale;
          this.tweens.add(
            mergeMs,
            (t) => {
              const s = t < 0.5 ? 1 + (peak - 1) * (t / 0.5) : peak - (peak - 1) * ((t - 0.5) / 0.5);
              node.mesh.scale.setScalar(s);
            },
            { ease: linear, onDone: () => node.mesh.scale.setScalar(1) },
          );
        },
      });
    }

    const spawnMs = this.reducedMotion ? 0 : m.spawn;
    this.tweens.add(0, () => undefined, {
      delay: slide,
      onDone: () => {
        const node = this.addTile(outcome.spawned, spawnMs > 0 ? m.spawnFrom : 1);
        this.tweens.add(
          spawnMs,
          (t) => node.mesh.scale.setScalar(m.spawnFrom + (1 - m.spawnFrom) * t),
          { ease: easeOutCubic, onDone: () => node.mesh.scale.setScalar(1) },
        );
      },
    });

    this.invalidate();
  }

  setExploded(on: boolean): void {
    const target = on ? EXPLODE_FACTOR : 1;
    if (target === this.explodeTarget) return;
    this.explodeTarget = target;
    const from = this.explode;
    const ms = this.reducedMotion ? 0 : this.theme.motion.explode;
    this.tweens.add(ms, (t) => {
      this.explode = from + (target - from) * t;
      this.layout();
      this.applyFov();
    });
    this.invalidate();
  }

  get exploded(): boolean {
    return this.explodeTarget !== 1;
  }

  recenter(): void {
    const from = this.camera.position.clone();
    const to = this.homePosition();
    const ms = this.reducedMotion ? 0 : this.theme.motion.camera;
    this.tweens.add(
      ms,
      (t) => {
        this.camera.position.lerpVectors(from, to, t);
        this.camera.lookAt(this.controls.target);
      },
      { ease: easeInOutCubic, onDone: () => this.controls.update() },
    );
    this.invalidate();
  }

  /** Screen axes in world space for the current camera, used to map keys and swipes. */
  basis(): Basis {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    return basisFromForward({ x: f.x, y: f.y, z: f.z });
  }

  /** Wait for every running animation to complete (tests and modals use this). */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.tweens.active || this.disposed) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  /** Render `frames` frames back to back and report the average cost. Debug and benchmark use only. */
  benchmark(frames = 60, opts: { moving?: boolean } = {}): { msPerFrame: number } {
    const gl = this.renderer.getContext();
    const moving = opts.moving ?? true;
    const sync = () => {
      gl.finish();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    };
    this.render();
    sync();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (moving) this.shadowDirty = true;
      this.render();
    }
    sync();
    return { msPerFrame: (performance.now() - t0) / frames };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    for (const id of [...this.tiles.keys()]) this.removeTile(id);
    for (const m of this.materials.values()) m.dispose();
    this.geometry.dispose();
    this.edgeGeometry.dispose();
    this.glow?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---- internals --------------------------------------------------------

  private homePosition(): THREE.Vector3 {
    const s = new THREE.Spherical(HOME.radius, HOME.polar, HOME.azimuth);
    return new THREE.Vector3().setFromSpherical(s);
  }

  private placeCameraHome(): void {
    this.camera.position.copy(this.homePosition());
    this.camera.lookAt(0, 0, 0);
  }

  private material(value: number): THREE.MeshStandardMaterial {
    const theme = this.theme;
    const key = `${theme.name}:${value}`;
    const hit = this.materials.get(key);
    if (hit) return hit;
    const map = tileTexture(theme, value, Math.min(4, this.renderer.capabilities.getMaxAnisotropy()));
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: theme.roughness,
      metalness: theme.metalness,
      transparent: theme.opacity < 1,
      opacity: theme.opacity,
    });
    const e = theme.emissive(value);
    if (e > 0) {
      // Self-lit by its own colours. Reusing the texel the map fetch already produced is far cheaper
      // than a second anisotropic fetch through emissiveMap.
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = e;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
      };
      mat.customProgramCacheKey = () => 'tile-self-lit';
    }
    this.materials.set(key, mat);
    return mat;
  }

  private addTile(tile: Tile, scale: number): TileNode {
    const mesh = new THREE.Mesh(this.geometry, this.material(tile.value));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(GLOW_LAYER);
    mesh.scale.setScalar(scale);
    const node: TileNode = { id: tile.id, value: tile.value, pos: tile.pos, anim: [tile.pos[0], tile.pos[1], tile.pos[2]], mesh, edges: null };
    this.applyEdges(node);
    this.tiles.set(tile.id, node);
    this.root.add(mesh);
    this.place(node);
    return node;
  }

  private applyEdges(node: TileNode): void {
    if (this.theme.edgeLines) {
      if (!node.edges) {
        node.edges = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
        node.mesh.add(node.edges);
      }
      this.edgeMaterial.color.set(this.theme.edgeLines.color);
      this.edgeMaterial.opacity = this.theme.edgeLines.opacity;
    } else if (node.edges) {
      node.mesh.remove(node.edges);
      node.edges = null;
    }
  }

  private removeTile(id: number): void {
    const node = this.tiles.get(id);
    if (!node) return;
    this.root.remove(node.mesh);
    this.tiles.delete(id);
  }

  private place(node: TileNode): void {
    const [x, y, z] = node.anim;
    node.mesh.position.set((x - (N - 1) / 2) * PITCH, (y - (N - 1) / 2) * PITCH * this.explode, (z - (N - 1) / 2) * PITCH);
    this.dirty = true;
    this.shadowDirty = true;
  }

  private layout(): void {
    for (const node of this.tiles.values()) this.place(node);
  }

  private applyTheme(theme: Theme): void {
    this.scene.background = new THREE.Color(theme.background);
    this.renderer.shadowMap.enabled = theme.lights.shadows;

    this.lights.clear();
    const hemi = new THREE.HemisphereLight(new THREE.Color(theme.lights.hemiSky), new THREE.Color(theme.lights.hemiGround), theme.lights.hemiIntensity);
    this.lights.add(hemi);
    const key = new THREE.DirectionalLight(new THREE.Color(theme.lights.keyColor), theme.lights.keyIntensity);
    key.position.set(5, 9, 6);
    key.castShadow = theme.lights.shadows;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.lights.add(key);
    if (theme.lights.ambient > 0) this.lights.add(new THREE.AmbientLight(0xffffff, theme.lights.ambient));

    if (this.floor) {
      this.scene.remove(this.floor);
      (this.floor.material as THREE.Material).dispose();
      this.floor.geometry.dispose();
      this.floor = null;
    }
    const floorY = -((N - 1) / 2) * PITCH - 0.5 - 0.35;
    if (theme.floor.kind === 'shadow') {
      const mat = new THREE.ShadowMaterial({ color: new THREE.Color(theme.floor.color), opacity: theme.floor.opacity });
      // Just big enough for the shadows, shifted toward where the key light throws them;
      // every extra pixel of this plane samples the shadow map.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(-1.2, floorY, -1.5);
      mesh.receiveShadow = true;
      this.floor = mesh;
    } else {
      const mat = new THREE.MeshBasicMaterial({ map: gridTexture(theme.floor.color, 1), transparent: true, opacity: theme.floor.opacity, depthWrite: false });
      // The grid fades to nothing at the inscribed circle, so a disc skips drawing invisible corners.
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(7.5, 48), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = floorY;
      this.floor = mesh;
    }
    this.scene.add(this.floor);

    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    for (const node of this.tiles.values()) node.mesh.material = this.material(node.value);

    this.shadowDirty = true;
    this.setupGlow();
  }

  private setupGlow(): void {
    this.glow?.dispose();
    this.glow = null;
    this.frameGaps.length = 0;
    const settings = this.theme.glow;
    if (!settings) return;
    this.glow = new Glow(settings);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.glow.setSize(size.x, size.y);
  }

  /** Turn the dark-mode glow on or off. Tiles stay self-lit either way. */
  setGlow(enabled: boolean): void {
    if (this.glowEnabled === enabled) return;
    this.glowEnabled = enabled;
    this.invalidate();
  }

  get glowActive(): boolean {
    return this.glowEnabled && this.glow !== null;
  }

  private baseFov = 32;

  private applyFov(): void {
    const spread = (this.explode - 1) / (EXPLODE_FACTOR - 1);
    this.camera.fov = this.baseFov * (1 + EXPLODE_ZOOM * spread);
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole cube in view on narrow screens by widening the field of view.
    this.baseFov = w < h ? 46 : 32;
    this.applyFov();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.glow?.setSize(size.x, size.y);
    this.invalidate();
  }

  private invalidate(): void {
    this.dirty = true;
    if (this.frame === 0 && !this.disposed) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (this.disposed) return;
    const animating = this.tweens.update(now);
    const orbiting = this.controls.update();
    if (animating) this.shadowDirty = true;
    if (this.dirty || animating || orbiting) {
      this.dirty = false;
      this.render();
      this.watchFrameRate(now, animating || orbiting);
    }
    if (this.tweens.active || orbiting) this.frame = requestAnimationFrame(this.tick);
  };

  /**
   * If frames keep arriving slowly while the glow is on, switch it off: the tiles stay
   * self-lit, so the theme survives on weak GPUs.
   */
  private watchFrameRate(now: number, continuous: boolean): void {
    if (!this.glowActive) return;
    const gap = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (!continuous || gap > 250) {
      this.frameGaps.length = 0;
      return;
    }
    this.frameGaps.push(gap);
    if (this.frameGaps.length < 45) return;
    const sorted = [...this.frameGaps].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    this.frameGaps.length = 0;
    if (median > 28) {
      this.glowEnabled = false;
      console.info('3072: frame rate is low, glow switched off');
    }
  }

  private render(): void {
    if (this.renderer.shadowMap.enabled && this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.glow && this.glowEnabled && this.anyTileGlows()) {
      this.glow.render(this.renderer, this.scene, this.camera, this.glowBounds());
    }
  }

  private anyTileGlows(): boolean {
    const min = this.theme.glow?.minValue ?? 0;
    for (const node of this.tiles.values()) if (node.value >= min) return true;
    return false;
  }

  private readonly boundsBox = new THREE.Box3();
  private readonly boundsCorner = new THREE.Vector3();
  private readonly boundsRect = new THREE.Box2();
  private readonly bufferSize = new THREE.Vector2();

  /** Screen rectangle (device pixels, bottom-left origin) around the tiles, padded for the halo. */
  private glowBounds(): THREE.Box2 {
    this.boundsBox.makeEmpty();
    for (const node of this.tiles.values()) this.boundsBox.expandByPoint(node.mesh.position);
    // Tiles are 1 unit wide; add half a diagonal so the box covers their corners.
    this.boundsBox.expandByScalar(0.87);
    const size = this.renderer.getDrawingBufferSize(this.bufferSize);
    const rect = this.boundsRect.makeEmpty();
    for (let i = 0; i < 8; i++) {
      this.boundsCorner.set(i & 1 ? this.boundsBox.max.x : this.boundsBox.min.x, i & 2 ? this.boundsBox.max.y : this.boundsBox.min.y, i & 4 ? this.boundsBox.max.z : this.boundsBox.min.z);
      this.boundsCorner.project(this.camera);
      rect.expandByPoint(new THREE.Vector2(((this.boundsCorner.x + 1) / 2) * size.x, ((this.boundsCorner.y + 1) / 2) * size.y));
    }
    const pad = Math.max(size.x, size.y) * 0.08;
    rect.min.x = Math.max(0, Math.floor(rect.min.x - pad));
    rect.min.y = Math.max(0, Math.floor(rect.min.y - pad));
    rect.max.x = Math.min(size.x, Math.ceil(rect.max.x + pad));
    rect.max.y = Math.min(size.y, Math.ceil(rect.max.y + pad));
    return rect;
  }
}

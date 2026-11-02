import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface GlowSettings {
  /** Multiplier on the blurred light before it is added to the frame. */
  readonly strength: number;
  /** Linear luminance below which a pixel contributes no glow. */
  readonly threshold: number;
  /** Width of the soft knee around the threshold. */
  readonly softness: number;
}

/** Objects on this layer are the light sources for the glow. */
export const GLOW_LAYER = 1;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const THRESHOLD_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float threshold;
uniform float softness;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(threshold - softness, threshold + softness, lum);
  gl_FragColor = vec4(c * w, 1.0);
}`;

/** 9-tap Gaussian using 5 bilinear fetches. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tSrc, vUv).rgb * 0.2270270270;
  sum += texture2D(tSrc, vUv + step * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSrc, vUv - step * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSrc, vUv + step * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tSrc, vUv - step * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tGlow;
uniform float strength;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * strength, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * A cheap glow for self-lit objects.
 *
 * After the frame is drawn normally, the objects on GLOW_LAYER are drawn again, unlit, into a
 * quarter-resolution buffer (so only their emissive light shows). That buffer is thresholded into an
 * eighth-resolution buffer, blurred twice, and added over the frame. Everything but the final add
 * happens on tiny buffers, and the main frame keeps the canvas's own antialiasing.
 */
export class Glow {
  private readonly source: THREE.WebGLRenderTarget;
  private readonly ping: THREE.WebGLRenderTarget;
  private readonly pong: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly thresholdMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();

  constructor(settings: GlowSettings) {
    const opts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.source = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true });
    this.ping = new THREE.WebGLRenderTarget(1, 1, opts);
    this.pong = new THREE.WebGLRenderTarget(1, 1, opts);
    this.thresholdMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: THRESHOLD_FRAG,
      uniforms: { tSrc: { value: null }, threshold: { value: settings.threshold }, softness: { value: settings.softness } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tSrc: { value: null }, step: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { tGlow: { value: null }, strength: { value: settings.strength } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** `width`/`height` in device pixels (the drawing buffer size). */
  setSize(width: number, height: number): void {
    const sw = Math.max(32, Math.round(width / 4));
    const sh = Math.max(32, Math.round(height / 4));
    const bw = Math.max(16, Math.round(width / 8));
    const bh = Math.max(16, Math.round(height / 8));
    this.source.setSize(sw, sh);
    this.ping.setSize(bw, bh);
    this.pong.setSize(bw, bh);
  }

  /**
   * Call after the frame has been rendered to the canvas. `bounds`, if given, is the screen
   * rectangle (device pixels, origin bottom-left) the glow can reach; pixels outside it are skipped.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bounds?: THREE.Box2): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevBackground = scene.background;
    const prevMask = camera.layers.mask;
    renderer.getClearColor(this.clearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    // 1. Light sources only, unlit (lights live on layer 0), at quarter resolution.
    scene.background = null;
    camera.layers.set(GLOW_LAYER);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    renderer.setRenderTarget(this.source);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    scene.background = prevBackground;

    // 2. Threshold into the eighth-resolution buffer.
    this.thresholdMat.uniforms['tSrc']!.value = this.source.texture;
    this.quad.material = this.thresholdMat;
    renderer.setRenderTarget(this.ping);
    this.quad.render(renderer);

    // 3. Two separable blurs, the second with a wider step for a soft halo.
    const tx = 1 / this.ping.width;
    const ty = 1 / this.ping.height;
    this.quad.material = this.blurMat;
    for (const scale of [1, 2.5]) {
      this.blurPass(renderer, this.ping, this.pong, tx * scale, 0);
      this.blurPass(renderer, this.pong, this.ping, 0, ty * scale);
    }

    // 4. Add over the frame, touching only the pixels the glow can reach.
    this.compositeMat.uniforms['tGlow']!.value = this.ping.texture;
    this.quad.material = this.compositeMat;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    if (bounds) {
      renderer.setScissor(bounds.min.x, bounds.min.y, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
      renderer.setScissorTest(true);
    }
    this.quad.render(renderer);
    if (bounds) renderer.setScissorTest(false);

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this.clearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  private blurPass(renderer: THREE.WebGLRenderer, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, sx: number, sy: number): void {
    this.blurMat.uniforms['tSrc']!.value = from.texture;
    (this.blurMat.uniforms['step']!.value as THREE.Vector2).set(sx, sy);
    renderer.setRenderTarget(to);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.source.dispose();
    this.ping.dispose();
    this.pong.dispose();
    this.thresholdMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
    this.quad.dispose();
  }
}

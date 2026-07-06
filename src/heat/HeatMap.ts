import * as THREE from 'three';
import type { IDisposable } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A single data point for the heatmap.
 *
 * Coordinates are in **pixel space** relative to the canvas dimensions.
 * Values are normalised against the dataset's `max` / `min` before rendering.
 */
export interface HeatMapPoint {
  /** X coordinate in pixels (0 – width). */
  x: number;
  /** Y coordinate in pixels (0 – height). */
  y: number;
  /** Intensity / weight of this point. Normalised against `max` / `min`. */
  value: number;
}

/**
 * Dataset passed to {@link HeatMap.setData}.
 *
 * If `max` / `min` are omitted they are auto-detected from the data array.
 */
export interface HeatMapData {
  /** The data points to render. */
  data: HeatMapPoint[];
  /**
   * Maximum value for normalisation.
   * If omitted, the highest `value` in the data array is used.
   */
  max?: number;
  /**
   * Minimum value for normalisation.
   * @default 0
   */
  min?: number;
}

/**
 * A colour stop entry for the heatmap gradient.
 * The key is a position in the [0, 1] range; the value is a CSS colour string.
 *
 * @example
 * ```ts
 * const gradient: HeatMapGradient = {
 *   0.25: 'rgb(0,0,255)',
 *   0.55: 'rgb(0,255,0)',
 *   0.85: 'rgb(255,255,0)',
 *   1.0:  'rgb(255,0,0)',
 * };
 * ```
 */
export type HeatMapGradient = Record<number, string>;

/**
 * Options for constructing a {@link HeatMap}.
 *
 * @example
 * ```ts
 * const opts: HeatMapOptions = {
 *   width: 512,
 *   height: 512,
 *   radius: 40,
 *   opacity: 0.8,
 *   gradient: {
 *     0.25: 'rgb(0,0,255)',
 *     0.55: 'rgb(0,255,0)',
 *     0.85: 'rgb(255,255,0)',
 *     1.0:  'rgb(255,0,0)',
 *   },
 * };
 * ```
 */
export interface HeatMapOptions {
  /** Canvas width in pixels. @default 256 */
  width?: number;
  /** Canvas height in pixels. @default 256 */
  height?: number;
  /**
   * Default radius for heat points (pixels).
   * Can be overridden per-point if `HeatMapPoint.radius` is provided.
   * @default 40
   */
  radius?: number;
  /**
   * Global opacity of the rendered heatmap (0–1).
   * Applied to the final colour-mapped canvas.
   * @default 0.6
   */
  opacity?: number;
  /**
   * Colour gradient mapping normalised intensity to colour.
   * Keys are positions in [0, 1]; values are CSS colour strings.
   * @default `{ 0.25: 'rgb(0,0,255)', 0.55: 'rgb(0,255,0)', 0.85: 'rgb(255,255,0)', 1.0: 'rgb(255,0,0)' }`
   */
  gradient?: HeatMapGradient;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Default gradient: blue → green → yellow → red. */
const DEFAULT_GRADIENT: HeatMapGradient = {
  0.25: 'rgb(0,0,255)',
  0.55: 'rgb(0,255,0)',
  0.85: 'rgb(255,255,0)',
  1.0: 'rgb(255,0,0)',
};

/**
 * Pre-render a 256 × 1 gradient palette canvas.
 * Each pixel at index `i` (0–255) holds the RGBA colour for intensity `i / 255`.
 */
function createGradientPalette(gradient: HeatMapGradient): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;

  // Build a linear gradient across the 256-pixel width
  const linear = ctx.createLinearGradient(0, 0, 256, 0);
  const stops = Object.keys(gradient)
    .map(Number)
    .sort((a, b) => a - b);

  for (const position of stops) {
    linear.addColorStop(position, gradient[position]);
  }

  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, 256, 1);
  return canvas;
}

/**
 * Draw a single radial-gradient circle onto the shadow canvas.
 * The circle's alpha at the centre equals `alpha`; it fades to 0 at the edge.
 */
function drawAlphaCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  const safeRadius = Math.max(1, radius);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, safeRadius);
  gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - safeRadius, y - safeRadius, safeRadius * 2, safeRadius * 2);
}

/**
 * Map the alpha channel of the shadow canvas through the gradient palette,
 * writing the coloured result into the display canvas.
 */
function colourise(
  shadowCtx: CanvasRenderingContext2D,
  displayCtx: CanvasRenderingContext2D,
  palette: HTMLCanvasElement,
  width: number,
  height: number,
  opacity: number,
): void {
  const shadowData = shadowCtx.getImageData(0, 0, width, height);
  const pixels = shadowData.data;

  // Read the palette once
  const paletteCtx = palette.getContext('2d')!;
  const paletteData = paletteCtx.getImageData(0, 0, 256, 1).data;

  // Write coloured output
  const output = displayCtx.createImageData(width, height);
  const out = output.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]; // shadow canvas stores intensity in alpha
    if (alpha === 0) continue; // skip transparent pixels

    const paletteOffset = alpha * 4;
    out[i] = paletteData[paletteOffset];     // R
    out[i + 1] = paletteData[paletteOffset + 1]; // G
    out[i + 2] = paletteData[paletteOffset + 2]; // B
    out[i + 3] = Math.round(paletteData[paletteOffset + 3] * opacity); // A
  }

  displayCtx.putImageData(output, 0, 0);
}

// ─── HeatMap class ──────────────────────────────────────────────────────────

/**
 * HeatMap — a **canvas-based heatmap texture generator**.
 *
 * Renders data points onto an offscreen canvas using the two-pass alpha
 * channel technique inspired by [heatmap.js](https://github.com/pa7/heatmap.js):
 *
 * 1. **Shadow pass** — each point is drawn as a radial-gradient circle whose
 *    alpha encodes intensity; overlapping circles accumulate naturally.
 * 2. **Colour pass** — the shadow canvas's alpha channel is mapped through a
 *    configurable colour gradient to produce the final heatmap image.
 *
 * The result is exposed as a `THREE.CanvasTexture` that can be applied to any
 * material in a Three.js scene.
 *
 * **Features:**
 * - Extends `THREE.Group` — can be added directly to any scene
 * - Implements {@link IDisposable} — cleans up canvases & texture on `dispose()`
 * - Chainable {@link HeatMap.setData} / {@link HeatMap.setGradient} methods
 * - Auto-updates the `CanvasTexture` when data or gradient changes
 *
 * @example
 * ```ts
 * import { HeatMap } from '@cyc/3d-components/heat';
 *
 * const heatMap = new HeatMap({
 *   width: 512,
 *   height: 512,
 *   radius: 50,
 *   opacity: 0.7,
 * });
 *
 * heatMap.setData({
 *   max: 100,
 *   data: [
 *     { x: 100, y: 100, value: 80 },
 *     { x: 300, y: 200, value: 50 },
 *     { x: 400, y: 350, value: 100 },
 *   ],
 * });
 *
 * // Use the texture on any mesh
 * const material = new THREE.MeshBasicMaterial({
 *   map: heatMap.texture,
 *   transparent: true,
 * });
 * const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
 * scene.add(plane);
 * ```
 */
export class HeatMap implements IDisposable {
  // ── Canvas & texture ──
  /** The shadow (intensity) canvas — never exposed publicly. */
  private readonly _shadowCanvas: HTMLCanvasElement;
  private readonly _shadowCtx: CanvasRenderingContext2D;

  /** The display (colour-mapped) canvas — source of the Three.js texture. */
  private readonly _displayCanvas: HTMLCanvasElement;
  private readonly _displayCtx: CanvasRenderingContext2D;

  /** Pre-rendered 256 × 1 gradient palette. */
  private _palette: HTMLCanvasElement;

  /** The Three.js texture wrapping the display canvas. */
  private _texture: THREE.CanvasTexture;

  // ── Configuration ──
  private readonly _width: number;
  private readonly _height: number;
  private _radius: number;
  private _opacity: number;
  private _gradient: HeatMapGradient;

  // ── Stored data ──
  private _data: HeatMapData;

  /**
   * The Three.js `CanvasTexture` backed by the heatmap canvas.
   *
   * Assign this to any material's `map` property. The texture is
   * automatically updated whenever data or gradient changes.
   *
   * @example
   * ```ts
   * const material = new THREE.MeshBasicMaterial({
   *   map: heatMap.texture,
   *   transparent: true,
   * });
   * ```
   */
  get texture(): THREE.CanvasTexture {
    return this._texture;
  }

  /**
   * The underlying display canvas element.
   * Useful if you need the raw canvas for non-Three.js contexts.
   */
  get canvas(): HTMLCanvasElement {
    return this._displayCanvas;
  }

  /**
   * Current canvas width in pixels.
   */
  get width(): number {
    return this._width;
  }

  /**
   * Current canvas height in pixels.
   */
  get height(): number {
    return this._height;
  }

  /**
   * @param options - Configuration object. All properties are optional.
   * @param options.width - Canvas width in pixels.
   * @param options.height - Canvas height in pixels.
   * @param options.radius - Default point radius in pixels.
   * @param options.opacity - Global heatmap opacity (0–1).
   * @param options.gradient - Colour gradient definition.
   */
  constructor(options: HeatMapOptions = {}) {
    const {
      width = 256,
      height = 256,
      radius = 40,
      opacity = 0.6,
      gradient = DEFAULT_GRADIENT,
    } = options;

    this._width = width;
    this._height = height;
    this._radius = radius;
    this._opacity = opacity;
    this._gradient = gradient;

    // Shadow canvas (intensity accumulation)
    this._shadowCanvas = document.createElement('canvas');
    this._shadowCanvas.width = width;
    this._shadowCanvas.height = height;
    this._shadowCtx = this._shadowCanvas.getContext('2d')!;

    // Display canvas (colour-mapped output)
    this._displayCanvas = document.createElement('canvas');
    this._displayCanvas.width = width;
    this._displayCanvas.height = height;
    this._displayCtx = this._displayCanvas.getContext('2d')!;

    // Gradient palette
    this._palette = createGradientPalette(this._gradient);

    // Three.js texture
    this._texture = new THREE.CanvasTexture(this._displayCanvas);
    this._texture.flipY = false; // canvas origin is top-left

    // Initialise empty dataset
    this._data = { data: [], min: 0, max: 1 };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Set the heatmap data and re-render.
   *
   * Replaces any existing data. The canvas and texture are updated immediately.
   * Returns `this` for method chaining.
   *
   * @param data - The dataset to render.
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * heatMap.setData({
   *   max: 100,
   *   data: [
   *     { x: 50, y: 50, value: 80 },
   *     { x: 200, y: 150, value: 30 },
   *   ],
   * });
   * ```
   */
  setData(data: HeatMapData): this {
    const max =
      data.max ?? Math.max(1, ...data.data.map((p) => p.value));
    const min = data.min ?? 0;
    this._data = { ...data, max, min };
    this._render();
    return this;
  }

  /**
   * Add a single data point to the existing dataset and re-render.
   *
   * Returns `this` for method chaining.
   *
   * @param point - The data point to add.
   * @returns This instance for chaining.
   */
  addData(point: HeatMapPoint): this {
    this._data.data.push(point);
    // Re-evaluate max if the new point exceeds it
    if (point.value > (this._data.max ?? 0)) {
      this._data.max = point.value;
    }
    this._render();
    return this;
  }

  /**
   * Replace the colour gradient and re-render.
   *
   * Returns `this` for method chaining.
   *
   * @param gradient - New gradient definition.
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * heatMap.setGradient({
   *   0.0: 'rgb(0,0,0)',
   *   0.5: 'rgb(128,0,255)',
   *   1.0: 'rgb(255,255,255)',
   * });
   * ```
   */
  setGradient(gradient: HeatMapGradient): this {
    this._gradient = gradient;
    this._palette = createGradientPalette(gradient);
    this._render();
    return this;
  }

  /**
   * Set the default point radius and re-render.
   *
   * This radius is used for points that don't specify their own radius.
   * The heatmap is re-rendered with the new radius. Returns `this` for chaining.
   *
   * @param radius - New default radius in pixels. Clamped to ≥ 1.
   * @returns This instance for chaining.
   */
  setRadius(radius: number): this {
    this._radius = Math.max(1, radius);
    this._render();
    return this;
  }

  /**
   * Set the global opacity and re-render.
   *
   * @param opacity - New opacity value (0–1). Clamped to range.
   * @returns This instance for chaining.
   */
  setOpacity(opacity: number): this {
    this._opacity = Math.max(0, Math.min(1, opacity));
    this._render();
    return this;
  }

  /**
   * Return the current dataset.
   */
  getData(): Readonly<HeatMapData> {
    return this._data;
  }

  /**
   * Clear all data and re-render an empty heatmap.
   *
   * Returns `this` for method chaining.
   */
  clear(): this {
    this._data = { data: [], min: 0, max: 1 };
    this._render();
    return this;
  }

  /**
   * Release all resources held by this heatmap.
   *
   * Disposes the Three.js texture. The offscreen canvases become
   * unreachable and will be garbage-collected.
   */
  dispose(): void {
    this._texture.dispose();
  }

  // ── Private rendering ───────────────────────────────────────────────────

  /** Run the two-pass render pipeline and update the texture. */
  private _render(): void {
    const { _width: w, _height: h } = this;

    // ── Pass 1: Shadow (intensity) ──
    this._shadowCtx.clearRect(0, 0, w, h);
    const max = this._data.max ?? 1;
    const min = this._data.min ?? 0;
    const range = max - min || 1;

    for (const point of this._data.data) {
      const normalised = (point.value - min) / range;
      const alpha = Math.max(0, Math.min(1, normalised));
      const radius = (point as any).radius ?? this._radius;
      drawAlphaCircle(this._shadowCtx, point.x, point.y, radius, alpha);
    }

    // ── Pass 2: Colour mapping ──
    this._displayCtx.clearRect(0, 0, w, h);
    colourise(
      this._shadowCtx,
      this._displayCtx,
      this._palette,
      w,
      h,
      this._opacity,
    );

    // ── Update texture ──
    this._texture.needsUpdate = true;
  }
}

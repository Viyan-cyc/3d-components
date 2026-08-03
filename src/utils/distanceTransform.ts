/**
 * Euclidean Distance Transform (Felzenszwalb & Huttenlocher).
 *
 * Generates Signed Distance Field (SDF) data from bitmap alpha channels,
 * based on the Mapbox tiny-sdf algorithm.
 *
 * @module utils/distance-transform
 * @internal This is an internal utility used by DynamicFont.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const INF = 1e20;

/** Default max grid dimension (width/height). */
const DEFAULT_MAX_GRID_SIZE = 256;

/** Default max pixel count (256×256). */
const DEFAULT_MAX_PIXEL_COUNT = DEFAULT_MAX_GRID_SIZE * DEFAULT_MAX_GRID_SIZE;

/** Default SDF spread radius in pixels. */
const DEFAULT_SDF_RADIUS = 8;

/** Default SDF cutoff value. */
const DEFAULT_SDF_CUTOFF = 0.25;

/** Alpha channel index in RGBA pixel data. */
const ALPHA_CHANNEL_INDEX = 3;

/** Maximum value of a single byte channel. */
const MAX_BYTE_VALUE = 255;

/** Midpoint threshold for alpha-based distance classification. */
const ALPHA_MIDPOINT = 0.5;

// ─── EDT helpers ─────────────────────────────────────────────────────────────

/**
 * Performs 1D EDT (parabolic envelope).
 */
/* eslint-disable max-params */
const edt1d = (
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array,
): void => {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];

  for (let q = 1, k = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    // eslint-disable-next-line no-useless-assignment
    let s = 0;

    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);

    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }

  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
};
/* eslint-enable max-params */

/**
 * 2D EDT: apply 1D EDT along columns, then rows.
 */
/* eslint-disable max-params */
const edt = (
  data: Float64Array,
  x0: number,
  y0: number,
  width: number,
  height: number,
  gridSize: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array,
): void => {
  for (let x = x0; x < x0 + width; x++) {
    edt1d(data, y0 * gridSize + x, gridSize, height, f, v, z);
  }
  for (let y = y0; y < y0 + height; y++) {
    edt1d(data, y * gridSize + x0, 1, width, f, v, z);
  }
};
/* eslint-enable max-params */

// ─── DistanceTransform class ────────────────────────────────────────────────

/**
 * DistanceTransform — converts alpha-channel bitmap into SDF.
 *
 * Uses the Felzenszwalb & Huttenlocher linear-time EDT algorithm.
 *
 * @example
 * ```ts
 * const dt = new DistanceTransform(128 * 128, 128);
 * const sdf = dt.transform(imageData, { radius: 8, cutoff: 0.25 });
 * ```
 */
export class DistanceTransform {
  private _gridOuter: Float64Array;
  private _gridInner: Float64Array;
  private _furthest: Float64Array;
  private _zEdges: Float64Array;
  private _vertices: Uint16Array;
  private _uint8Clamper: Uint8ClampedArray;

  /**
   * @param maxPixelCount - Maximum pixels the transform can handle.
   * @param maxGridSize   - Maximum width/height dimension.
   */
  constructor(
    maxPixelCount = DEFAULT_MAX_PIXEL_COUNT,
    maxGridSize = DEFAULT_MAX_GRID_SIZE,
  ) {
    this._gridOuter = new Float64Array(maxPixelCount);
    this._gridInner = new Float64Array(maxPixelCount);
    this._furthest = new Float64Array(maxGridSize);
    this._zEdges = new Float64Array(maxGridSize + 1);
    this._vertices = new Uint16Array(maxGridSize);
    this._uint8Clamper = new Uint8ClampedArray(1);
  }

  /**
   * Transform ImageData alpha into an SDF Uint8Array.
   *
   * @param imageData - Source image (from Canvas getImageData).
   * @param options   - SDF generation options.
   * @returns Single-channel Uint8Array of SDF values, or `null` if image too large.
   */

  transform(
    imageData: ImageData,
    options: {

      /** SDF spread radius (pixels). @default 8 */
      radius?: number;

      /** SDF cutoff value. @default 0.25 */
      cutoff?: number;

      /** Which channel to read from source. @default 3 (alpha) */
      inputChannel?: number;

      /** Optional pre-allocated output array. */
      targetArray?: Uint8Array;
    } = {},
  ): Uint8Array | null {
    const { data, width, height } = imageData;
    const pixelCount = width * height;

    const {
      radius = DEFAULT_SDF_RADIUS,
      cutoff = DEFAULT_SDF_CUTOFF,
      inputChannel = ALPHA_CHANNEL_INDEX,
    } = options;

    const targetArray = options.targetArray ?? new Uint8Array(pixelCount);

    const gridOuter = this._gridOuter;
    const gridInner = this._gridInner;
    const f = this._furthest;
    const z = this._zEdges;
    const v = this._vertices;
    const uint8Clamper = this._uint8Clamper;

    gridOuter.fill(INF, 0, pixelCount);
    gridInner.fill(0, 0, pixelCount);

    const pixelSize = data.length / pixelCount;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * pixelSize + inputChannel] / MAX_BYTE_VALUE;
        if (a === 0) {
          // eslint-disable-next-line no-continue
          continue;
        }

        const i = y * width + x;

        if (a === 1) {
          gridOuter[i] = 0;
          gridInner[i] = INF;
        } else {
          const d = ALPHA_MIDPOINT - a;
          gridOuter[i] = d > 0 ? d * d : 0;
          gridInner[i] = d < 0 ? d * d : 0;
        }
      }
    }

    edt(gridOuter, 0, 0, width, height, width, f, v, z);
    edt(gridInner, 0, 0, width, height, width, f, v, z);

    for (let i = 0; i < pixelCount; i++) {
      const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]);
      uint8Clamper[0] = Math.round(MAX_BYTE_VALUE - MAX_BYTE_VALUE * (d / radius + cutoff));
      targetArray[i] = uint8Clamper[0];
    }

    return targetArray;
  }
}

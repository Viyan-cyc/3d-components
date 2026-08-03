/**
 * DynamicFont — generates a font atlas with SDF (Signed Distance Field) glyphs
 * at runtime using Canvas 2D text rendering.
 *
 * No external font files or plugins required. Characters are rasterized via
 * `CanvasRenderingContext2D.fillText`, then converted to SDF via
 * {@link DistanceTransform}, and packed into a single atlas texture.
 *
 * Translated to Three.js conventions.
 *
 * @module utils/dynamic-font
 */

import { DistanceTransform } from './distanceTransform';

// ────────────────────────────── Constants ──────────────────────────────────

/** Default font size in pixels. */
const DEFAULT_FONT_SIZE = 72;

/** Default atlas width in pixels. */
const DEFAULT_ATLAS_WIDTH = 2048;

/** Default atlas height in pixels. */
const DEFAULT_ATLAS_HEIGHT = 2048;

/** SDF cutoff value. */
const SDF_CUTOFF = 0.25;

/** Number of RGBA channels. */
const RGBA_CHANNELS = 4;

/** Scaler for 'j' character to avoid zero-width artifacts. */
const J_SCALER = 0.00001;

/** Divisor for padding calculation from font size. */
const PADDING_DIVISOR = 24;

/** Multiplier for padding calculation. */
const PADDING_MULTIPLIER = 3;

/** Scale factor for padding in canvas size calculation. */
const PADDING_SCALE = 4;

/** Divisor for SDF radius calculation from font size. */
const SDF_RADIUS_DIVISOR = 24;

/** Multiplier for SDF radius calculation. */
const SDF_RADIUS_MULTIPLIER = 8;

// ────────────────────────────── Public Types ──────────────────────────────

/** Character metrics stored per glyph in the font data. */
export interface FontChar {

  /** The character string. */
  char: string;

  /** Character code. */
  id: number;

  /** X position in atlas (pixels). */
  x: number;

  /** Y position in atlas (pixels). */
  y: number;

  /** Glyph bitmap width (pixels). */
  width: number;

  /** Glyph bitmap height (pixels). */
  height: number;

  /** Horizontal offset from pen position. */
  xoffset: number;

  /** Vertical offset from pen position (positive = up). */
  yoffset: number;

  /** Horizontal advance to next character. */
  xadvance: number;
}

/** Font data structure consumed by BitmapTextGeometry. */
export interface FontKerning {
  first: number;
  second: number;
  amount: number;
}

export interface FontData {
  common: {
    scaleW: number;
    scaleH: number;
  };
  info: {
    size: number;
  };
  chars: FontChar[];
  kernings?: FontKerning[];
}

/** Options for {@link DynamicFont} constructor. */
export interface DynamicFontOptions {

  /** Font size in pixels. @default 72 */
  fontSize?: number;

  /** Atlas width. @default 2048 */
  width?: number;

  /** Atlas height. @default 2048 */
  height?: number;

  /** CSS font-family. @default 'sans-serif' */
  fontFamily?: string;

  /** CSS font-weight. @default 'normal' */
  fontWeight?: string;

  /** CSS font-style. @default 'normal' */
  fontStyle?: string;

  /** Whether to generate SDF. @default true */
  sdf?: boolean;
}

// ────────────────────────────── IndexManager ──────────────────────────────

class IndexManager {
  private available: number[];

  constructor(max: number) {
    this.available = [];
    this.reset(max);
  }

  canAllocate(): boolean {
    return this.available.length > 0;
  }

  allocate(): number {
    return this.available.pop()!;
  }

  free(index: number): void {
    this.available.push(index);
  }

  reset(max: number): void {
    this.available = Array.from({ length: max }, (_, i) => i).reverse();
  }
}

// ────────────────────────────── FontAtlas ─────────────────────────────────

class FontAtlas {
  readonly width: number;
  readonly height: number;

  private charSize: number;
  private maxCol: number;
  private indexManager: IndexManager;
  private fontMap: Map<string, { i: number; x: number; y: number; w: number; h: number }>;
  private buffer: Uint8ClampedArray;
  private sdf: boolean;

  constructor(width: number, height: number, charSize: number, sdf: boolean) {
    this.width = width;
    this.height = height;
    this.charSize = charSize;
    this.maxCol = Math.floor(width / charSize);
    this.indexManager = new IndexManager(Math.floor(width / charSize) * Math.floor(height / charSize));
    this.fontMap = new Map();
    this.buffer = new Uint8ClampedArray(width * height * (sdf ? 1 : RGBA_CHANNELS));
    this.sdf = sdf;
  }

  addChar(
    char: string,
    origin: { buffer: Uint8ClampedArray; width: number; height: number },
  ): boolean {
    if (!this.indexManager.canAllocate()) {
      return false;
    }

    const writeIndex = this.indexManager.allocate();
    const charInfo = {
      i: writeIndex,
      x: (writeIndex % this.maxCol) * this.charSize,
      y: Math.floor(writeIndex / this.maxCol) * this.charSize,
      w: origin.width,
      h: origin.height,
    };
    this.fontMap.set(char, charInfo);

    const { buffer, width, height } = origin;
    const sdf = this.sdf;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const targetIndex = (charInfo.x + x) + (charInfo.y + y) * this.width;
        const sourceIndex = x + y * width;
        if (sdf) {
          // R2R: single-channel copy
          this.buffer[targetIndex] = buffer[sourceIndex];
        } else {
          // RGBA2RGBA: 4-channel copy
          const si4 = sourceIndex * RGBA_CHANNELS;
          const ti4 = targetIndex * RGBA_CHANNELS;
          this.buffer[ti4] = buffer[si4];
          this.buffer[ti4 + 1] = buffer[si4 + 1];
          this.buffer[ti4 + PADDING_MULTIPLIER] = buffer[si4 + PADDING_MULTIPLIER];
          this.buffer[ti4 + RGBA_CHANNELS - 1] = buffer[si4 + RGBA_CHANNELS - 1];
        }
      }
    }

    return true;
  }

  hasChar(char: string): boolean {
    return this.fontMap.has(char);
  }

  getChar(char: string): { x: number; y: number; w: number; h: number } | undefined {
    return this.fontMap.get(char);
  }

  clear(): void {
    this.fontMap.clear();
    this.indexManager.reset(Math.floor(this.width / this.charSize) * Math.floor(this.height / this.charSize));
    this.buffer.fill(0);
  }

  get bufferData(): Uint8ClampedArray {
    return this.buffer;
  }
}

// ────────────────────────────── CharacterCanvas ───────────────────────────

class CharacterCanvas {
  readonly size: number;
  readonly padding: number;

  private distanceRadius: number;
  private distanceCutoff: number;
  private context: CanvasRenderingContext2D;
  private distanceTransformer: DistanceTransform | null;

  constructor(options: {
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    sdf: boolean;
  }) {
    const {
      fontSize, fontFamily, fontWeight, fontStyle, sdf,
    } = options;

    const padding = Math.floor((fontSize / PADDING_DIVISOR) * PADDING_MULTIPLIER);
    const size = fontSize + padding * PADDING_SCALE;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = sdf ? 'black' : 'white';

    this.size = size;
    this.padding = padding;
    this.distanceRadius = Math.floor((fontSize / SDF_RADIUS_DIVISOR) * SDF_RADIUS_MULTIPLIER);
    this.distanceCutoff = SDF_CUTOFF;
    this.context = ctx;
    this.distanceTransformer = sdf ? new DistanceTransform(size * size, size) : null;
  }

  draw(char: string): {
    buffer: Uint8ClampedArray;
    width: number;
    height: number;
    padding: number;
    glyphTop: number;
  } {
    const {
      size, padding, distanceRadius, distanceCutoff, context, distanceTransformer,
    } = this;

    const metrics = context.measureText(char);
    const actualBoundingBoxAscent = metrics.actualBoundingBoxAscent;
    const actualBoundingBoxDescent = metrics.actualBoundingBoxDescent;
    const actualBoundingBoxLeft = metrics.actualBoundingBoxLeft;
    const actualBoundingBoxRight = metrics.actualBoundingBoxRight;

    let glyphTop = Math.ceil(actualBoundingBoxAscent);
    let glyphWidth = Math.max(
      0,
      Math.min(size - padding, Math.ceil(actualBoundingBoxRight - actualBoundingBoxLeft)),
    );
    let glyphHeight = Math.min(size - padding, glyphTop + Math.ceil(actualBoundingBoxDescent));

    if (glyphWidth === 0 || glyphHeight === 0) {
      glyphTop = 0;
      glyphWidth = Math.floor(size / PADDING_MULTIPLIER - padding * PADDING_SCALE);
      glyphHeight = 0;
    }

    const width = Math.min(glyphWidth + PADDING_SCALE * padding, size);
    const height = Math.min(glyphHeight + PADDING_SCALE * padding, size);

    context.clearRect(0, 0, width, height);
    context.fillText(char, padding, padding + glyphTop);

    const imageData = context.getImageData(0, 0, width, height);

    let buffer: Uint8ClampedArray;
    if (distanceTransformer) {
      const result = distanceTransformer.transform(imageData, {
        radius: distanceRadius,
        cutoff: distanceCutoff,
      });
      if (result) {
        buffer = new Uint8ClampedArray(result);
      } else {
        buffer = new Uint8ClampedArray(imageData.data);
      }
    } else {
      buffer = new Uint8ClampedArray(imageData.data);
    }

    return {
      buffer, width, height, padding, glyphTop,
    };
  }
}

// ────────────────────────────── DynamicFont ───────────────────────────────

/**
 * DynamicFont — runtime SDF font atlas generator.
 *
 * Uses Canvas 2D to rasterize characters and {@link DistanceTransform} to
 * convert them into Signed Distance Fields, then packs them into a single
 * atlas texture. No external font files or plugins required.
 *
 * @example
 * ```ts
 * const font = new DynamicFont({ fontSize: 72, sdf: true });
 * font.addChars('Hello 世界');
 *
 * // Get atlas data for Three.js texture
 * const atlasData = font.atlasBuffer;  // Uint8ClampedArray (single-channel SDF)
 * const fontData  = font.fontData;     // Font metrics for layout
 *
 * // Create Three.js DataTexture
 * const texture = new THREE.DataTexture(atlasData, 2048, 2048, THREE.RedFormat);
 * texture.needsUpdate = true;
 * ```
 */
export class DynamicFont {
  private charCanvas: CharacterCanvas;
  private fontAtlas: FontAtlas;
  private font: FontData;

  /**
   * @param options - Configuration options, all optional.
   */
  constructor(options: DynamicFontOptions = {}) {
    const {
      fontSize = DEFAULT_FONT_SIZE,
      width = DEFAULT_ATLAS_WIDTH,
      height = DEFAULT_ATLAS_HEIGHT,
      fontFamily = 'sans-serif',
      fontWeight = 'normal',
      fontStyle = 'normal',
      sdf = true,
    } = options;

    this.charCanvas = new CharacterCanvas({
      fontSize,
      fontFamily,
      fontWeight,
      fontStyle,
      sdf,
    });

    this.fontAtlas = new FontAtlas(
      width,
      height,
      this.charCanvas.size,
      sdf,
    );

    this.font = {
      common: { scaleW: width, scaleH: height },
      info: { size: fontSize },
      chars: [],
    };
  }

  /** Font metrics data (atlas dimensions, glyph positions, etc.). */
  get fontData(): FontData {
    return this.font;
  }

  /** Single-channel (SDF) or RGBA (bitmap) atlas pixel buffer. */
  get atlasBuffer(): Uint8ClampedArray {
    return this.fontAtlas.bufferData;
  }

  /**
   * Add characters to the font atlas.
   *
   * Characters already present in the atlas are skipped.
   * Returns `true` if the atlas texture was modified (new glyphs were added).
   *
   * @param chars - String of characters to add.
   * @returns Whether the atlas was modified.
   */
  addChars(chars: string): boolean {
    let modified = false;

    for (const char of chars) {
      if (!this.fontAtlas.hasChar(char)) {
        if (this.addCharInternal(char)) {
          modified = true;
        } else {
          // eslint-disable-next-line no-console
          console.warn(`DynamicFont: Failed to add char '${char}', the atlas is full.`);
        }
      }
    }

    return modified;
  }

  /**
   * Release all atlas data and character entries.
   */
  dispose(): void {
    this.fontAtlas.clear();
    this.font.chars.length = 0;
  }

  private addCharInternal(char: string): boolean {
    const { charCanvas, fontAtlas, font } = this;

    const {
      buffer, width, height, padding, glyphTop,
    } = charCanvas.draw(char);

    const succeeded = fontAtlas.addChar(char, { buffer, width, height });
    if (!succeeded) {
      return false;
    }

    const charInfo = fontAtlas.getChar(char)!;

    // 'j' scaler to avoid zero-width artifacts
    const scaler = char === 'j' ? J_SCALER : 1;

    font.chars.push({
      char,
      id: char.charCodeAt(0),
      x: charInfo.x + padding * scaler,
      y: charInfo.y + padding * scaler,
      width: charInfo.w - padding * PADDING_SCALE * scaler,
      height: charInfo.h - padding * PADDING_SCALE * scaler,
      xoffset: 0,
      yoffset: -glyphTop,
      xadvance: charInfo.w - padding * PADDING_SCALE * scaler,
    });

    return true;
  }
}

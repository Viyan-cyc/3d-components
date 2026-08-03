/**
 * BitmapText — SDF-based dynamic text component for Three.js.
 *
 * Renders text using a Signed Distance Field (SDF) font atlas generated
 * at runtime via Canvas 2D. No external font files or plugins required.
 *
 * Features:
 * - Dynamic font atlas generation via {@link DynamicFont}
 * - SDF rendering with configurable halo / gamma for anti-aliasing
 * - Optional drop shadow (color, offset, gamma)
 * - Optional outline / stroke (color, width, gamma)
 * - Text alignment (left / center / right)
 * - Word wrapping (nowrap / pre / word-wrapper) with CJK support
 * - Configurable letter spacing and line height
 *
 * @module core/BitmapText
 */

import * as THREE from 'three';
import type { ComponentOptions, IDisposable } from '../types';
import { DynamicFont, type FontData } from '../utils/dynamicFont';

// ────────────────────────────── Public Types ──────────────────────────────

/** Text wrapping mode. */
export type TextMode = 'nowrap' | 'pre' | 'word-wrapper';

/** Text alignment. */
export type TextAlign = 'left' | 'center' | 'right';

/** SDF bitmap type. */
export type BitmapType = 'sdf' | 'bitmap';

/**
 * Options for constructing a {@link BitmapText}.
 *
 * @example
 * ```ts
 * const opts: BitmapTextOptions = {
 *   text: 'Hello 世界',
 *   fontSize: 72,
 *   width: 1000,
 *   mode: 'word-wrapper',
 *   align: 'center',
 *   outline: true,
 *   outlineColor: 0x00bbff,
 *   outlineWidth: 0.06,
 * };
 * ```
 */
export interface BitmapTextOptions extends ComponentOptions {
  // ── Text content ──
  /** Text string to render. @default '' */
  text?: string;

  // ── Font options (passed to DynamicFont) ──
  /** Font size in pixels. @default 72 */
  fontSize?: number;

  /** CSS font-family. @default 'sans-serif' */
  fontFamily?: string;

  /** CSS font-weight. @default 'normal' */
  fontWeight?: string;

  /** CSS font-style. @default 'normal' */
  fontStyle?: string;

  /** Atlas width. @default 2048 */
  atlasWidth?: number;

  /** Atlas height. @default 2048 */
  atlasHeight?: number;

  // ── Layout ──
  /** Maximum line width (font units). @default 1000 */
  width?: number;

  /** Wrapping mode. @default 'word-wrapper' */
  mode?: TextMode;

  /** Text alignment. @default 'left' */
  align?: TextAlign;

  /** Extra spacing between characters (font units). @default 0 */
  letterSpacing?: number;

  /** Line height (font units). @default fontSize */
  lineHeight?: number;

  /** Baseline offset (font units). @default fontSize * 0.8 */
  baseline?: number;

  // ── SDF rendering ──
  /** SDF threshold. @default 0.75 */
  halo?: number;

  /** SDF smoothing. @default 1 */
  gamma?: number;

  /** Text color. @default 0xffffff */
  color?: THREE.ColorRepresentation;

  /** Opacity. @default 1 */
  opacity?: number;

  // ── Shadow ──
  /** Whether to enable drop shadow. @default false */
  shadow?: boolean;

  /** Shadow color. @default 0x4d4d4d */
  shadowColor?: THREE.ColorRepresentation;

  /** Shadow UV offset [x, y]. @default [0.001, -0.001] */
  shadowOffset?: [number, number];

  /** Shadow gamma. @default 1 */
  shadowGamma?: number;

  // ── Outline ──
  /** Whether to enable outline. @default false */
  outline?: boolean;

  /** Outline color. @default 0xff0000 */
  outlineColor?: THREE.ColorRepresentation;

  /** Outline width (SDF units). @default 0.05 */
  outlineWidth?: number;

  /** Outline gamma. @default 1 */
  outlineGamma?: number;

  // ── Billboard ──
  /** Whether text always faces camera. @default false */
  billboard?: boolean;

  // ── Misc ──
  /** World-space scale factor. @default 0.01 */
  scale?: number;

  /** Horizontal center offset (0–1). @default 0.5 (centered) */
  centerX?: number;

  /** Vertical center offset (0–1). @default 0.5 (centered) */
  centerY?: number;
}

// ────────────────────────────── Shaders ───────────────────────────────────

const vertexShader = /* glsl */ `
  attribute vec2 a_Uv;
  attribute vec2 a_Size;

  #ifdef USE_BILLBOARD
    uniform float u_Rotation;
    uniform vec2 u_Center;
  #endif

  varying vec2 v_Uv;
  varying vec2 v_Size;

  void main() {
    #ifdef USE_BILLBOARD
      vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);

      vec2 scale;
      scale.x = length(vec3(modelMatrix[0].x, modelMatrix[0].y, modelMatrix[0].z));
      scale.y = length(vec3(modelMatrix[1].x, modelMatrix[1].y, modelMatrix[1].z));

      #ifndef USE_SIZEATTENUATION
        if (projectionMatrix[2][3] != 0.0) {
          scale *= -mvPosition.z;
        }
      #endif

      vec2 alignedPosition = (position.xy - (u_Center - vec2(0.5))) * scale;

      vec2 rotatedPosition;
      rotatedPosition.x = cos(u_Rotation) * alignedPosition.x - sin(u_Rotation) * alignedPosition.y;
      rotatedPosition.y = sin(u_Rotation) * alignedPosition.x + cos(u_Rotation) * alignedPosition.y;

      mvPosition.xy += rotatedPosition;

      gl_Position = projectionMatrix * mvPosition;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #endif

    v_Uv = a_Uv;
    v_Size = a_Size;
  }
`;

const fragmentShader = /* glsl */ `
  #ifdef GL_OES_standard_derivatives
    #extension GL_OES_standard_derivatives : enable
  #endif

  uniform vec3 u_Color;
  uniform float u_Opacity;
  uniform sampler2D u_DiffuseMap;

  uniform float u_Halo;
  uniform float u_Gamma;

  #ifdef USE_SHADOW
    uniform vec3 u_ShadowColor;
    uniform vec2 u_ShadowOffset;
    uniform float u_ShadowGamma;
  #endif

  #ifdef USE_OUTLINE
    uniform vec3 u_OutlineColor;
    uniform float u_OutlineWidth;
    uniform float u_OutlineGamma;
  #endif

  varying vec2 v_Uv;
  varying vec2 v_Size;

  vec4 blendColors(vec4 src, vec4 dst) {
    return vec4(src.rgb * src.a + dst.rgb * (1.0 - src.a), src.a + dst.a * (1.0 - src.a));
  }

  float getAlpha(float dist, float halo, float gamma) {
    return smoothstep(halo - gamma, halo + gamma, dist);
  }

  #ifdef USE_SDF
    float getSDFDist(vec2 uv) {
      return texture2D(u_DiffuseMap, uv).r;
    }
  #endif

  void main() {
    #ifdef USE_SDF
      float dist = getSDFDist(v_Uv);

      float gammaScalar = 1.5 * length(fwidth(v_Size));

      vec4 resultColor = vec4(0.0);

      #ifdef USE_SHADOW
        float shadowDist = getSDFDist(v_Uv - u_ShadowOffset);
        float shadowAlpha = getAlpha(shadowDist, u_Halo, u_ShadowGamma * gammaScalar);
        resultColor = blendColors(vec4(u_ShadowColor, shadowAlpha), resultColor);
      #endif

      #ifdef USE_OUTLINE
        float outlineAlpha = getAlpha(dist, u_Halo - u_OutlineWidth, u_OutlineGamma * gammaScalar);
        resultColor = blendColors(vec4(u_OutlineColor, outlineAlpha), resultColor);
      #endif

      float textAlpha = getAlpha(dist, u_Halo, u_Gamma * gammaScalar);
      resultColor = blendColors(vec4(u_Color, textAlpha), resultColor);

      float totalAlpha = resultColor.a;
      if (totalAlpha > 0.001) {
        resultColor.rgb /= totalAlpha;
      }
      resultColor.a *= u_Opacity;

      gl_FragColor = resultColor;
    #else
      gl_FragColor = texture2D(u_DiffuseMap, v_Uv);
      gl_FragColor.a *= u_Opacity;
    #endif
  }
`;

// ────────────────────────────── Text Layout ───────────────────────────────

const X_HEIGHTS = ['x', 'e', 'a', 'o', 'n', 's', 'r', 'c', 'u', 'm', 'v', 'w', 'z'];
const M_WIDTHS = ['m', 'w'];
const CAP_HEIGHTS = ['H', 'I', 'N', 'E', 'F', 'K', 'L', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const TAB_ID = '\t'.charCodeAt(0);
const SPACE_ID = ' '.charCodeAt(0);
const ALIGN_LEFT = 0;
const ALIGN_CENTER = 1;
const ALIGN_RIGHT = 2;

const COLOR_MAX = 255;
const RGBA_CHANNELS = 4;
const POSITION_COMPONENTS = 3;
const UV_COMPONENTS = 2;
const DEFAULT_TAB_SIZE = 4;
const DEFAULT_FONT_SIZE = 72;
const DEFAULT_ATLAS_SIZE = 2048;
const DEFAULT_WIDTH = 1000;
const DEFAULT_HALO = 0.75;
const DEFAULT_COLOR = 0xffffff;
const DEFAULT_SHADOW_COLOR = 0x4d4d4d;
const DEFAULT_SHADOW_OFFSET_X = 0.001;
const DEFAULT_SHADOW_OFFSET_Y = -0.001;
const DEFAULT_OUTLINE_COLOR = 0xff0000;
const DEFAULT_OUTLINE_WIDTH = 0.05;
const DEFAULT_SCALE = 0.01;
const CENTER_MID = 0.5;
const BASELINE_FACTOR = 0.8;
const UNPACK_ALIGNMENT = 4;
const DEFAULT_CENTER_X = 0.5;
const DEFAULT_CENTER_Y = 0.5;

const newlineRe = /\n/;
const whitespaceRe = /\s/;
const letterRe = /[a-zA-Z]/;

interface GlyphInfo {
  position: [number, number];
  data: FontData['chars'][0];
  index: number;
  lineIndex: number;
  linesTotal: number;
  lineLettersTotal: number;
  lineLetterIndex: number;
  lineWordsTotal: number;
  lineWordIndex: number;
  lettersTotal: number;
  letterIndex: number;
  wordsTotal: number;
  wordIndex: number;
}

interface LineInfo {
  start: number;
  end: number;
  width: number;
}

const numVal = (n: unknown, def: number): number => typeof n === 'number' ? n : def;

const findChar = (array: FontData['chars'], id: number): number => {
  for (const entry of array) {
    if (entry.id === id) {
      return array.indexOf(entry);
    }
  }
  return -1;
};

const getGlyphById = (font: FontData, id: number): FontData['chars'][0] | null => {
  if (!font.chars || font.chars.length === 0) {
    return null;
  }
  const idx = findChar(font.chars, id);
  return idx >= 0 ? font.chars[idx] : null;
};

const getMGlyph = (font: FontData): FontData['chars'][0] | null => {
  for (const ch of M_WIDTHS) {
    const idx = findChar(font.chars, ch.charCodeAt(0));
    if (idx >= 0) {
      return font.chars[idx];
    }
  }
  return null;
};

const getXHeight = (font: FontData): number => {
  for (const ch of X_HEIGHTS) {
    const idx = findChar(font.chars, ch.charCodeAt(0));
    if (idx >= 0) {
      return font.chars[idx].height;
    }
  }
  return 0;
};

const getCapHeight = (font: FontData): number => {
  for (const ch of CAP_HEIGHTS) {
    const idx = findChar(font.chars, ch.charCodeAt(0));
    if (idx >= 0) {
      return font.chars[idx].height;
    }
  }
  return 0;
};

const getKerning = (font: FontData, left: number, right: number): number => {
  if (!font.kernings) {
    return 0;
  }
  for (const k of font.kernings) {
    if (k.first === left && k.second === right) {
      return k.amount;
    }
  }
  return 0;
};

const getAlignType = (align: string | undefined): number => {
  if (align === 'center') {
    return ALIGN_CENTER;
  }
  if (align === 'right') {
    return ALIGN_RIGHT;
  }
  return ALIGN_LEFT;
};

// ── Word Wrapping ──

interface WordWrapOptions {
  width: number;
  mode?: TextMode;
  measure: (text: string, start: number, end: number, width: number) => LineInfo;
}

const preWrap = (
  measure: (text: string, start: number, end: number, width: number) => LineInfo,
  text: string,
  start: number,
  end: number,
  width: number,
): LineInfo[] => {
  const lines: LineInfo[] = [];
  let lineStart = start;
  for (let i = start; i < end && i < text.length; i++) {
    const chr = text.charAt(i);
    const isNewline = newlineRe.test(chr);
    if (isNewline || i === end - 1) {
      const lineEnd = isNewline ? i : i + 1;
      const measured = measure(text, lineStart, lineEnd, width);
      lines.push(measured);
      lineStart = i + 1;
    }
  }
  return lines;
};

interface GreedyOptions {
  measure: (text: string, start: number, end: number, width: number) => LineInfo;
  text: string;
  start: number;
  end: number;
  width: number;
  mode?: string;
}

const skipLeadingWhitespace = (
  text: string,
  pos: number,
  newLine: number,
  newParagraph: number,
): number => {
  let current = pos;
  while (current < newLine) {
    if (!whitespaceRe.test(text.charAt(current))) {
      break;
    }
    if (current === newParagraph) {
      break;
    }
    current++;
  }
  return current;
};

const trimTrailingWhitespace = (text: string, lineEnd: number, start: number): number => {
  let current = lineEnd;
  while (current > start) {
    if (!whitespaceRe.test(text.charAt(current - 1))) {
      break;
    }
    current--;
  }
  return current;
};

interface ProcessGreedyLineOpts {
  text: string;
  start: number;
  newLine: number;
  testWidth: number;
  measure: (text: string, start: number, end: number, width: number) => LineInfo;
}

interface GreedyLineResult {
  lineEnd: number;
  nextStart: number;
  result: LineInfo | null;
}

const processGreedyLine = (opts: ProcessGreedyLineOpts): GreedyLineResult => {
  const {
    text, start, newLine, testWidth, measure,
  } = opts;
  const measured = measure(text, start, newLine, testWidth);

  let lineEnd = start + (measured.end - measured.start);
  // +1 for newline char
  let nextStart = lineEnd + 1;

  // Avoid breaking in the middle of a Latin word
  if (lineEnd < newLine) {
    while (lineEnd > start) {
      if (!letterRe.test(text.charAt(lineEnd))) {
        break;
      }
      lineEnd--;
    }
    if (lineEnd === start) {
      if (nextStart > start + 1) {
        nextStart--;
      }
      lineEnd = nextStart;
    } else {
      nextStart = lineEnd;
      lineEnd = trimTrailingWhitespace(text, lineEnd, start);
    }
  }

  if (lineEnd >= start) {
    const result = measure(text, start, lineEnd, testWidth);
    return { lineEnd, nextStart, result };
  }
  return { lineEnd, nextStart, result: null };
};

const greedy = (opts: GreedyOptions): LineInfo[] => {
  const {
    measure, text, width, mode,
  } = opts;
  const lines: LineInfo[] = [];
  let testWidth = width;
  if (mode === 'nowrap') {
    testWidth = Number.MAX_VALUE;
  }

  let pos = opts.start;
  let newParagraph = pos;
  const end = opts.end;

  while (pos < end && pos < text.length) {
    let newLine = text.indexOf('\n', pos);
    if (newLine === -1 || newLine > end) {
      newLine = end;
    }

    pos = skipLeadingWhitespace(text, pos, newLine, newParagraph);

    newParagraph = newLine + 1;
    const { nextStart, result } = processGreedyLine({
      text, start: pos, newLine, testWidth, measure,
    });

    if (result) {
      lines.push(result);
    }
    pos = nextStart;
  }

  return lines;
};

const wordwrap = (
  text: string,
  opt: WordWrapOptions,
): LineInfo[] => {
  if (opt.width === 0 && opt.mode !== 'nowrap') {
    return [];
  }

  const width = typeof opt.width === 'number' ? opt.width : Number.MAX_VALUE;
  const start = 0;
  const end = text.length;
  const mode = opt.mode;
  const measure = opt.measure;

  if (mode === 'pre') {
    return preWrap(measure, text, start, end, width);
  }
  return greedy({
    measure, text, start, end, width, mode,
  });
};

// ── TextLayout ──

interface TextLayoutOptions {
  font: FontData;
  text?: string;
  letterSpacing?: number;
  lineHeight?: number;
  baseline?: number;
  width?: number;
  mode?: TextMode;
  align?: TextAlign;
  tabSize?: number;
}

interface BuildGlyphsOpts {
  glyphs: GlyphInfo[];
  lines: LineInfo[];
  textContent: string;
  maxLineWidth: number;
  lineHeight: number;
  letterSpacing: number;
  align: number;
}

interface ProcessLineGlyphsOpts {
  line: LineInfo;
  lineIndex: number;
  textContent: string;
  maxLineWidth: number;
  y: number;
  x: number;
  letterSpacing: number;
  align: number;
  glyphs: GlyphInfo[];
  linesTotal: number;
}

interface HandleGlyphOpts {
  glyph: FontData['chars'][0];
  lastGlyph: FontData['chars'][0] | null;
  x: number;
  y: number;
  charIndex: number;
  lineIndex: number;
  linesTotal: number;
  lineLettersTotal: number;
  lineLetterIndex: number;
  lineWordsTotal: number;
  lineWordIndex: number;
  letterIndex: number;
  wordIndex: number;
  maxLineWidth: number;
  lineWidth: number;
  align: number;
  letterSpacing: number;
}

interface HandleGlyphResult {
  x: number;
  lastGlyph: FontData['chars'][0] | null;
  lineLetterIndex: number;
  lineWordIndex: number;
  letterIndex: number;
  wordIndex: number;
  glyphInfo: GlyphInfo;
}

class TextLayout {
  glyphs: GlyphInfo[] = [];
  private _width = 0;
  private _height = 0;
  private _descender = 0;
  private _ascender = 0;
  private _xHeight = 0;
  private _baseline = 0;
  private _capHeight = 0;
  private _lineHeight = 0;
  private _linesTotal = 0;
  private _lettersTotal = 0;
  private _wordsTotal = 0;
  private _fallbackSpaceGlyph: FontData['chars'][0] | null = null;
  private _fallbackTabGlyph: FontData['chars'][0] | null = null;
  private _options: TextLayoutOptions = {} as TextLayoutOptions;

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get descender(): number {
    return this._descender;
  }

  get ascender(): number {
    return this._ascender;
  }

  get xHeight(): number {
    return this._xHeight;
  }

  get baseline(): number {
    return this._baseline;
  }

  get capHeight(): number {
    return this._capHeight;
  }

  get lineHeight(): number {
    return this._lineHeight;
  }

  get linesTotal(): number {
    return this._linesTotal;
  }

  get lettersTotal(): number {
    return this._lettersTotal;
  }

  get wordsTotal(): number {
    return this._wordsTotal;
  }

  update(options: TextLayoutUpdateParams): void {
    this._options = { ...options, tabSize: options.tabSize ?? DEFAULT_TAB_SIZE };
    const opt = this._options;
    const font = opt.font;

    this._setupSpaceGlyphs(font);

    const glyphs = this.glyphs;
    const textContent: string = opt.text || '';

    const lines = wordwrap(textContent, {
      width: opt.width ?? Number.MAX_VALUE,
      mode: opt.mode,
      measure: this._measure.bind(this),
    });

    const minWidth = opt.width || 0;
    const wordsTotal = textContent.split(' ').filter((w: string) => w !== '\n').length;
    const lettersTotal = textContent
      .split('')
      .filter((c: string) => c !== '\n' && c !== ' ').length;

    glyphs.length = 0;

    const maxLineWidth = lines.reduce((prev, line) => Math.max(prev, line.width, minWidth), 0);

    const lineHeight = numVal(opt.lineHeight, font.info.size);
    const baseline = numVal(opt.baseline, font.info.size * BASELINE_FACTOR);
    const descender = lineHeight - baseline;
    const letterSpacing = opt.letterSpacing || 0;
    const height = lineHeight * lines.length - descender;
    const align = getAlignType(opt.align);

    this._width = maxLineWidth;
    this._height = height;
    this._descender = descender;
    this._baseline = baseline;
    this._xHeight = getXHeight(font);
    this._capHeight = getCapHeight(font);
    this._lineHeight = lineHeight;
    this._ascender = lineHeight - descender - this._xHeight;

    this._buildGlyphs({
      glyphs, lines, textContent, maxLineWidth, lineHeight, letterSpacing, align,
    });
    this._lettersTotal = lettersTotal;
    this._wordsTotal = wordsTotal;
    this._linesTotal = lines.length;
  }

  private _buildGlyphs(opts: BuildGlyphsOpts): void {
    const {
      glyphs, lines, textContent, maxLineWidth, lineHeight, letterSpacing, align,
    } = opts;
    let x = 0;
    const baselineDefault = this._options.font.info.size * BASELINE_FACTOR;
    const initialY = -(lineHeight * lines.length -
      (lineHeight - numVal(this._options.baseline, baselineDefault)));
    let y = initialY;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      this._processLineGlyphs({
        line,
        lineIndex,
        textContent,
        maxLineWidth,
        y,
        x,
        letterSpacing,
        align,
        glyphs,
        linesTotal: lines.length,
      });
      x = 0;
      y += lineHeight;
    }
  }

  private _computeLineStats(textContent: string, lineStart: number, lineEnd: number) {
    const lineWordsTotal = textContent
      .slice(lineStart, lineEnd)
      .split(' ')
      .filter((w: string) => w !== '').length;
    const lineLettersTotal = textContent
      .slice(lineStart, lineEnd)
      .split(' ')
      .join('').length;
    return { lineWordsTotal, lineLettersTotal };
  }

  private _processLineGlyphs(lineOpts: ProcessLineGlyphsOpts): void {
    const {
      line, lineIndex, textContent, maxLineWidth, y, x: initialX,
      letterSpacing, align, glyphs, linesTotal,
    } = lineOpts;
    const { start: lineStart, end: lineEnd, width: lineWidth } = line;
    let x = initialX;
    const { lineWordsTotal, lineLettersTotal } =
      this._computeLineStats(textContent, lineStart, lineEnd);
    let lineLetterIndex = 0;
    let lineWordIndex = 0;
    let letterIndex = 0;
    let wordIndex = 0;
    let lastGlyph: FontData['chars'][0] | null = null;

    for (let i = lineStart; i < lineEnd; i++) {
      const glyph = this._getGlyph(this._options.font, textContent.charCodeAt(i));
      if (!glyph) {
        lastGlyph = null;
        continue; // eslint-disable-line no-continue
      }
      const result = this._handleGlyph({
        glyph,
        lastGlyph,
        x,
        y,
        charIndex: i,
        lineIndex,
        linesTotal,
        lineLettersTotal,
        lineLetterIndex,
        lineWordsTotal,
        lineWordIndex,
        letterIndex,
        wordIndex,
        maxLineWidth,
        lineWidth,
        align,
        letterSpacing,
      });
      x = result.x;
      lastGlyph = result.lastGlyph;
      lineLetterIndex = result.lineLetterIndex;
      lineWordIndex = result.lineWordIndex;
      letterIndex = result.letterIndex;
      wordIndex = result.wordIndex;
      glyphs.push(result.glyphInfo);
    }
  }

  private _handleGlyph(h: HandleGlyphOpts): HandleGlyphResult {
    let {
      x, lastGlyph, lineLetterIndex, lineWordIndex, letterIndex, wordIndex,
    } = h;
    if (lastGlyph) {
      x += getKerning(this._options.font, lastGlyph.id, h.glyph.id);
    }
    const tx = this._alignX(x, h.align, h.maxLineWidth, h.lineWidth);
    const glyphInfo: GlyphInfo = {
      position: [tx, h.y],
      data: h.glyph,
      index: h.charIndex,
      lineIndex: h.lineIndex,
      linesTotal: h.linesTotal,
      lineLettersTotal: h.lineLettersTotal,
      lineLetterIndex,
      lineWordsTotal: h.lineWordsTotal,
      lineWordIndex,
      lettersTotal: this._lettersTotal,
      letterIndex: this._lettersTotal + letterIndex,
      wordsTotal: this._wordsTotal,
      wordIndex: this._wordsTotal + wordIndex,
    };
    const isSpaceStart = h.glyph.id === SPACE_ID &&
      (!lastGlyph || lastGlyph.id !== SPACE_ID);
    if (isSpaceStart) {
      lineWordIndex++;
      wordIndex++;
    }
    if (h.glyph.id !== SPACE_ID) {
      lineLetterIndex++;
      letterIndex++;
    }
    x += h.glyph.xadvance + h.letterSpacing;
    lastGlyph = h.glyph;
    return {
      x,
      lastGlyph,
      lineLetterIndex,
      lineWordIndex,
      letterIndex,
      wordIndex,
      glyphInfo,
    };
  }

  private _alignX(x: number, align: number, maxLineWidth: number, lineWidth: number): number {
    if (align === ALIGN_CENTER) {
      return x + (maxLineWidth - lineWidth) / 2;
    }
    if (align === ALIGN_RIGHT) {
      return x + maxLineWidth - lineWidth;
    }
    return x;
  }

  private _getGlyph(font: FontData, id: number): FontData['chars'][0] | null {
    const glyph = getGlyphById(font, id);
    if (glyph) {
      return glyph;
    }
    if (id === TAB_ID) {
      return this._fallbackTabGlyph;
    }
    if (id === SPACE_ID) {
      return this._fallbackSpaceGlyph;
    }
    return null;
  }

  private _measure(
    text: string,
    start: number,
    endParam: number,
    width: number,
  ): LineInfo {
    const letterSpacing = this._options.letterSpacing || 0;
    const font = this._options.font;
    let curPen = 0;
    let curWidth = 0;
    let count = 0;
    let lastGlyph: FontData['chars'][0] | null = null;

    if (!font.chars || font.chars.length === 0) {
      return { start, end: start, width: 0 };
    }

    const end = Math.min(text.length, endParam);

    for (let i = start; i < end; i++) {
      const id = text.charCodeAt(i);
      const glyph = this._getGlyph(font, id);
      if (glyph) {
        glyph.char = text[i];
        const kern = lastGlyph ? getKerning(font, lastGlyph.id, glyph.id) : 0;
        curPen += kern;

        const nextPen = curPen + glyph.xadvance + letterSpacing;
        const nextWidth = curPen + glyph.width;

        if (nextWidth >= width || nextPen >= width) {
          break;
        }

        curPen = nextPen;
        curWidth = nextWidth;
        lastGlyph = glyph;
        count++;
      } else {
        lastGlyph = null;
      }
    }

    if (lastGlyph) {
      curWidth += lastGlyph.xoffset;
    }

    return { start, end: start + count, width: curWidth };
  }

  private _setupSpaceGlyphs(font: FontData): void {
    this._fallbackSpaceGlyph = null;
    this._fallbackTabGlyph = null;

    if (!font.chars || font.chars.length === 0) {
      return;
    }

    const space = getGlyphById(font, SPACE_ID) || getMGlyph(font) || font.chars[0];
    const tabWidth = (this._options.tabSize ?? DEFAULT_TAB_SIZE) * space.xadvance;
    this._fallbackSpaceGlyph = space;
    this._fallbackTabGlyph = {
      ...space,
      x: 0,
      y: 0,
      xadvance: tabWidth,
      id: TAB_ID,
      xoffset: 0,
      yoffset: 0,
      width: 0,
      height: 0,
    };
  }
}

// ── Geometry Building ──

interface TextLayoutParams {
  font: FontData;
  text?: string;
  width?: number;
  mode?: TextMode;
  align?: TextAlign;
  letterSpacing?: number;
  lineHeight?: number;
  baseline?: number;
  centerX?: number;
  centerY?: number;
}

const fillGlyphUVs = (
  uvs: Float32Array,
  bitmap: FontData['chars'][0],
  texWidth: number,
  texHeight: number,
  uiStart: number,
): number => {
  let ui = uiStart;
  // UV coordinates (flipY for Three.js)
  const bw = bitmap.x + bitmap.width;
  const bh = bitmap.y + bitmap.height;
  const u0 = bitmap.x / texWidth;
  const u1 = bw / texWidth;
  const v0 = 1 - bh / texHeight;
  const v1 = 1 - bitmap.y / texHeight;

  // BL
  uvs[ui++] = u0; uvs[ui++] = v1;
  // TL
  uvs[ui++] = u0; uvs[ui++] = v0;
  // TR
  uvs[ui++] = u1; uvs[ui++] = v0;
  // BR
  uvs[ui++] = u1; uvs[ui++] = v1;
  return ui;
};

const fillGlyphPositions = (
  positions: Float32Array,
  glyph: GlyphInfo,
  bitmap: FontData['chars'][0],
  piStart: number,
): number => {
  let pi = piStart;
  // Positions (Y negated to match convention)
  const x = glyph.position[0] + bitmap.xoffset;
  const y = glyph.position[1] + bitmap.yoffset;
  const w = bitmap.width;
  const h = bitmap.height;

  // BL
  positions[pi++] = x; positions[pi++] = -y; positions[pi++] = 0;
  // TL
  positions[pi++] = x; positions[pi++] = -(y + h); positions[pi++] = 0;
  // TR
  positions[pi++] = x + w; positions[pi++] = -(y + h); positions[pi++] = 0;
  // BR
  positions[pi++] = x + w; positions[pi++] = -y; positions[pi++] = 0;
  return pi;
};

const fillGlyphSizes = (
  sizes: Float32Array,
  bitmap: FontData['chars'][0],
  fontSize: number,
  siStart: number,
): number => {
  let si = siStart;
  const w = bitmap.width;
  const h = bitmap.height;
  // BL
  sizes[si++] = 0; sizes[si++] = 0;
  // TL
  sizes[si++] = 0; sizes[si++] = h / fontSize;
  // TR
  sizes[si++] = w / fontSize; sizes[si++] = h / fontSize;
  // BR
  sizes[si++] = w / fontSize; sizes[si++] = 0;
  return si;
};

const applyCenterOffset = (
  positions: Float32Array,
  centerX: number,
  centerY: number,
): void => {
  if (centerX === 0 && centerY === 0) {
    return;
  }
  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += POSITION_COMPONENTS) {
    const px = positions[i];
    const py = positions[i + 1];
    if (px < minX) {
      minX = px;
    }
    if (px > maxX) {
      maxX = px;
    }
    if (py < minY) {
      minY = py;
    }
    if (py > maxY) {
      maxY = py;
    }
  }

  const xOffset = (maxX - minX) * centerX;
  const yOffset = (maxY - minY) * centerY;

  for (let i = 0; i < positions.length; i += POSITION_COMPONENTS) {
    positions[i] -= xOffset;
    positions[i + 1] -= yOffset;
  }
};

const buildGlyphBuffers = (
  visibleGlyphs: GlyphInfo[],
  font: FontData,
): {
  positions: Float32Array;
  uvs: Float32Array;
  sizes: Float32Array;
  indices: number[];
} => {
  const count = visibleGlyphs.length;
  const positions = new Float32Array(count * RGBA_CHANNELS * POSITION_COMPONENTS);
  const uvs = new Float32Array(count * RGBA_CHANNELS * UV_COMPONENTS);
  const sizes = new Float32Array(count * RGBA_CHANNELS * UV_COMPONENTS);
  const indices: number[] = [];

  let pi = 0;
  let ui = 0;
  let si = 0;
  const texWidth = font.common.scaleW;
  const texHeight = font.common.scaleH;
  const fontSize = font.info.size;

  for (let gi = 0; gi < count; gi++) {
    const glyph = visibleGlyphs[gi];
    const bitmap = glyph.data;

    ui = fillGlyphUVs(uvs, bitmap, texWidth, texHeight, ui);
    pi = fillGlyphPositions(positions, glyph, bitmap, pi);
    si = fillGlyphSizes(sizes, bitmap, fontSize, si);

    // Indices (2 triangles per quad)
    const base = gi * RGBA_CHANNELS;
    const lastVertex = RGBA_CHANNELS - 1;
    indices.push(
      base + 0, base + 1, base + 2,
      base + 0, base + 2, base + lastVertex,
    );
  }

  return {
    positions, uvs, sizes, indices,
  };
};

const buildTextGeometry = (params: TextLayoutParams): {
  positions: Float32Array;
  uvs: Float32Array;
  sizes: Float32Array;
  indices: number[];
  layout: TextLayout;
} => {
  const layout = new TextLayout();
  layout.update({
    font: params.font,
    text: params.text,
    width: params.width,
    mode: params.mode,
    align: params.align,
    letterSpacing: params.letterSpacing,
    lineHeight: params.lineHeight,
    baseline: params.baseline,
  });

  const visibleGlyphs = layout.glyphs.filter((g) => {
    const bitmap = g.data;
    return bitmap.width * bitmap.height > 0;
  });

  const {
    positions, uvs, sizes, indices,
  } = buildGlyphBuffers(visibleGlyphs, params.font);

  // Apply center offset
  const centerX = params.centerX ?? DEFAULT_CENTER_X;
  const centerY = params.centerY ?? DEFAULT_CENTER_Y;
  applyCenterOffset(positions, centerX, centerY);

  return {
    positions, uvs, sizes, indices, layout,
  };
};

// ────────────────────────────── BitmapText ────────────────────────────────

/**
 * BitmapText — SDF-based dynamic text component for Three.js.
 *
 * Renders text using a Signed Distance Field font atlas generated at runtime
 * via Canvas 2D. No external font files or plugins required.
 *
 * **Features:**
 * - Dynamic font atlas generation via {@link DynamicFont}
 * - SDF rendering with configurable halo / gamma for anti-aliasing
 * - Optional drop shadow (color, offset, gamma)
 * - Optional outline / stroke (color, width, gamma)
 * - Text alignment (left / center / right)
 * - Word wrapping (nowrap / pre / word-wrapper) with CJK support
 * - Configurable letter spacing and line height
 * - Implements {@link IDisposable} — `dispose()` releases all GPU resources
 *
 * @example
 * ```ts
 * import { BitmapText } from '@a3d/a3d-components/core';
 *
 * const text = new BitmapText({
 *   text: 'Hello 世界',
 *   fontSize: 72,
 *   width: 1000,
 *   align: 'center',
 *   outline: true,
 *   outlineColor: 0x00bbff,
 *   outlineWidth: 0.06,
 * });
 * scene.add(text);
 *
 * // Update text at runtime
 * text.setText('Updated text');
 *
 * // Cleanup
 * text.dispose();
 * ```
 *
 * @extends THREE.Mesh
 *
 * Implements {@link IDisposable}.
 */
export class BitmapText extends THREE.Mesh implements IDisposable {
  private _dynamicFont: DynamicFont;
  private _layoutParams: TextLayoutParams;
  private _scale: number;
  private _sdf: boolean;

  /** Current text string. */
  private _text: string;

  /**
   * @param options - Configuration object, all properties optional.
   */
  constructor(options: BitmapTextOptions = {}) {
    const opts = BitmapText._resolveDefaults(options);

    // Create DynamicFont
    const dynamicFont = BitmapText._createFont(opts);
    dynamicFont.addChars(opts.text);

    // Build geometry + material + mesh
    const layoutParams = BitmapText._buildLayoutParams(opts, dynamicFont);
    const geomData = buildTextGeometry(layoutParams);
    const geometry = BitmapText._buildGeometry(geomData);
    const atlasData = BitmapText._buildAtlasData(dynamicFont.atlasBuffer, opts.sdf);
    const texture = BitmapText._buildTexture(atlasData, opts.atlasWidth, opts.atlasHeight);
    const material = BitmapText._buildMaterial(opts, texture);

    super(geometry, material);

    // Enable GL_OES_standard_derivatives for fwidth() in fragment shader
    const ext = (this.material as THREE.ShaderMaterial).extensions as Record<string, boolean>;
    ext.derivatives = true;

    this._dynamicFont = dynamicFont;
    this._layoutParams = layoutParams;
    this._scale = opts.scale;
    this._sdf = opts.sdf;
    this._text = opts.text;

    // prevent culling — geometry coords are in font space
    this.frustumCulled = false;
    this.scale.setScalar(opts.scale);

    if (options.name) {
      this.name = options.name;
    }
    if (options.visible !== undefined) {
      this.visible = options.visible;
    }
    if (options.userData) {
      this.userData = { ...options.userData };
    }
  }

  private static _resolveDefaults(options: BitmapTextOptions): ResolvedBitmapTextOptions {
    return {
      ...BitmapText._resolveTextDefaults(options),
      ...BitmapText._resolveFontDefaults(options),
      ...BitmapText._resolveLayoutDefaults(options),
      ...BitmapText._resolveRenderDefaults(options),
      ...BitmapText._resolveShadowDefaults(options),
      ...BitmapText._resolveOutlineDefaults(options),
      billboard: options.billboard ?? false,
      scale: options.scale ?? DEFAULT_SCALE,
      centerX: options.centerX ?? DEFAULT_CENTER_X,
      centerY: options.centerY ?? DEFAULT_CENTER_Y,
      sdf: true,
    } as ResolvedBitmapTextOptions;
  }

  private static _resolveTextDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return { text: options.text ?? '' };
  }

  private static _resolveFontDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return {
      fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
      fontFamily: options.fontFamily ?? 'sans-serif',
      fontWeight: options.fontWeight ?? 'normal',
      fontStyle: options.fontStyle ?? 'normal',
      atlasWidth: options.atlasWidth ?? DEFAULT_ATLAS_SIZE,
      atlasHeight: options.atlasHeight ?? DEFAULT_ATLAS_SIZE,
    };
  }

  private static _resolveLayoutDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return {
      width: options.width ?? DEFAULT_WIDTH,
      mode: options.mode ?? 'word-wrapper',
      align: options.align ?? 'left',
      letterSpacing: options.letterSpacing ?? 0,
      lineHeight: options.lineHeight,
      baseline: options.baseline,
    };
  }

  private static _resolveRenderDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return {
      halo: options.halo ?? DEFAULT_HALO,
      gamma: options.gamma ?? 1,
      color: options.color ?? DEFAULT_COLOR,
      opacity: options.opacity ?? 1,
    };
  }

  private static _resolveShadowDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return {
      shadow: options.shadow ?? false,
      shadowColor: options.shadowColor ?? DEFAULT_SHADOW_COLOR,
      shadowOffset: options.shadowOffset ??
        [DEFAULT_SHADOW_OFFSET_X, DEFAULT_SHADOW_OFFSET_Y],
      shadowGamma: options.shadowGamma ?? 1,
    };
  }

  private static _resolveOutlineDefaults(options: BitmapTextOptions): Partial<ResolvedBitmapTextOptions> {
    return {
      outline: options.outline ?? false,
      outlineColor: options.outlineColor ?? DEFAULT_OUTLINE_COLOR,
      outlineWidth: options.outlineWidth ?? DEFAULT_OUTLINE_WIDTH,
      outlineGamma: options.outlineGamma ?? 1,
    };
  }

  private static _createFont(opts: ResolvedBitmapTextOptions): DynamicFont {
    return new DynamicFont({
      fontSize: opts.fontSize,
      fontFamily: opts.fontFamily,
      fontWeight: opts.fontWeight,
      fontStyle: opts.fontStyle,
      width: opts.atlasWidth,
      height: opts.atlasHeight,
      sdf: opts.sdf,
    });
  }

  private static _buildLayoutParams(
    opts: ResolvedBitmapTextOptions,
    dynamicFont: DynamicFont,
  ): TextLayoutParams {
    return {
      font: dynamicFont.fontData,
      text: opts.text,
      width: opts.width,
      mode: opts.mode,
      align: opts.align,
      letterSpacing: opts.letterSpacing,
      lineHeight: opts.lineHeight,
      baseline: opts.baseline,
      centerX: opts.centerX,
      centerY: opts.centerY,
    };
  }

  private static _buildGeometry(geomData: {
    positions: Float32Array;
    uvs: Float32Array;
    sizes: Float32Array;
    indices: number[];
  }): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(geomData.positions, POSITION_COMPONENTS),
    );
    geometry.setAttribute(
      'a_Uv',
      new THREE.BufferAttribute(geomData.uvs, UV_COMPONENTS),
    );
    geometry.setAttribute(
      'a_Size',
      new THREE.BufferAttribute(geomData.sizes, UV_COMPONENTS),
    );
    geometry.setIndex(geomData.indices);
    return geometry;
  }

  private static _buildAtlasData(
    srcBuffer: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBufferLike>,
    sdf: boolean,
  ): Uint8Array<ArrayBuffer> {
    let atlasData: Uint8Array<ArrayBuffer>;
    if (sdf) {
      // SDF: single-channel data → replicate to RGBA (shader reads .r)
      atlasData = new Uint8Array(srcBuffer.length * RGBA_CHANNELS);
      for (let i = 0; i < srcBuffer.length; i++) {
        const v = srcBuffer[i];
        const off = i * RGBA_CHANNELS;
        atlasData[off] = v;
        atlasData[off + 1] = v;
        atlasData[off + 2] = v;
        atlasData[off + POSITION_COMPONENTS] = COLOR_MAX;
      }
    } else {
      // Bitmap: atlas buffer is already RGBA, convert to Uint8Array for DataTexture
      atlasData = new Uint8Array(srcBuffer.length);
      for (let i = 0; i < srcBuffer.length; i++) {
        atlasData[i] = srcBuffer[i];
      }
    }
    return atlasData;
  }

  private static _buildTexture(
    atlasData: Uint8Array<ArrayBuffer>,
    atlasWidth: number,
    atlasHeight: number,
  ): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      atlasData,
      atlasWidth,
      atlasHeight,
      THREE.RGBAFormat,
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    // Canvas2D data is top-down; Three.js needs to flip for correct UV mapping
    texture.flipY = true;
    texture.unpackAlignment = UNPACK_ALIGNMENT;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  private static _buildUniforms(
    opts: ResolvedBitmapTextOptions,
    texture: THREE.DataTexture,
  ): Record<string, THREE.IUniform> {
    const uniforms: Record<string, THREE.IUniform> = {
      u_Color: { value: new THREE.Color(opts.color) },
      u_Opacity: { value: opts.opacity },
      u_DiffuseMap: { value: texture },
      u_Halo: { value: opts.halo },
      u_Gamma: { value: opts.gamma },
      u_Rotation: { value: 0 },
      u_Center: { value: new THREE.Vector2(CENTER_MID, CENTER_MID) },
    };

    if (opts.shadow) {
      uniforms.u_ShadowColor = { value: new THREE.Color(opts.shadowColor) };
      uniforms.u_ShadowOffset = { value: new THREE.Vector2(opts.shadowOffset[0], opts.shadowOffset[1]) };
      uniforms.u_ShadowGamma = { value: opts.shadowGamma };
    }

    if (opts.outline) {
      uniforms.u_OutlineColor = { value: new THREE.Color(opts.outlineColor) };
      uniforms.u_OutlineWidth = { value: opts.outlineWidth };
      uniforms.u_OutlineGamma = { value: opts.outlineGamma };
    }

    return uniforms;
  }
  /* eslint-enable @typescript-eslint/naming-convention */

  private static _buildMaterial(
    opts: ResolvedBitmapTextOptions,
    texture: THREE.DataTexture,
  ): THREE.ShaderMaterial {
    const defines: Record<string, string> = {};
    if (opts.sdf) {
      defines.USE_SDF = '';
    }
    if (opts.shadow) {
      defines.USE_SHADOW = '';
    }
    if (opts.outline) {
      defines.USE_OUTLINE = '';
    }
    if (opts.billboard) {
      defines.USE_BILLBOARD = '';
    }

    const uniforms = BitmapText._buildUniforms(opts, texture);

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      defines,
    });
  }

  /** Strongly-typed access to the internal ShaderMaterial. */
  private get mat(): THREE.ShaderMaterial {
    return this.material as THREE.ShaderMaterial;
  }

  /** The current text string. */
  get text(): string {
    return this._text;
  }

  /** The underlying DynamicFont instance. */
  get font(): DynamicFont {
    return this._dynamicFont;
  }

  /**
   * Update the text content. Rebuilds geometry and updates the font atlas
   * if new characters are encountered.
   *
   * @param text - New text string.
   * @returns this, for chaining.
   */
  setText(text: string): this {
    this._text = text;
    const atlasChanged = this._dynamicFont.addChars(text);

    if (atlasChanged) {
      this._updateAtlasTexture();
    }

    this._rebuildGeometry();
    return this;
  }

  /**
   * Update layout parameters and rebuild geometry.
   *
   * @param params - Partial layout parameters to update.
   * @returns this, for chaining.
   */
  setLayout(params: Partial<
      Pick<
        TextLayoutParams,
        | 'width' | 'mode' | 'align' | 'letterSpacing'
        | 'lineHeight' | 'baseline' | 'centerX' | 'centerY'
      >
    >): this {
    Object.assign(this._layoutParams, params);
    this._rebuildGeometry();
    return this;
  }

  /**
   * Set text color.
   * @param color - New color.
   * @returns this, for chaining.
   */
  setColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.u_Color.value as THREE.Color).set(color);
    return this;
  }

  /**
   * Set opacity.
   * @param opacity - Opacity value (0–1).
   * @returns this, for chaining.
   */
  setOpacity(opacity: number): this {
    this.mat.uniforms.u_Opacity.value = opacity;
    return this;
  }

  /**
   * Set SDF halo threshold.
   * @param halo - Halo value.
   * @returns this, for chaining.
   */
  setHalo(halo: number): this {
    this.mat.uniforms.u_Halo.value = halo;
    return this;
  }

  /**
   * Set SDF gamma smoothing.
   * @param gamma - Gamma value.
   * @returns this, for chaining.
   */
  setGamma(gamma: number): this {
    this.mat.uniforms.u_Gamma.value = gamma;
    return this;
  }

  /**
   * Enable or disable drop shadow.
   * Toggles the `USE_SHADOW` define (recompiles shader on change).
   *
   * @param enabled - Whether to enable shadow.
   * @returns this, for chaining.
   */
  setShadow(enabled: boolean): this {
    if (enabled) {
      this.mat.defines.USE_SHADOW = '';
      // Ensure uniforms exist
      if (!this.mat.uniforms.u_ShadowColor) {
        this.mat.uniforms.u_ShadowColor = { value: new THREE.Color(DEFAULT_SHADOW_COLOR) };
        const offset = new THREE.Vector2(DEFAULT_SHADOW_OFFSET_X, DEFAULT_SHADOW_OFFSET_Y);
        this.mat.uniforms.u_ShadowOffset = { value: offset };
        this.mat.uniforms.u_ShadowGamma = { value: 1 };
      }
    } else {
      delete this.mat.defines.USE_SHADOW;
    }
    this.mat.needsUpdate = true;
    return this;
  }

  /**
   * Set shadow parameters.
   * @param color   - Shadow color.
   * @param offsetX - UV offset X.
   * @param offsetY - UV offset Y.
   * @param gamma   - Shadow gamma.
   * @returns this, for chaining.
   */
  setShadowParams(
    color: THREE.ColorRepresentation,
    offsetX: number,
    offsetY: number,
    gamma: number,
  ): this {
    if (this.mat.uniforms.u_ShadowColor) {
      (this.mat.uniforms.u_ShadowColor.value as THREE.Color).set(color);
    }
    if (this.mat.uniforms.u_ShadowOffset) {
      (this.mat.uniforms.u_ShadowOffset.value as THREE.Vector2).set(offsetX, offsetY);
    }
    if (this.mat.uniforms.u_ShadowGamma) {
      this.mat.uniforms.u_ShadowGamma.value = gamma;
    }
    return this;
  }

  /**
   * Enable or disable outline.
   * Toggles the `USE_OUTLINE` define (recompiles shader on change).
   *
   * @param enabled - Whether to enable outline.
   * @returns this, for chaining.
   */
  setOutline(enabled: boolean): this {
    if (enabled) {
      this.mat.defines.USE_OUTLINE = '';
      if (!this.mat.uniforms.u_OutlineColor) {
        this.mat.uniforms.u_OutlineColor = { value: new THREE.Color(DEFAULT_OUTLINE_COLOR) };
        this.mat.uniforms.u_OutlineWidth = { value: DEFAULT_OUTLINE_WIDTH };
        this.mat.uniforms.u_OutlineGamma = { value: 1 };
      }
    } else {
      delete this.mat.defines.USE_OUTLINE;
    }
    this.mat.needsUpdate = true;
    return this;
  }

  /**
   * Set outline parameters.
   * @param color  - Outline color.
   * @param width  - Outline width (SDF units).
   * @param gamma  - Outline gamma.
   * @returns this, for chaining.
   */
  setOutlineParams(
    color: THREE.ColorRepresentation,
    width: number,
    gamma: number,
  ): this {
    if (this.mat.uniforms.u_OutlineColor) {
      (this.mat.uniforms.u_OutlineColor.value as THREE.Color).set(color);
    }
    if (this.mat.uniforms.u_OutlineWidth) {
      this.mat.uniforms.u_OutlineWidth.value = width;
    }
    if (this.mat.uniforms.u_OutlineGamma) {
      this.mat.uniforms.u_OutlineGamma.value = gamma;
    }
    return this;
  }

  /**
   * Set world-space scale factor.
   * @param scale - Scale multiplier.
   * @returns this, for chaining.
   */
  setScale(scale: number): this {
    this._scale = scale;
    this.scale.setScalar(scale);
    return this;
  }

  /**
   * Release all GPU resources (geometry, material, texture, font atlas).
   */
  dispose(): void {
    this.geometry?.dispose();
    this.mat.dispose();
    (this.mat.uniforms.u_DiffuseMap.value as THREE.DataTexture).dispose();
    this._dynamicFont.dispose();
  }

  /** Rebuild the BufferGeometry from current layout params. */
  private _rebuildGeometry(): void {
    this._layoutParams.font = this._dynamicFont.fontData;
    this._layoutParams.text = this._text;

    const geomData = buildTextGeometry(this._layoutParams);

    // Replace geometry
    this.geometry.dispose();
    const newGeom = BitmapText._buildGeometry(geomData);
    this.geometry = newGeom;
  }

  /** Sync atlas buffer data into the DataTexture and mark for GPU upload. */
  private _updateAtlasTexture(): void {
    const tex = this.mat.uniforms.u_DiffuseMap.value as THREE.DataTexture;
    const src = this._dynamicFont.atlasBuffer;
    const dst = tex.image.data as Uint8Array;

    if (this._sdf) {
      // SDF: single-channel → RGBA
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        const off = i * RGBA_CHANNELS;
        dst[off] = v;
        dst[off + 1] = v;
        dst[off + 2] = v;
        dst[off + POSITION_COMPONENTS] = COLOR_MAX;
      }
    } else {
      // Bitmap: RGBA direct copy
      for (let i = 0; i < src.length; i++) {
        dst[i] = src[i];
      }
    }

    tex.needsUpdate = true;
  }
}

/** Internal resolved options type with all defaults applied. */
interface ResolvedBitmapTextOptions {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  atlasWidth: number;
  atlasHeight: number;
  width: number;
  mode: TextMode;
  align: TextAlign;
  letterSpacing: number;
  lineHeight: number | undefined;
  baseline: number | undefined;
  halo: number;
  gamma: number;
  color: THREE.ColorRepresentation;
  opacity: number;
  shadow: boolean;
  shadowColor: THREE.ColorRepresentation;
  shadowOffset: [number, number];
  shadowGamma: number;
  outline: boolean;
  outlineColor: THREE.ColorRepresentation;
  outlineWidth: number;
  outlineGamma: number;
  billboard: boolean;
  scale: number;
  centerX: number;
  centerY: number;
  sdf: boolean;
}

type TextLayoutUpdateParams = {
  font: FontData;
  text?: string;
  width?: number;
  mode?: TextMode;
  align?: TextAlign;
  letterSpacing?: number;
  lineHeight?: number;
  baseline?: number;
  tabSize?: number;
};

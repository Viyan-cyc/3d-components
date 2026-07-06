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
import { DynamicFont } from '../utils/dynamicFont';
import type { FontData, DynamicFontOptions } from '../utils/dynamicFont';

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

function numVal(n: unknown, def: number): number {
	return typeof n === 'number' ? n : def;
}

function findChar(array: FontData['chars'], id: number): number {
	for (let i = 0; i < array.length; i++) {
		if (array[i].id === id) return i;
	}
	return -1;
}

function getGlyphById(font: FontData, id: number): FontData['chars'][0] | null {
	if (!font.chars || font.chars.length === 0) return null;
	const idx = findChar(font.chars, id);
	return idx >= 0 ? font.chars[idx] : null;
}

function getMGlyph(font: FontData): FontData['chars'][0] | null {
	for (const ch of M_WIDTHS) {
		const idx = findChar(font.chars, ch.charCodeAt(0));
		if (idx >= 0) return font.chars[idx];
	}
	return null;
}

function getXHeight(font: FontData): number {
	for (const ch of X_HEIGHTS) {
		const idx = findChar(font.chars, ch.charCodeAt(0));
		if (idx >= 0) return font.chars[idx].height;
	}
	return 0;
}

function getCapHeight(font: FontData): number {
	for (const ch of CAP_HEIGHTS) {
		const idx = findChar(font.chars, ch.charCodeAt(0));
		if (idx >= 0) return font.chars[idx].height;
	}
	return 0;
}

function getKerning(font: FontData, left: number, right: number): number {
	if (!font.kernings) return 0;
	for (let i = 0; i < font.kernings.length; i++) {
		const k = font.kernings[i];
		if (k.first === left && k.second === right) return k.amount;
	}
	return 0;
}

function getAlignType(align: string | undefined): number {
	if (align === 'center') return ALIGN_CENTER;
	if (align === 'right') return ALIGN_RIGHT;
	return ALIGN_LEFT;
}

// ── Word Wrapping ──

function wordwrap(
	text: string,
	opt: {
		width: number;
		mode?: TextMode;
		measure: (text: string, start: number, end: number, width: number) => LineInfo;
	},
): LineInfo[] {
	if (opt.width === 0 && opt.mode !== 'nowrap') return [];

	const width = typeof opt.width === 'number' ? opt.width : Number.MAX_VALUE;
	const start = 0;
	const end = text.length;
	const mode = opt.mode;
	const measure = opt.measure;

	if (mode === 'pre') {
		return preWrap(measure, text, start, end, width);
	} else {
		return greedy(measure, text, start, end, width, mode);
	}
}

function preWrap(
	measure: (text: string, start: number, end: number, width: number) => LineInfo,
	text: string,
	start: number,
	end: number,
	width: number,
): LineInfo[] {
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
}

function greedy(
	measure: (text: string, start: number, end: number, width: number) => LineInfo,
	text: string,
	start: number,
	end: number,
	width: number,
	mode?: string,
): LineInfo[] {
	const lines: LineInfo[] = [];
	let testWidth = width;
	if (mode === 'nowrap') testWidth = Number.MAX_VALUE;

	let newParagraph = start;

	while (start < end && start < text.length) {
		let newLine = text.indexOf('\n', start);
		if (newLine === -1 || newLine > end) newLine = end;

		// Skip leading whitespace (but not at paragraph start)
		while (start < newLine) {
			if (!whitespaceRe.test(text.charAt(start))) break;
			if (start === newParagraph) break;
			start++;
		}

		newParagraph = newLine + 1;
		const measured = measure(text, start, newLine, testWidth);

		let lineEnd = start + (measured.end - measured.start);
		let nextStart = lineEnd + 1; // +1 for newline char

		// Avoid breaking in the middle of a Latin word
		if (lineEnd < newLine) {
			while (lineEnd > start) {
				if (!letterRe.test(text.charAt(lineEnd))) break;
				lineEnd--;
			}
			if (lineEnd === start) {
				if (nextStart > start + 1) nextStart--;
				lineEnd = nextStart;
			} else {
				nextStart = lineEnd;
				while (lineEnd > start) {
					if (!whitespaceRe.test(text.charAt(lineEnd - 1))) break;
					lineEnd--;
				}
			}
		}

		if (lineEnd >= start) {
			const result = measure(text, start, lineEnd, testWidth);
			lines.push(result);
		}
		start = nextStart;
	}

	return lines;
}

// ── TextLayout ──

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
	private _options: {
		font: FontData;
		text?: string;
		letterSpacing?: number;
		lineHeight?: number;
		baseline?: number;
		width?: number;
		mode?: TextMode;
		align?: TextAlign;
		tabSize?: number;
	} = {} as any;

	get width(): number { return this._width; }
	get height(): number { return this._height; }
	get descender(): number { return this._descender; }
	get ascender(): number { return this._ascender; }
	get xHeight(): number { return this._xHeight; }
	get baseline(): number { return this._baseline; }
	get capHeight(): number { return this._capHeight; }
	get lineHeight(): number { return this._lineHeight; }
	get linesTotal(): number { return this._linesTotal; }
	get lettersTotal(): number { return this._lettersTotal; }
	get wordsTotal(): number { return this._wordsTotal; }

	update(options: {
		font: FontData;
		text?: string;
		width?: number;
		mode?: TextMode;
		align?: TextAlign;
		letterSpacing?: number;
		lineHeight?: number;
		baseline?: number;
		tabSize?: number;
	}): void {
		this._options = { ...options, tabSize: options.tabSize ?? 4 };
		const opt = this._options;
		const font = opt.font;

		this._setupSpaceGlyphs(font);

		const glyphs = this.glyphs;
		const text: string = opt.text || '';

		const lines = wordwrap(text, {
			width: opt.width ?? Number.MAX_VALUE,
			mode: opt.mode,
			measure: this._measure.bind(this),
		});

		const minWidth = opt.width || 0;
		const wordsTotal = text.split(' ').filter((w: string) => w !== '\n').length;
		const lettersTotal = text.split('').filter((c: string) => c !== '\n' && c !== ' ').length;

		glyphs.length = 0;

		const maxLineWidth = lines.reduce((prev, line) => Math.max(prev, line.width, minWidth), 0);

		let x = 0;
		let y = 0;
		const lineHeight = numVal(opt.lineHeight, font.info.size);
		const baseline = numVal(opt.baseline, font.info.size * 0.8);
		const descender = lineHeight - baseline;
		const letterSpacing = opt.letterSpacing || 0;
		const height = lineHeight * lines.length - descender;
		const align = getAlignType(opt.align);

		y = -height;

		this._width = maxLineWidth;
		this._height = height;
		this._descender = descender;
		this._baseline = baseline;
		this._xHeight = getXHeight(font);
		this._capHeight = getCapHeight(font);
		this._lineHeight = lineHeight;
		this._ascender = lineHeight - descender - this._xHeight;

		let wordIndex = 0;
		let letterIndex = 0;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];
			const lineStart = line.start;
			const lineEnd = line.end;
			const lineWidth = line.width;

			const lineWordsTotal = text.slice(lineStart, lineEnd).split(' ').filter((w: string) => w !== '').length;
			const lineLettersTotal = text.slice(lineStart, lineEnd).split(' ').join('').length;
			let lineLetterIndex = 0;
			let lineWordIndex = 0;

			let lastGlyph: FontData['chars'][0] | null = null;

			for (let i = lineStart; i < lineEnd; i++) {
				const id = text.charCodeAt(i);
				const glyph = this._getGlyph(font, id);
				if (!glyph) continue;

				if (lastGlyph) {
					x += getKerning(font, lastGlyph.id, glyph.id);
				}

				let tx = x;
				if (align === ALIGN_CENTER) {
					tx += (maxLineWidth - lineWidth) / 2;
				} else if (align === ALIGN_RIGHT) {
					tx += maxLineWidth - lineWidth;
				}

				glyphs.push({
					position: [tx, y],
					data: glyph,
					index: i,
					lineIndex,
					linesTotal: lines.length,
					lineLettersTotal,
					lineLetterIndex,
					lineWordsTotal,
					lineWordIndex,
					lettersTotal,
					letterIndex,
					wordsTotal,
					wordIndex,
				});

				if (glyph.id === SPACE_ID && (!lastGlyph || lastGlyph.id !== SPACE_ID)) {
					lineWordIndex++;
					wordIndex++;
				}

				if (glyph.id !== SPACE_ID) {
					lineLetterIndex++;
					letterIndex++;
				}

				x += glyph.xadvance + letterSpacing;
				lastGlyph = glyph;
			}

			y += lineHeight;
			x = 0;
		}

		this._lettersTotal = lettersTotal;
		this._wordsTotal = wordsTotal;
		this._linesTotal = lines.length;
	}

	private _getGlyph(font: FontData, id: number): FontData['chars'][0] | null {
		const glyph = getGlyphById(font, id);
		if (glyph) return glyph;
		if (id === TAB_ID) return this._fallbackTabGlyph;
		if (id === SPACE_ID) return this._fallbackSpaceGlyph;
		return null;
	}

	private _measure(text: string, start: number, end: number, width: number): LineInfo {
		const letterSpacing = this._options.letterSpacing || 0;
		const font = this._options.font;
		let curPen = 0;
		let curWidth = 0;
		let count = 0;
		let lastGlyph: FontData['chars'][0] | null = null;

		if (!font.chars || font.chars.length === 0) {
			return { start, end: start, width: 0 };
		}

		end = Math.min(text.length, end);

		for (let i = start; i < end; i++) {
			const id = text.charCodeAt(i);
			const glyph = this._getGlyph(font, id);
			if (!glyph) continue;

			glyph.char = text[i];
			const kern = lastGlyph ? getKerning(font, lastGlyph.id, glyph.id) : 0;
			curPen += kern;

			const nextPen = curPen + glyph.xadvance + letterSpacing;
			const nextWidth = curPen + glyph.width;

			if (nextWidth >= width || nextPen >= width) break;

			curPen = nextPen;
			curWidth = nextWidth;
			lastGlyph = glyph;
			count++;
		}

		if (lastGlyph) curWidth += lastGlyph.xoffset;

		return { start, end: start + count, width: curWidth };
	}

	private _setupSpaceGlyphs(font: FontData): void {
		this._fallbackSpaceGlyph = null;
		this._fallbackTabGlyph = null;

		if (!font.chars || font.chars.length === 0) return;

		const space = getGlyphById(font, SPACE_ID) || getMGlyph(font) || font.chars[0];
		const tabWidth = (this._options.tabSize ?? 4) * space.xadvance;
		this._fallbackSpaceGlyph = space;
		this._fallbackTabGlyph = { ...space, x: 0, y: 0, xadvance: tabWidth, id: TAB_ID, xoffset: 0, yoffset: 0, width: 0, height: 0 };
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

function buildTextGeometry(params: TextLayoutParams): {
	positions: Float32Array;
	uvs: Float32Array;
	sizes: Float32Array;
	indices: number[];
	layout: TextLayout;
} {
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

	const font = params.font;
	const texWidth = font.common.scaleW;
	const texHeight = font.common.scaleH;

	const visibleGlyphs = layout.glyphs.filter(g => {
		const bitmap = g.data;
		return bitmap.width * bitmap.height > 0;
	});

	const count = visibleGlyphs.length;
	const positions = new Float32Array(count * 4 * 3);
	const uvs = new Float32Array(count * 4 * 2);
	const sizes = new Float32Array(count * 4 * 2);
	const indices: number[] = [];

	let pi = 0;
	let ui = 0;
	let si = 0;

	for (let gi = 0; gi < count; gi++) {
		const glyph = visibleGlyphs[gi];
		const bitmap = glyph.data;

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

		// Positions (Y negated to match t3d.js convention)
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

		// Size (normalized by fontSize for shader anti-aliasing)
		const fontSize = font.info.size;
		// BL
		sizes[si++] = 0; sizes[si++] = 0;
		// TL
		sizes[si++] = 0; sizes[si++] = h / fontSize;
		// TR
		sizes[si++] = w / fontSize; sizes[si++] = h / fontSize;
		// BR
		sizes[si++] = w / fontSize; sizes[si++] = 0;

		// Indices (2 triangles per quad)
		const base = gi * 4;
		indices.push(
			base + 0, base + 1, base + 2,
			base + 0, base + 2, base + 3,
		);
	}

	// Apply center offset
	const centerX = params.centerX ?? 0.5;
	const centerY = params.centerY ?? 0.5;

	if (centerX !== 0 || centerY !== 0) {
		// Compute bounding box
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let i = 0; i < positions.length; i += 3) {
			const px = positions[i];
			const py = positions[i + 1];
			if (px < minX) minX = px;
			if (px > maxX) maxX = px;
			if (py < minY) minY = py;
			if (py > maxY) maxY = py;
		}

		const xOffset = (maxX - minX) * centerX;
		const yOffset = (maxY - minY) * centerY;

		for (let i = 0; i < positions.length; i += 3) {
			positions[i] -= xOffset;
			positions[i + 1] -= yOffset;
		}
	}

	return { positions, uvs, sizes, indices, layout };
}

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
 * import { BitmapText } from '@cyc/3d-components/core';
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
		const {
			text = '',
			fontSize = 72,
			fontFamily = 'sans-serif',
			fontWeight = 'normal',
			fontStyle = 'normal',
			atlasWidth = 2048,
			atlasHeight = 2048,
			width = 1000,
			mode = 'word-wrapper',
			align = 'left',
			letterSpacing = 0,
			lineHeight,
			baseline,
			halo = 0.75,
			gamma = 1,
			color = 0xffffff,
			opacity = 1,
			shadow = false,
			shadowColor = 0x4d4d4d,
			shadowOffset = [0.001, -0.001] as [number, number],
			shadowGamma = 1,
			outline = false,
			outlineColor = 0xff0000,
			outlineWidth = 0.05,
			outlineGamma = 1,
			billboard = false,
			scale = 0.01,
			centerX = 0.5,
			centerY = 0.5,
		} = options;

		// Create DynamicFont
		const sdf = true;
		const dynamicFont = new DynamicFont({
			fontSize,
			fontFamily,
			fontWeight,
			fontStyle,
			width: atlasWidth,
			height: atlasHeight,
			sdf,
		});
		dynamicFont.addChars(text);

		// Build defines
		const defines: Record<string, string> = {};
		if (sdf) defines.USE_SDF = '';
		if (shadow) defines.USE_SHADOW = '';
		if (outline) defines.USE_OUTLINE = '';
		if (billboard) defines.USE_BILLBOARD = '';

		// Build geometry
		const layoutParams: TextLayoutParams = {
			font: dynamicFont.fontData,
			text,
			width,
			mode,
			align,
			letterSpacing,
			lineHeight,
			baseline,
			centerX,
			centerY,
		};

		const geomData = buildTextGeometry(layoutParams);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(geomData.positions, 3));
		geometry.setAttribute('a_Uv', new THREE.BufferAttribute(geomData.uvs, 2));
		geometry.setAttribute('a_Size', new THREE.BufferAttribute(geomData.sizes, 2));
		geometry.setIndex(geomData.indices);

		// Build texture — use RGBA format for maximum WebGL compatibility.
		let atlasData: Uint8Array<ArrayBuffer>;
		if (sdf) {
			// SDF: single-channel data → replicate to RGBA (shader reads .r)
			const singleChannel = dynamicFont.atlasBuffer;
			atlasData = new Uint8Array(atlasWidth * atlasHeight * 4);
			for (let i = 0; i < singleChannel.length; i++) {
				const v = singleChannel[i];
				const off = i * 4;
				atlasData[off] = v;
				atlasData[off + 1] = v;
				atlasData[off + 2] = v;
				atlasData[off + 3] = 255;
			}
		} else {
			// Bitmap: atlas buffer is already RGBA, convert to Uint8Array for DataTexture
			const src = dynamicFont.atlasBuffer;
			atlasData = new Uint8Array(src.length);
			for (let i = 0; i < src.length; i++) atlasData[i] = src[i];
		}
		const texture = new THREE.DataTexture(
			atlasData,
			atlasWidth,
			atlasHeight,
			THREE.RGBAFormat,
		);
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = THREE.LinearFilter;
		texture.flipY = true; // Canvas2D data is top-down; Three.js needs to flip for correct UV mapping
		texture.unpackAlignment = 4;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;

		// Build material
		const material = new THREE.ShaderMaterial({
			uniforms: {
				u_Color: { value: new THREE.Color(color) },
				u_Opacity: { value: opacity },
				u_DiffuseMap: { value: texture },
				u_Halo: { value: halo },
				u_Gamma: { value: gamma },
				u_Rotation: { value: 0 },
				u_Center: { value: new THREE.Vector2(0.5, 0.5) },
				...(shadow ? {
					u_ShadowColor: { value: new THREE.Color(shadowColor) },
					u_ShadowOffset: { value: new THREE.Vector2(shadowOffset[0], shadowOffset[1]) },
					u_ShadowGamma: { value: shadowGamma },
				} : {}),
				...(outline ? {
					u_OutlineColor: { value: new THREE.Color(outlineColor) },
					u_OutlineWidth: { value: outlineWidth },
					u_OutlineGamma: { value: outlineGamma },
				} : {}),
			},
			vertexShader,
			fragmentShader,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			defines,
		});

		super(geometry, material);

		// Enable GL_OES_standard_derivatives for fwidth() in fragment shader
		((this.material as THREE.ShaderMaterial).extensions as Record<string, boolean>).derivatives = true;

		this._dynamicFont = dynamicFont;
		this._layoutParams = layoutParams;
		this._scale = scale;
		this._sdf = sdf;
		this._text = text;

		this.frustumCulled = false; // prevent culling — geometry coords are in font space
		this.scale.setScalar(scale);

		if (options.name) this.name = options.name;
		if (options.visible !== undefined) this.visible = options.visible;
		if (options.userData) this.userData = { ...options.userData };
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
	setLayout(params: Partial<Pick<TextLayoutParams, 'width' | 'mode' | 'align' | 'letterSpacing' | 'lineHeight' | 'baseline' | 'centerX' | 'centerY'>>): this {
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
				this.mat.uniforms.u_ShadowColor = { value: new THREE.Color(0x4d4d4d) };
				this.mat.uniforms.u_ShadowOffset = { value: new THREE.Vector2(0.001, -0.001) };
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
	setShadowParams(color: THREE.ColorRepresentation, offsetX: number, offsetY: number, gamma: number): this {
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
				this.mat.uniforms.u_OutlineColor = { value: new THREE.Color(0xff0000) };
				this.mat.uniforms.u_OutlineWidth = { value: 0.05 };
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
	setOutlineParams(color: THREE.ColorRepresentation, width: number, gamma: number): this {
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
		const newGeom = new THREE.BufferGeometry();
		newGeom.setAttribute('position', new THREE.BufferAttribute(geomData.positions, 3));
		newGeom.setAttribute('a_Uv', new THREE.BufferAttribute(geomData.uvs, 2));
		newGeom.setAttribute('a_Size', new THREE.BufferAttribute(geomData.sizes, 2));
		newGeom.setIndex(geomData.indices);
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
				const off = i * 4;
				dst[off] = v;
				dst[off + 1] = v;
				dst[off + 2] = v;
				dst[off + 3] = 255;
			}
		} else {
			// Bitmap: RGBA direct copy
			for (let i = 0; i < src.length; i++) dst[i] = src[i];
		}

		tex.needsUpdate = true;
	}
}

/**
 * DynamicFont — generates a font atlas with SDF (Signed Distance Field) glyphs
 * at runtime using Canvas 2D text rendering.
 *
 * No external font files or plugins required. Characters are rasterized via
 * `CanvasRenderingContext2D.fillText`, then converted to SDF via
 * {@link DistanceTransform}, and packed into a single atlas texture.
 *
 * Ported from t3d.js DynamicFont and translated to Three.js conventions.
 *
 * @module utils/dynamic-font
 */

import { DistanceTransform } from './distanceTransform';

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
	private _available: number[];

	constructor(max: number) {
		this._available = [];
		this.reset(max);
	}

	canAllocate(): boolean {
		return this._available.length > 0;
	}

	allocate(): number {
		return this._available.pop()!;
	}

	free(index: number): void {
		this._available.push(index);
	}

	reset(max: number): void {
		this._available = Array.from({ length: max }, (_, i) => i).reverse();
	}
}

// ────────────────────────────── FontAtlas ─────────────────────────────────

class FontAtlas {
	readonly width: number;
	readonly height: number;

	private _charSize: number;
	private _maxCol: number;
	private _indexManager: IndexManager;
	private _fontMap: Map<string, { i: number; x: number; y: number; w: number; h: number }>;
	private _buffer: Uint8ClampedArray;
	private _sdf: boolean;

	constructor(width: number, height: number, charSize: number, sdf: boolean) {
		this.width = width;
		this.height = height;
		this._charSize = charSize;
		this._maxCol = Math.floor(width / charSize);
		this._indexManager = new IndexManager(Math.floor(width / charSize) * Math.floor(height / charSize));
		this._fontMap = new Map();
		this._buffer = new Uint8ClampedArray(width * height * (sdf ? 1 : 4));
		this._sdf = sdf;
	}

	addChar(
		char: string,
		origin: { buffer: Uint8ClampedArray; width: number; height: number },
	): boolean {
		if (!this._indexManager.canAllocate()) return false;

		const writeIndex = this._indexManager.allocate();
		const charInfo = {
			i: writeIndex,
			x: (writeIndex % this._maxCol) * this._charSize,
			y: Math.floor(writeIndex / this._maxCol) * this._charSize,
			w: origin.width,
			h: origin.height,
		};
		this._fontMap.set(char, charInfo);

		const { buffer, width, height } = origin;
		const sdf = this._sdf;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const targetIndex = (charInfo.x + x) + (charInfo.y + y) * this.width;
				const sourceIndex = x + y * width;
				if (sdf) {
					// R2R: single-channel copy
					this._buffer[targetIndex] = buffer[sourceIndex];
				} else {
					// RGBA2RGBA: 4-channel copy
					const si4 = sourceIndex * 4;
					const ti4 = targetIndex * 4;
					this._buffer[ti4] = buffer[si4];
					this._buffer[ti4 + 1] = buffer[si4 + 1];
					this._buffer[ti4 + 2] = buffer[si4 + 2];
					this._buffer[ti4 + 3] = buffer[si4 + 3];
				}
			}
		}

		return true;
	}

	hasChar(char: string): boolean {
		return this._fontMap.has(char);
	}

	getChar(char: string): { x: number; y: number; w: number; h: number } | undefined {
		return this._fontMap.get(char);
	}

	clear(): void {
		this._fontMap.clear();
		this._indexManager.reset(
			Math.floor(this.width / this._charSize) * Math.floor(this.height / this._charSize),
		);
		this._buffer.fill(0);
	}

	get buffer(): Uint8ClampedArray {
		return this._buffer;
	}
}

// ────────────────────────────── CharacterCanvas ───────────────────────────

class CharacterCanvas {
	readonly size: number;
	readonly padding: number;

	private _distanceRadius: number;
	private _distanceCutoff: number;
	private _ctx: CanvasRenderingContext2D;
	private _dt: DistanceTransform | null;

	constructor(options: {
		fontSize: number;
		fontFamily: string;
		fontWeight: string;
		fontStyle: string;
		sdf: boolean;
	}) {
		const { fontSize, fontFamily, fontWeight, fontStyle, sdf } = options;

		const padding = Math.floor((fontSize / 24) * 3);
		const size = fontSize + padding * 4;

		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;

		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'left';
		ctx.fillStyle = sdf ? 'black' : 'white';

		this.size = size;
		this.padding = padding;
		this._distanceRadius = Math.floor((fontSize / 24) * 8);
		this._distanceCutoff = 0.25;
		this._ctx = ctx;
		this._dt = sdf ? new DistanceTransform(size * size, size) : null;
	}

	draw(char: string): {
		buffer: Uint8ClampedArray;
		width: number;
		height: number;
		padding: number;
		glyphTop: number;
	} {
		const { size, padding, _distanceRadius, _distanceCutoff, _ctx, _dt } = this;

		const metrics = _ctx.measureText(char);
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
			glyphWidth = Math.floor(size / 2 - padding * 2);
			glyphHeight = 0;
		}

		const width = Math.min(glyphWidth + 2 * padding, size);
		const height = Math.min(glyphHeight + 2 * padding, size);

		_ctx.clearRect(0, 0, width, height);
		_ctx.fillText(char, padding, padding + glyphTop);

		const imageData = _ctx.getImageData(0, 0, width, height);

		let buffer: Uint8ClampedArray;
		if (_dt) {
			const result = _dt.transform(imageData, {
				radius: _distanceRadius,
				cutoff: _distanceCutoff,
			});
			if (!result) {
				buffer = new Uint8ClampedArray(imageData.data);
			} else {
				buffer = new Uint8ClampedArray(result);
			}
		} else {
			buffer = new Uint8ClampedArray(imageData.data);
		}

		return { buffer, width, height, padding, glyphTop };
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
	private _charCanvas: CharacterCanvas;
	private _fontAtlas: FontAtlas;
	private _font: FontData;

	/**
	 * @param options - Configuration options, all optional.
	 */
	constructor(options: DynamicFontOptions = {}) {
		const {
			fontSize = 72,
			width = 2048,
			height = 2048,
			fontFamily = 'sans-serif',
			fontWeight = 'normal',
			fontStyle = 'normal',
			sdf = true,
		} = options;

		this._charCanvas = new CharacterCanvas({
			fontSize,
			fontFamily,
			fontWeight,
			fontStyle,
			sdf,
		});

		this._fontAtlas = new FontAtlas(
			width,
			height,
			this._charCanvas.size,
			sdf,
		);

		this._font = {
			common: { scaleW: width, scaleH: height },
			info: { size: fontSize },
			chars: [],
		};
	}

	/** Font metrics data (atlas dimensions, glyph positions, etc.). */
	get fontData(): FontData {
		return this._font;
	}

	/** Single-channel (SDF) or RGBA (bitmap) atlas pixel buffer. */
	get atlasBuffer(): Uint8ClampedArray {
		return this._fontAtlas.buffer;
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

		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];
			if (!this._fontAtlas.hasChar(char)) {
				if (this._addChar(char)) {
					modified = true;
				} else {
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
		this._fontAtlas.clear();
		this._font.chars.length = 0;
	}

	private _addChar(char: string): boolean {
		const { _charCanvas, _fontAtlas, _font } = this;

		const { buffer, width, height, padding, glyphTop } = _charCanvas.draw(char);

		const succeeded = _fontAtlas.addChar(char, { buffer, width, height });
		if (!succeeded) return false;

		const charInfo = _fontAtlas.getChar(char)!;

		// 'j' scaler to avoid zero-width artifacts (ported from t3d.js)
		const scaler = char === 'j' ? 0.00001 : 1;

		_font.chars.push({
			char,
			id: char.charCodeAt(0),
			x: charInfo.x + padding * scaler,
			y: charInfo.y + padding * scaler,
			width: charInfo.w - padding * 2 * scaler,
			height: charInfo.h - padding * 2 * scaler,
			xoffset: 0,
			yoffset: -glyphTop,
			xadvance: charInfo.w - padding * 2 * scaler,
		});

		return true;
	}
}

import type { ColorRGBA } from '../types';

// ─── Color constants ────────────────────────────────────────────────────────

/** Bit shift for extracting the red channel from a 24-bit hex value. */
const HEX_SHIFT_RED = 16;

/** Bit shift for extracting the green channel from a 24-bit hex value. */
const HEX_SHIFT_GREEN = 8;

/** Maximum value of a single color channel (0–255 range). */
const MAX_CHANNEL = 255;

/** Number of hue segments in HSL color space. */
const HUE_SEGMENTS = 6;

/** Fraction: 1/6 — one hue segment width. */
const HUE_SEGMENT_WIDTH = 1 / HUE_SEGMENTS;

/** Fraction: 1/2 — midpoint threshold in hue-to-RGB conversion. */
const HUE_MIDPOINT = 1 / 2;

/** Fraction: 2/3 — upper threshold in hue-to-RGB conversion. */
const HUE_UPPER_THRESHOLD = 2 / HUE_SEGMENTS;

/** Fraction: 1/3 — hue offset for adjacent RGB channels. */
const HUE_OFFSET = 1 / HUE_SEGMENTS;

/** Hex shorthand length (e.g. "#f00"). */
const SHORT_HEX_LENGTH = 3;

/** Radix for parsing hexadecimal numbers. */
const HEX_RADIX = 16;

/** Minimum hex string length after padding. */
const HEX_PAD_LENGTH = 2;

// ─── Conversion functions ────────────────────────────────────────────────────

/**
 * Convert a hex color string to an RGB(A) object with normalized channels (0–1).
 *
 * Supports both 3-digit shorthand (`"#f00"`) and full 6-digit (`"#ff0000"` or `"ff0000"`) formats.
 *
 * @param hex - Hex color string (e.g. `"#ff0000"`, `"#f00"`, or `"ff0000"`).
 * @returns An object with `r`, `g`, `b` channels normalized to 0–1.
 *
 * @example
 * ```ts
 * Util.hexToRgb('#ff0000');  // → { r: 1, g: 0, b: 0 }
 * Util.hexToRgb('#f00');     // → { r: 1, g: 0, b: 0 }
 * Util.hexToRgb('3366ff');   // → { r: 0.2, g: 0.4, b: 1 }
 * ```
 */
export const hexToRgb = (hex: string): ColorRGBA => {
  let h = hex.replace('#', '');
  if (h.length === SHORT_HEX_LENGTH) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, HEX_RADIX);
  return {
    r: ((num >> HEX_SHIFT_RED) & MAX_CHANNEL) / MAX_CHANNEL,
    g: ((num >> HEX_SHIFT_GREEN) & MAX_CHANNEL) / MAX_CHANNEL,
    b: (num & MAX_CHANNEL) / MAX_CHANNEL,
  };
};

/**
 * Convert RGB values (0–255) to a hex color string.
 *
 * Values outside 0–255 are clamped. Returns a lowercase `#rrggbb` string.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns Hex color string (e.g. `"#ff3366"`).
 *
 * @example
 * ```ts
 * Util.rgbToHex(255, 0, 0);      // → "#ff0000"
 * Util.rgbToHex(51, 102, 255);   // → "#3366ff"
 * Util.rgbToHex(0, 0, 0);        // → "#000000"
 * ```
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(MAX_CHANNEL, Math.round(n)));
    return clamped.toString(HEX_RADIX).padStart(HEX_PAD_LENGTH, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Convert an HSL color to an RGB(A) object with normalized channels (0–1).
 *
 * All input and output values are in the range 0–1.
 *
 * @param h - Hue (0–1). Values wrap around (1.5 becomes 0.5).
 * @param s - Saturation (0–1). Clamped.
 * @param l - Lightness (0–1). Clamped.
 * @returns An object with `r`, `g`, `b` channels normalized to 0–1.
 *
 * @example
 * ```ts
 * Util.hslToRgb(0, 1, 0.5);     // → { r: 1, g: 0, b: 0 } (red)
 * Util.hslToRgb(0.33, 1, 0.5);  // → { r: 0, g: 1, b: 0 } (green)
 * Util.hslToRgb(0.6, 0.8, 0.6); // → light blue
 * ```
 */
export const hslToRgb = (h: number, s: number, l: number): ColorRGBA => {
  let hn = ((h % 1) + 1) % 1;
  let sn = Math.max(0, Math.min(1, s));
  let ln = Math.max(0, Math.min(1, l));

  if (sn === 0) {
    return { r: ln, g: ln, b: ln };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) {
      tt += 1;
    }
    if (tt > 1) {
      tt -= 1;
    }
    if (tt < HUE_SEGMENT_WIDTH) {
      return p + (q - p) * HUE_SEGMENTS * tt;
    }
    if (tt < HUE_MIDPOINT) {
      return q;
    }
    if (tt < HUE_UPPER_THRESHOLD) {
      return p + (q - p) * (HUE_UPPER_THRESHOLD - tt) * HUE_SEGMENTS;
    }
    return p;
  };

  const q = ln < HUE_MIDPOINT ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;

  return {
    r: hue2rgb(p, q, hn + HUE_OFFSET),
    g: hue2rgb(p, q, hn),
    b: hue2rgb(p, q, hn - HUE_OFFSET),
  };
};

/**
 * Blend (lerp) between two RGBA colors by a factor `t`.
 *
 * Each channel is independently interpolated. When `t = 0`, returns `a`.
 * When `t = 1`, returns `b`. The alpha channel defaults to 1 if absent.
 *
 * @param a - Start color.
 * @param b - End color.
 * @param t - Blend factor (0 → `a`, 1 → `b`). Clamped to [0, 1].
 * @returns The blended color with `r`, `g`, `b`, `a` channels.
 *
 * @example
 * ```ts
 * const red  = { r: 1, g: 0, b: 0 };
 * const blue = { r: 0, g: 0, b: 1 };
 * Util.blendColors(red, blue, 0.5);  // → { r: 0.5, g: 0, b: 0.5, a: 1 }
 * ```
 */
export const blendColors = (a: ColorRGBA, b: ColorRGBA, t: number): ColorRGBA => {
  const u = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
    a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * u,
  };
};

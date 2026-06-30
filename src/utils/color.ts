import type { ColorRGBA } from '../types';

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
export function hexToRgb(hex: string): ColorRGBA {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

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
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

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
export function hslToRgb(h: number, s: number, l: number): ColorRGBA {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  if (s === 0) return { r: l, g: l, b: l };

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

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
export function blendColors(a: ColorRGBA, b: ColorRGBA, t: number): ColorRGBA {
  const u = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
    a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * u,
  };
}

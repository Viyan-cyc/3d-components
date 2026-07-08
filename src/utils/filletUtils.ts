/**
 * @internal
 *
 * Shared 2D polyline fillet / rounding utilities used by Wall and Shape.
 * Extracted to avoid code duplication between components.
 */
import * as THREE from 'three';

/** A 3D coordinate tuple, e.g. `[x, y, z]`. */
export type Vec3Tuple = [number, number, number];

/** 2D point used internally. */
export type V2 = THREE.Vector2;

export const EPS = 1e-6;

// ===================== dedupe =====================

/** Remove consecutive duplicate points (within EPS). */
export function dedupe(input: V2[]): V2[] {
  const out: V2[] = [];
  for (const p of input) {
    const last = out[out.length - 1];
    if (!last || last.distanceTo(p) > EPS) out.push(p);
  }
  return out;
}

// ===================== radius helpers =====================

/** Resolve a per-vertex radius from either a scalar or an array (missing → 0). */
export function radiusAt(radius: number | number[], i: number): number {
  return Array.isArray(radius) ? radius[i] ?? 0 : radius;
}

/**
 * Resolve a per-vertex radius with a global fallback.
 * - If `radius` is a scalar, return it directly (it IS the global value).
 * - If `radius` is an array, return `radius[i]` if defined, otherwise `globalRadius`.
 */
export function radiusAtWithDefault(radius: number | (number | undefined)[], globalRadius: number, i: number): number {
  if (Array.isArray(radius)) {
    const v = radius[i];
    return v !== undefined ? v : globalRadius;
  }
  return radius;
}

// ===================== corner rounding =====================

/** Rounded corner arc between two segments (or null if straight / degenerate). */
export interface Corner {
  t1: V2;
  t2: V2;
  center: V2;
  rEff: number;
  a1: number;
  delta: number;
}

export function computeCorner(prev: V2, cur: V2, next: V2, r: number): Corner | null {
  const d1x = cur.x - prev.x;
  const d1y = cur.y - prev.y;
  const d2x = next.x - cur.x;
  const d2y = next.y - cur.y;
  const len1 = Math.hypot(d1x, d1y);
  const len2 = Math.hypot(d2x, d2y);
  if (len1 <= EPS || len2 <= EPS) return null;
  const u1x = d1x / len1;
  const u1y = d1y / len1;
  const u2x = d2x / len2;
  const u2y = d2y / len2;
  const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
  if (dot > 0.999999) return null;
  const cross = u1x * u2y - u1y * u2x;
  const turnSign = cross >= 0 ? 1 : -1;
  const alpha = Math.acos(dot);
  let t = r * Math.tan(alpha / 2);
  const maxT = Math.min(len1, len2) * 0.5;
  if (t > maxT) t = maxT;
  if (t <= EPS) return null;
  const rEff = t / Math.tan(alpha / 2);
  const t1 = new THREE.Vector2(cur.x - u1x * t, cur.y - u1y * t);
  const t2 = new THREE.Vector2(cur.x + u2x * t, cur.y + u2y * t);
  const cx = t1.x - u1y * turnSign * rEff;
  const cy = t1.y + u1x * turnSign * rEff;
  return { t1, t2, center: new THREE.Vector2(cx, cy), rEff, a1: Math.atan2(t1.y - cy, t1.x - cx), delta: turnSign * alpha };
}

/** Round the corners of a polyline into a dense point list. */
export function filletPolyline(input: V2[], radius: number | number[], segments: number, close: boolean): V2[] {
  const pts = dedupe(input);
  const n = pts.length;
  if (n < 2) return pts.map((p) => p.clone());
  const seg = Math.max(1, Math.floor(segments));
  const out: V2[] = [];
  const handle = (i: number, prev: V2, cur: V2, next: V2) => {
    const c = computeCorner(prev, cur, next, Math.max(0, radiusAt(radius, i)));
    if (!c) {
      out.push(cur.clone());
      return;
    }
    out.push(c.t1);
    for (let k = 1; k < seg; k++) {
      const a = c.a1 + (c.delta * k) / seg;
      out.push(new THREE.Vector2(c.center.x + c.rEff * Math.cos(a), c.center.y + c.rEff * Math.sin(a)));
    }
    out.push(c.t2);
  };
  if (close && n >= 3) {
    for (let i = 0; i < n; i++) handle(i, pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
  } else {
    out.push(pts[0].clone());
    for (let i = 1; i < n - 1; i++) handle(i, pts[i - 1], pts[i], pts[i + 1]);
    out.push(pts[n - 1].clone());
  }
  return out;
}

// ===================== winding / contour =====================

export function signedArea(poly: V2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ensureCCW(poly: V2[]): void {
  if (signedArea(poly) < 0) poly.reverse();
}

export function ensureCW(poly: V2[]): void {
  if (signedArea(poly) > 0) poly.reverse();
}

export function traceContour(path: THREE.Path | THREE.Shape, poly: V2[]): void {
  if (poly.length === 0) return;
  path.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x, poly[i].y);
  path.closePath();
}

// ===================== coordinate conversion =====================

/** Convert a path point into 2D shape space (x, -z) so extrude + rotateX lands in the XZ plane. */
export function toShape2D(p: Vec3Tuple): V2 {
  return new THREE.Vector2(p[0], -p[2]);
}

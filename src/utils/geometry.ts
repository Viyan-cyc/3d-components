import type { Vec3 } from '../types';

/**
 * Create a 2D grid of points on the XY plane, centered at the origin.
 *
 * Points are arranged row-by-row with uniform spacing.
 * The grid is centered such that its bounding box is centered at (0, 0, 0).
 *
 * @param rows - Number of rows (Y direction).
 * @param cols - Number of columns (X direction).
 * @param spacing - Distance between adjacent points in both X and Y.
 * @returns Array of points (length = `rows × cols`).
 *
 * @example
 * ```ts
 * // 3×3 grid with 1-unit spacing
 * const grid = Util.createGrid(3, 3, 1);
 * // grid.length === 9
 * // Points span from (-1, -1, 0) to (1, 1, 0)
 *
 * // Use with THREE.BufferGeometry:
 * const positions = new Float32Array(
 *   grid.flatMap(p => [p.x, p.y, p.z])
 * );
 * ```
 */
export function createGrid(
  rows: number,
  cols: number,
  spacing: number,
): Vec3[] {
  const points: Vec3[] = [];
  const offsetX = ((cols - 1) * spacing) / 2;
  const offsetY = ((rows - 1) * spacing) / 2;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      points.push({
        x: j * spacing - offsetX,
        y: i * spacing - offsetY,
        z: 0,
      });
    }
  }
  return points;
}

/**
 * Create points arranged evenly on a circle in the XY plane.
 *
 * Points are distributed counter-clockwise starting from (radius, 0, 0).
 *
 * @param radius - Radius of the circle in world units.
 * @param segments - Number of points (higher = smoother circle).
 * @returns Array of points forming a circle.
 *
 * @example
 * ```ts
 * const circle = Util.createCircle(2, 100);
 * // 100 points on a circle of radius 2
 *
 * // Render as a line loop:
 * const geo = new THREE.BufferGeometry();
 * geo.setFromPoints(circle.map(p => new THREE.Vector3(p.x, p.y, p.z)));
 * const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
 * ```
 */
export function createCircle(radius: number, segments: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: 0,
    });
  }
  return points;
}

/**
 * Create points evenly distributed on the surface of a sphere.
 *
 * Uses the **Fibonacci sphere algorithm** for near-uniform distribution
 * of points on the sphere surface. Much better than latitude/longitude
 * gridding which concentrates points at the poles.
 *
 * @param radius - Radius of the sphere in world units.
 * @param count - Number of points on the sphere surface.
 * @returns Array of points distributed on the sphere.
 *
 * @example
 * ```ts
 * const sphere = Util.createSphere(2, 500);
 * // 500 points on a sphere of radius 2
 *
 * // Render as a point cloud:
 * const geo = new THREE.BufferGeometry();
 * const pos = new Float32Array(sphere.flatMap(p => [p.x, p.y, p.z]));
 * geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
 * const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.05 }));
 * ```
 */
export function createSphere(radius: number, count: number): Vec3[] {
  const points: Vec3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;

    points.push({
      x: Math.cos(theta) * radiusAtY * radius,
      y: y * radius,
      z: Math.sin(theta) * radiusAtY * radius,
    });
  }
  return points;
}

/**
 * Create points forming an Archimedean spiral on the XY plane.
 *
 * The spiral starts at the origin and expands outward as it rotates.
 * Each full rotation has `pointsPerTurn` points.
 *
 * @param turns - Number of full rotations from center to edge.
 * @param pointsPerTurn - Number of sample points per full rotation.
 * @param radius - Maximum radius at the outer edge.
 * @returns Array of points (length = `turns × pointsPerTurn`).
 *
 * @example
 * ```ts
 * const spiral = Util.createSpiral(5, 60, 3);
 * // 300 points forming 5 turns, max radius 3
 * ```
 */
export function createSpiral(
  turns: number,
  pointsPerTurn: number,
  radius: number,
): Vec3[] {
  const total = turns * pointsPerTurn;
  const points: Vec3[] = [];
  for (let i = 0; i < total; i++) {
    const t = i / total;
    const angle = t * Math.PI * 2 * turns;
    const r = t * radius;
    points.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      z: 0,
    });
  }
  return points;
}

/**
 * @module graph/layouts/util
 *
 * 布局层内部纯函数工具（零 Three.js 运行时依赖，仅本地使用，不导出至 barrel）。
 *
 * 这里集中放置 2D→3D 平面映射等所有布局算法共享的纯计算逻辑，
 * 使各布局文件只关注自身算法本体。
 */

import type { BaseLayoutConfig } from './types';

/** 三维坐标（局部计算用，轻量结构，避免引入 {@link NodePos3D} 的 id 字段）。 */
interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * 把「本质 2D 的布局结果」`(x2, y2)` 按 `plane` 映射到三维空间，并在被忽略的轴上叠加 `depth`。
 *
 * - `plane: 'xy'` → `(x2, y2, depth)`，被忽略轴为 z；
 * - `plane: 'xz'` → `(x2, depth, y2)`，被忽略轴为 y。
 *
 * @param x2 - 2D 计算结果的 x。
 * @param y2 - 2D 计算结果的 y。
 * @param plane - 映射平面。
 * @param depth - 在被忽略轴上的偏移量（由 `depthOffset + layerIndex*layerSpacing` 计算后传入）。
 * @returns 三维坐标。
 */
export function mapToPlane2D(
  x2: number,
  y2: number,
  plane: 'xy' | 'xz',
  depth: number,
): XYZ {
  return plane === 'xy' ? { x: x2, y: y2, z: depth } : { x: x2, y: depth, z: y2 };
}

/**
 * 从 {@link BaseLayoutConfig} 解析 plane 默认值（缺省 `'xz'`）。
 */
export function resolvePlane(cfg: BaseLayoutConfig | undefined): 'xy' | 'xz' {
  return cfg?.plane ?? 'xz';
}

/**
 * 计算某层在被忽略轴上的深度：`depthOffset + layerIndex * layerSpacing`。
 *
 * @param cfg - 公共基类配置。
 * @param layerIndex - 该节点所属层级（分组/同心环索引）。
 */
export function resolveDepth(cfg: BaseLayoutConfig | undefined, layerIndex: number): number {
  return (cfg?.depthOffset ?? 0) + layerIndex * (cfg?.layerSpacing ?? 0);
}

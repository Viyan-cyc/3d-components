/**
 * @module graph/layouts/grid
 *
 * 网格布局 —— 纯函数，零 Three.js 运行时依赖。
 *
 * 行 / 列 / 层三维网格：节点按下标行优先填充，`col → x`、`row → z`、`level → y`，整体居中于原点。
 *
 * 本质为 3D 布局（无被忽略轴），故 {@link GridLayoutConfig.plane} / `depthOffset` / `layerSpacing`
 * 均为 **no-op**（与 `force` 的 `dimensions: 3` 一致）—— 间距改由 `spacingX` / `spacingY` / `spacingZ`
 * 精细控制；`rows` / `cols` / `levels` 任一缺省时自动推算以铺满规则网格。
 *
 * 坐标恒有限（仅含乘减运算）。
 */

import type { NodeData, NodePos3D } from '../types';
import type { GridLayoutConfig } from './types';

/**
 * 网格布局（3D）。
 *
 * 行优先填充：`level = floor(i / (cols·rows))`，层内 `row = floor(inLevel / cols)`、
 * `col = inLevel % cols`；各方向按间距排布并减去居中偏移，使网格中心落在原点。
 *
 * `plane` / `depthOffset` / `layerSpacing` 在本布局为 no-op（直接输出三维坐标）。
 *
 * @param nodes - 节点列表（不被修改）。
 * @param config - 见 {@link GridLayoutConfig}。
 * @returns 每个节点的完整三维坐标。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 * // 地面平铺（自动推算行列）
 * Layouts.grid(nodes, { spacingX: 1.2, spacingZ: 1.2 });
 * // 三维网格（3 层）
 * Layouts.grid(nodes, { levels: 3, spacingX: 1.2, spacingY: 2.4, spacingZ: 1.2 });
 * ```
 */
export function grid(nodes: NodeData[], config?: GridLayoutConfig): NodePos3D[] {
  const n = nodes.length;
  if (n === 0) return [];

  const cfg = config ?? {};
  const levels = Math.max(1, cfg.levels ?? 1);
  // cols 缺省：尽量让每层接近正方形 → ceil(sqrt(n / levels))。
  let cols = cfg.cols ?? Math.ceil(Math.sqrt(n / levels));
  if (cols < 1) cols = 1;
  // rows 缺省：铺满剩余节点 → ceil(n / (cols · levels))。
  let rows = cfg.rows ?? Math.ceil(n / (cols * levels));
  if (rows < 1) rows = 1;

  const spacingX = cfg.spacingX ?? 1;
  const spacingY = cfg.spacingY ?? 1;
  const spacingZ = cfg.spacingZ ?? 1;

  // 居中偏移：让网格几何中心落在原点（各方向首末关于 0 对称）。
  const offX = ((cols - 1) / 2) * spacingX;
  const offY = ((levels - 1) / 2) * spacingY;
  const offZ = ((rows - 1) / 2) * spacingZ;

  const cellsPerLevel = cols * rows;
  const out: NodePos3D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const level = Math.floor(i / cellsPerLevel);
    const inLevel = i - level * cellsPerLevel;
    const row = Math.floor(inLevel / cols);
    const col = inLevel % cols;
    out[i] = {
      id: nodes[i].id,
      x: col * spacingX - offX,
      y: level * spacingY - offY,
      z: row * spacingZ - offZ,
    };
  }
  return out;
}

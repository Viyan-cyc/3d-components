/**
 * @module graph/elements/Edge3D
 *
 * 边视觉载体 —— 支持两种形态：
 * - `'line'`（默认）：直线段（`THREE.LineSegments`），与第一步一致。
 * - `'path'`：复用 {@link Path}（`mode:'tube'`）生成圆管，可选末端箭头，
 *   用于有向边的强调呈现。
 *
 * 继承 {@link BaseGroup}。每条边构造时 `clone()` 一份独立材质实例，
 * 故各边状态变更（改色/高亮等）互不影响（与 {@link Node3D} 统一策略）。
 *
 * 提供 `updateEnds(src, tgt)` 供布局变化后刷新几何（`'line'` 原地写顶点，
 * `'path'` 重建 Path），为第三步布局动画做铺垫。
 *
 * 第二步未引入 `three/examples/jsm/lines/Line2`（fat line）；如需可控线宽，
 * 后续步骤可按需在 `'path'` 之外再扩 `'fatline'` 形态。
 */

import * as THREE from 'three';
import { BaseGroup } from '../../core/BaseGroup';
import type { BaseGroupOptions } from '../../core/BaseGroup';
import { Path } from '../../core/Path';
import type { NodeId, NodePos3D } from '../types';

/** 边形态类型。 */
export type EdgeType = 'line' | 'path';

/**
 * {@link Edge3D} 构造参数。
 *
 * @example
 * ```ts
 * // 直线边
 * const line = new Edge3D({ id: 'n1->n2', source: p1, target: p2 });
 *
 * // 管道边（带箭头）
 * const tube = new Edge3D({
 *   id: 'n1->n2', source: p1, target: p2,
 *   type: 'path', pathRadius: 0.06, arrow: true,
 * });
 * ```
 */
export interface Edge3DOptions extends BaseGroupOptions {
  /** 边 id。 */
  id?: NodeId;
  /** 起点坐标。 */
  source: NodePos3D;
  /** 终点坐标。 */
  target: NodePos3D;
  /**
   * 边形态。
   * - `'line'`（默认）：`LineSegments` 直线段，材质为 `LineBasicMaterial`。
   * - `'path'`：复用 {@link Path} 的 `mode:'tube'` 圆管，材质为 `MeshStandardMaterial`。
   * @default 'line'
   */
  type?: EdgeType;
  /**
   * `'path'` 形态的管道半径。仅 `type:'path'` 生效。
   * @default 0.05
   */
  pathRadius?: number;
  /**
   * `'path'` 形态是否在末端生成箭头（有向边）。仅 `type:'path'` 生效。
   * @default false
   */
  arrow?: boolean;
  /**
   * 边材质**模板**。按 {@link Edge3DOptions.type} 决定材质类型：
   * - `'line'`：`LineBasicMaterial`；
   * - `'path'`：`MeshStandardMaterial`。
   *
   * 每条边构造时会 `clone()` 一份独立实例，故各边状态变更（改色/高亮等）
   * 互不影响；不传则用内置默认值作模板。`dispose()` 释放各边自己 clone 的
   * 实例（模板本身不被释放）。
   */
  material?: THREE.LineBasicMaterial | THREE.MeshStandardMaterial;
}

/**
 * Edge3D —— 图边的 3D 视觉载体。
 *
 * `'line'` 为直线段；`'path'` 为圆管（复用 {@link Path}）。`source`/`target`
 * 变化时调用 `updateEnds()` 刷新几何。
 *
 * @example
 * ```ts
 * const edge = new Edge3D({ source: p1, target: p2, type: 'path', arrow: true, material: mat });
 * graph.add(edge);
 * // 节点位置变化后：
 * edge.updateEnds(newP1, newP2);
 * ```
 *
 * @extends BaseGroup
 */
export class Edge3D extends BaseGroup {
  /** 边 id（便捷访问）。 */
  readonly edgeId: NodeId;
  /** 起点 id。 */
  readonly sourceId: NodeId;
  /** 终点 id。 */
  readonly targetId: NodeId;
  /** 边形态。 */
  readonly type: EdgeType;
  /** `'path'` 形态的管道半径。 */
  private readonly pathRadius: number;
  /** `'path'` 形态是否带箭头。 */
  private readonly arrow: boolean;

  // ---- 'line' 形态字段 ----
  /** 内部 line（两顶点）。`'line'` 形态用。 */
  private line: THREE.LineSegments | null = null;
  /** 几何体（dispose 用）。`'line'` 形态用。 */
  private geometry: THREE.BufferGeometry | null = null;
  /** 顶点 position 属性（updateEnds 时原地写入）。`'line'` 形态用。 */
  private positionAttr: THREE.BufferAttribute | null = null;

  // ---- 'path' 形态字段 ----
  /** 内部 Path（圆管）。`'path'` 形态用。 */
  private path: Path | null = null;

  /**
   * 该边独立持有的材质实例（由模板 clone 而来，状态变更互不影响）。
   * 类型视 {@link type} 而定：`'line'` 为 `LineBasicMaterial`，`'path'` 为 `MeshStandardMaterial`。
   */
  readonly material: THREE.LineBasicMaterial | THREE.MeshStandardMaterial;

  /**
   * @param options - 配置对象，见 {@link Edge3DOptions}。
   */
  constructor(options: Edge3DOptions) {
    super({
      name: options.name ?? `edge-${options.id ?? `${options.source.id}->${options.target.id}`}`,
      visible: options.visible,
      userData: {
        ...options.userData,
        edgeId: options.id,
        sourceId: options.source.id,
        targetId: options.target.id,
      },
      children: options.children,
      scale: options.scale,
    });

    this.edgeId = options.id ?? `${options.source.id}->${options.target.id}`;
    this.sourceId = options.source.id;
    this.targetId = options.target.id;
    this.type = options.type ?? 'line';
    this.pathRadius = options.pathRadius ?? 0.05;
    this.arrow = options.arrow ?? false;

    // 按形态 clone 独立材质 —— 交互时改色/高亮互不影响。
    if (this.type === 'path') {
      // 'path' 形态用 MeshStandardMaterial（与 core/Path 默认材质一致）。
      const template =
        options.material instanceof THREE.MeshStandardMaterial
          ? options.material
          : new THREE.MeshStandardMaterial({
              color: 0x9aa7b8,
              roughness: 0.6,
              metalness: 0.1,
            });
      this.material = template.clone();
      this.buildPath(options.source, options.target);
    } else {
      // 'line' 形态用 LineBasicMaterial。
      const template =
        options.material instanceof THREE.LineBasicMaterial
          ? options.material
          : new THREE.LineBasicMaterial({
              color: 0x9aa7b8,
              transparent: true,
              opacity: 0.85,
            });
      this.material = template.clone();
      this.buildLine(options.source, options.target);
    }
  }

  /**
   * 构建 `'line'` 形态几何（两顶点 LineSegments）。
   */
  private buildLine(source: NodePos3D, target: NodePos3D): void {
    // 两端点 ×2（LineSegments 每段独立两点）
    this.positionAttr = new THREE.BufferAttribute(
      new Float32Array([
        source.x, source.y, source.z,
        target.x, target.y, target.z,
      ]),
      3,
    );
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttr);

    this.line = new THREE.LineSegments(this.geometry, this.material);
    this.line.name = `edge-line-${this.edgeId}`;
    this.line.userData.edgeId = this.edgeId;
    this.add(this.line);
  }

  /**
   * 构建 `'path'` 形态几何（复用 {@link Path} 的圆管）。带 `arrow` 时末端生成箭头。
   * 先 dispose 旧的 Path（若存在），再新建并 add。
   */
  private buildPath(source: NodePos3D, target: NodePos3D): void {
    this.disposePath();

    this.path = new Path({
      name: `edge-path-${this.edgeId}`,
      paths: [
        {
          path: [
            [source.x, source.y, source.z],
            [target.x, target.y, target.z],
          ],
          mode: 'tube',
          radius: this.pathRadius,
          arrow: this.arrow,
        },
      ],
      // 复用本边 clone 出的独立材质实例；ownsMaterial=false，由本边负责释放。
      material: this.material as THREE.MeshStandardMaterial,
    });
    // Path 内部 mesh 也带上 edgeId，供 Raycaster 拾取后回查边身份。
    this.path.traverse((child) => {
      child.userData.edgeId = this.edgeId;
    });
    this.add(this.path);
  }

  /**
   * 释放当前 `'path'` 形态的 Path 资源（几何体）。材质由本边统一释放，不在此处理。
   * Path.dispose 在 ownsMaterial=false 时只释放几何，符合预期。
   */
  private disposePath(): void {
    if (!this.path) return;
    this.path.dispose();
    this.remove(this.path);
    this.path = null;
  }

  /**
   * 释放当前 `'line'` 形态的几何与内部 line。材质由本边统一释放。
   */
  private disposeLine(): void {
    if (this.line) {
      this.geometry?.dispose();
      this.remove(this.line);
      this.line = null;
      this.geometry = null;
      this.positionAttr = null;
    }
  }

  /**
   * 刷新边的两端坐标。布局变化或节点拖拽后调用。
   *
   * `'line'` 形态原地写顶点；`'path'` 形态重建 Path 几何。
   *
   * @param source - 新起点坐标。
   * @param target - 新终点坐标。
   */
  updateEnds(source: NodePos3D, target: NodePos3D): void {
    if (this.type === 'path') {
      this.buildPath(source, target);
      return;
    }
    if (!this.positionAttr) return;
    const arr = this.positionAttr.array as Float32Array;
    arr[0] = source.x; arr[1] = source.y; arr[2] = source.z;
    arr[3] = target.x; arr[4] = target.y; arr[5] = target.z;
    this.positionAttr.needsUpdate = true;
    this.geometry?.computeBoundingSphere();
  }

  /**
   * 取该边独立持有的材质实例。可直接修改其属性（`color` / `opacity` / `emissive` 等）
   * 实现交互反馈，不影响其他边 —— 因为每条边持有自己的 clone。
   *
   * @returns 该边的材质实例（`'line'` 为 `LineBasicMaterial`，`'path'` 为 `MeshStandardMaterial`）。
   */
  getMaterial(): THREE.LineBasicMaterial | THREE.MeshStandardMaterial {
    return this.material;
  }

  /**
   * 释放几何体与材质（均为本边 clone 出的独立实例，始终释放）。
   *
   * - `'line'`：释放 BufferGeometry + LineBasicMaterial。
   * - `'path'`：调用内部 Path.dispose（释放管几何）+ 释放 MeshStandardMaterial。
   *
   * 注：内部 `LineSegments` 是 `THREE.Line` 子类而非 `THREE.Mesh`，
   * 故 {@link BaseGroup.dispose} 的 Mesh 遍历不会释放其几何/材质 —— 必须在此手动释放。
   * `'path'` 形态的内部 mesh 是 `THREE.Mesh`，理论上会被父类遍历释放几何，
   * 但材质是共享 clone 实例（ownsMaterial=false 的 Path 不释放它），故也在此统一释放。
   * 提前 `clear()` 移除子级，语义与 {@link Node3D.dispose} 保持一致。
   */
  dispose(): void {
    this.disposeLine();
    this.disposePath();
    this.material.dispose();
    this.clear();
    super.dispose();
  }
}

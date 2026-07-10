/**
 * @module graph/elements/Edge3D
 *
 * 边视觉载体 —— 第一步实现：直线段（`THREE.LineSegments`）。
 *
 * 继承 {@link BaseGroup}，内部包裹一条 `THREE.LineSegments`（两端点）。
 * 提供 `updateEnds(src, tgt)` 方法供布局变化后刷新几何（`setFromPoints`），
 * 为第三步布局动画做铺垫。
 *
 * 第一步仅 `'line'` 形态；第二步将接入 `core/Path`（管道/带状/箭头）以支持 `'path'` 形态，
 * 也可按需引入 `three/examples/jsm/lines/Line2` 获得可控线宽的 fat line。
 */

import * as THREE from 'three';
import { BaseGroup } from '../../core/BaseGroup';
import type { BaseGroupOptions } from '../../core/BaseGroup';
import type { NodeId, NodePos3D } from '../types';

/**
 * {@link Edge3D} 构造参数。
 *
 * @example
 * ```ts
 * const edge = new Edge3D({
 *   id: 'n1->n2',
 *   source: { id: 'n1', x: 0, y: 0, z: 0 },
 *   target: { id: 'n2', x: 2, y: 0, z: 0 },
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
   * 边材质**模板**（`LineBasicMaterial`）。每条边构造时会 `clone()` 一份独立实例，
   * 故各边状态变更（改色/高亮等）互不影响；不传则用内置默认值作模板。
   * `dispose()` 释放各边自己 clone 的实例（模板本身不被释放）。
   */
  material?: THREE.LineBasicMaterial;
}

/**
 * Edge3D —— 图边的 3D 视觉载体。
 *
 * 第一步为直线段；`source`/`target` 变化时调用 `updateEnds()` 刷新几何。
 *
 * @example
 * ```ts
 * const edge = new Edge3D({ source: p1, target: p2, material: mat });
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
  /** 内部 line（两顶点）。 */
  private readonly line: THREE.LineSegments;
  /** 几何体（dispose 用）。 */
  private readonly geometry: THREE.BufferGeometry;
  /** 顶点 position 属性（updateEnds 时原地写入）。 */
  private readonly positionAttr: THREE.BufferAttribute;
  /** 该边独立持有的材质实例（由模板 clone 而来，状态变更互不影响）。 */
  readonly material: THREE.LineBasicMaterial;

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

    // 两端点 ×2（LineSegments 每段独立两点）
    this.positionAttr = new THREE.BufferAttribute(
      new Float32Array([
        options.source.x, options.source.y, options.source.z,
        options.target.x, options.target.y, options.target.z,
      ]),
      3,
    );
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttr);

    // 每条边 clone 一份独立材质实例 —— 交互时改色/高亮互不影响。
    // options.material 作为「模板（prototype）」提供，不直接共享。
    const template = options.material ?? new THREE.LineBasicMaterial({
      color: 0x9aa7b8,
      transparent: true,
      opacity: 0.85,
    });
    this.material = template.clone();

    this.line = new THREE.LineSegments(this.geometry, this.material);
    this.line.name = `edge-line-${this.edgeId}`;
    this.line.userData.edgeId = this.edgeId;
    this.add(this.line);
  }

  /**
   * 刷新边的两端坐标。布局变化或节点拖拽后调用。
   *
   * @param source - 新起点坐标。
   * @param target - 新终点坐标。
   */
  updateEnds(source: NodePos3D, target: NodePos3D): void {
    const arr = this.positionAttr.array as Float32Array;
    arr[0] = source.x; arr[1] = source.y; arr[2] = source.z;
    arr[3] = target.x; arr[4] = target.y; arr[5] = target.z;
    this.positionAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /**
   * 取该边独立持有的材质实例。可直接修改其属性（`color` / `opacity` 等）
   * 实现交互反馈，不影响其他边 —— 因为每条边持有自己的 clone。
   *
   * @returns 该边的 `LineBasicMaterial` 实例。
   */
  getMaterial(): THREE.LineBasicMaterial {
    return this.material;
  }

  /**
   * 释放几何体与材质（均为本边 clone 出的独立实例，始终释放）。
   *
   * 注：内部 `LineSegments` 是 `THREE.Line` 子类而非 `THREE.Mesh`，
   * 故 {@link BaseGroup.dispose} 的 Mesh 遍历不会释放其几何/材质 —— 必须在此手动释放。
   * 提前 `clear()` 移除子级，语义与 {@link Node3D.dispose} 保持一致。
   */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.clear();
    super.dispose();
  }
}

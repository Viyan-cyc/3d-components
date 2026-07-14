/**
 * @module graph/elements/Node3D
 *
 * 节点视觉载体 —— 第一步实现：球体 Mesh。
 *
 * 继承 {@link BaseGroup}（即 `THREE.Group` + `IUpdatable` + `IDisposable`），
 * 内部包裹一个 `THREE.Mesh`（`SphereGeometry`）。预留 `label` 槽位（第二步以 `core/Html` 填充）。
 *
 * `userData.nodeId` 存储节点 id，供后续交互层（`PickController`）的 Raycaster
 * 拾取后回查节点身份。
 *
 * 后续步骤将扩展为多形态（Mesh / Sprite / Html），通过 `type` 切换；
 * 第一步仅实现 `'mesh'`。
 */

import * as THREE from 'three';
import { BaseGroup } from '../../core/BaseGroup';
import type { BaseGroupOptions } from '../../core/BaseGroup';
import type { NodeData, NodeId } from '../types';

// 复用临时对象，避免每帧分配。
const _box = /* @__PURE__ */ new THREE.Box3();

/**
 * {@link Node3D} 构造参数。
 *
 * @example
 * ```ts
 * const opts: Node3DOptions = {
 *   data: { id: 'n1', x: 1, y: 0, z: 0 },
 *   defaultSize: 0.4,
 *   material: new THREE.MeshStandardMaterial({ color: 0x4a90e2 }),
 * };
 * ```
 */
export interface Node3DOptions extends BaseGroupOptions {
  /** **必填**。该节点对应的输入数据（至少需含 `id`）。 */
  data: NodeData;
  /**
   * 节点默认尺寸（球体半径）。当 `data.size` 未指定时使用。
   * @default 0.3
   */
  defaultSize?: number;
  /**
   * 节点材质**模板**。每个节点构造时会 `clone()` 一份独立实例，故各节点
   * 状态变更（改色/高亮等）互不影响；不传则用内置默认 `MeshStandardMaterial`
   * 作模板。`dispose()` 释放各节点自己 clone 的实例（模板本身不被释放）。
   */
  material?: THREE.MeshStandardMaterial;
}

/**
 * Node3D —— 图节点的 3D 视觉载体。
 *
 * 第一步为球体 Mesh；通过 `setPosition()` 应用布局坐标，
 * `getSize()` 在用户未指定尺寸时通过包围盒自动计算。
 *
 * @example
 * ```ts
 * const node = new Node3D({
 *   data: { id: 'n1', size: 0.5 },
 *   material: myMaterial,
 * });
 * graph.add(node);
 * node.setPosition({ id: 'n1', x: 2, y: 0, z: 0 });
 * ```
 *
 * @extends BaseGroup
 */
export class Node3D extends BaseGroup {
  /** 该节点对应的输入数据（只读视图）。 */
  readonly data: NodeData;
  /** 该节点 id（便捷访问，等价于 `this.data.id`）。 */
  readonly nodeId: NodeId;
  /** 内部 mesh。 */
  private readonly mesh: THREE.Mesh;
  /** 当前几何体引用（setSize 时会被替换，dispose 时释放当前实例）。 */
  private geometry: THREE.SphereGeometry;
  /** 该节点独立持有的材质实例（由模板 clone 而来，状态变更互不影响）。 */
  readonly material: THREE.MeshStandardMaterial;
  /**
   * label 槽位。第二步未填充（本次不实现 sprite/html 节点形态）；
   * 后续步骤将以此挂载 `core/Html`（DOM 标签投影）或 `core/BitmapText`（SDF 文字）。
   * 挂载后 `dispose()` 会预先释放之。
   */
  label: THREE.Object3D | null = null;

  /**
   * @param options - 配置对象，见 {@link Node3DOptions}。
   */
  constructor(options: Node3DOptions) {
    super({
      name: options.name ?? `node-${options.data.id}`,
      visible: options.visible,
      userData: { ...options.userData, nodeId: options.data.id },
      children: options.children,
      scale: options.scale,
    });

    this.data = options.data;
    this.nodeId = options.data.id;

    const size = options.data.size ?? options.defaultSize ?? 0.3;
    this.geometry = new THREE.SphereGeometry(size, 32, 32);

    // 每个节点 clone 一份独立材质实例 —— 交互时改色/高亮互不影响。
    // options.material 作为「模板（prototype）」提供，不直接共享。
    const template = options.material ?? new THREE.MeshStandardMaterial({
      color: 0x4a90e2,
      roughness: 0.4,
      metalness: 0.1,
    });
    this.material = template.clone();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // mesh 自身的 name 也带上 id，便于 traversal / raycaster 场景回查。
    this.mesh.name = `node-mesh-${this.nodeId}`;
    this.mesh.userData.nodeId = this.nodeId;
    this.add(this.mesh);

    // 应用输入数据中的显式坐标（若有）。
    const { x, y, z } = options.data;
    if (x !== undefined || y !== undefined || z !== undefined) {
      this.position.set(x ?? 0, y ?? 0, z ?? 0);
    }
  }

  /**
   * 应用布局坐标到节点 position。
   *
   * @param pos - 布局输出的三维坐标（含 id，仅取 x/y/z）。
   */
  setPosition(pos: { x: number; y: number; z: number }): void {
    this.position.set(pos.x, pos.y, pos.z);
  }

  /**
   * 获取节点尺寸。优先用 `data.size`；未指定则通过世界坐标包围盒自动计算
   * （取包围盒对角线的一半作为近似半径，适合球体）。
   *
   * @returns 节点尺寸（半径量级）。
   */
  getSize(): number {
    if (this.data.size !== undefined) return this.data.size;
    _box.setFromObject(this);
    const size = new THREE.Vector3();
    _box.getSize(size);
    return size.length() / 2;
  }

  /**
   * 动态修改节点尺寸（重建球体几何）。用于交互反馈（如悬停放大）。
   *
   * @param size - 新的半径。
   */
  setSize(size: number): void {
    this.geometry.dispose();
    this.geometry = new THREE.SphereGeometry(size, 32, 32);
    this.mesh.geometry = this.geometry;
  }

  /**
   * 取该节点独立持有的材质实例。可直接修改其属性（`color` / `emissive` 等）
   * 实现交互反馈，不影响其他节点 —— 因为每个节点持有自己的 clone。
   *
   * @returns 该节点的 `MeshStandardMaterial` 实例。
   */
  getMaterial(): THREE.MeshStandardMaterial {
    return this.material;
  }

  /**
   * 释放节点持有的几何体与材质（均为本节点 clone 出的独立实例，始终释放）。
   *
   * 先手动释放 geometry/material 与 label，再 `this.clear()` 移除子级，
   * 最后调 `super.dispose()`。提前 clear 可避免 {@link BaseGroup.dispose} 的遍历
   * 重复释放内部 mesh 的 geometry/material。
   * 预先释放 `label`（若已挂载，第二步以 `core/Html` 实现）。
   */
  dispose(): void {
    if (this.label) {
      const l = this.label as unknown as { dispose?: () => void };
      l.dispose?.();
      this.remove(this.label);
      this.label = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.clear(); // 移除内部 mesh 等子级，避免 super.dispose 遍历重复释放
    super.dispose();
  }
}

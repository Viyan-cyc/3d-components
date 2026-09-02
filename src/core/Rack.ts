
import * as THREE from 'three';
import type { GroupComponentOptions, IDisposable, Vec3 } from '../types';

// ===================== constants =====================

/** 构件（立柱 / 横梁 / 层板）厚度，世界单位。 */
const BEAM_SIZE = 0.1;

/** `row` / `col` 为数量时的默认货位宽 / 层高。 */
const DEFAULT_CELL_SIZE = 1;

/** `goodsPlank` 百分比字符串的换算基数（`'60'` ⇒ 60%）。 */
const PERCENT_BASE = 100;

/** 默认框架材质颜色。 */
const DEFAULT_FRAME_COLOR = 0xffffff;

/** 默认层板材质颜色。 */
const DEFAULT_PLANK_COLOR = 0xeac58b;

// ===================== types =====================

/** 显式层板配置，见 {@link RackData.goodsPlank} 的数组模式。 */
export interface RackPlank {

  /** 层板中心位置（货架局部坐标：x 沿宽、y 沿高、z 沿深）。 */
  position: Vec3;

  /** 层板宽度（X 方向）。 */
  width: number;

  /** 层板深度（Z 方向）。 */
  depth: number;
}

/** 货架结构数据。 */
export interface RackData {

  /**
   * 横向货位划分：
   *  - 数量：等分 `row` 个货位，每个宽 `width`；
   *  - 数组：逐货位宽度（此时忽略 `width`）。
   */
  row: number | number[];

  /**
   * 纵向层划分：
   *  - 数量：等分 `col` 层，每层高 `height`；
   *  - 数组：逐层高度（此时忽略 `height`）。
   */
  col: number | number[];

  /** 每个货位的宽度，仅 `row` 为数量时生效。 @default 1 */
  width?: number;

  /** 每层的高度，仅 `col` 为数量时生效。 @default 1 */
  height?: number;

  /** 货架深度（Z 方向）。货架正面在 `z = 0`、背面在 `z = -depth`。 */
  depth: number;

  /**
   * 最底层（`y = 0`）是否也生成层板 / 横梁。
   * 关闭时底层直接落地，首个层板位于第一层顶部。 @default false
   */
  firstplane?: boolean;

  /**
   * 层板（货物隔板）模式：
   *  - 不传：每层一块通长实心层板；
   *  - 字符串：每货位一块层板，宽度为货位净宽的百分比（如 `'60'` ⇒ 60%）；
   *  - 数值：每货位一块层板，宽度为该固定值（世界单位）；
   *  - 数组：不自动生成层板，改由数组显式指定每块层板的位置与尺寸。
   */
  goodsPlank?: string | number | RackPlank[];
}

/** Options for constructing a {@link Rack}. */
export interface RackOptions extends GroupComponentOptions {

  /** 初始货架数据。不传则创建空货架，之后可随时 {@link Rack.set}。 */
  data?: RackData;

  /** 框架（立柱 + 横梁）共享材质。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  frameMaterial?: THREE.Material;

  /** 层板共享材质。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  plankMaterial?: THREE.Material;
}

// ===================== internal helpers =====================

/** 单个实例盒子：单位 BoxGeometry 的位置 + 缩放（无旋转）。 */
interface BoxInstance {
  position: Vec3;
  scale: Vec3;
}

/** 归一化后的货架尺寸。 */
interface RackDims {
  rowWidths: number[];
  levelHeights: number[];
  totalWidth: number;
  totalHeight: number;
}

/** 把 `row` / `col` 归一化为货位宽 / 层高数组，非法输入返回 `null`。 */
const resolveSpans = (spec: number | number[] | undefined, unit: number | undefined): number[] | null => {
  if (Array.isArray(spec)) {
    return spec.length > 0 && spec.every((v) => v > 0) ? spec : null;
  }
  const count = spec ?? 0;
  if (!Number.isInteger(count) || count < 1) {
    return null;
  }
  return new Array(count).fill(unit && unit > 0 ? unit : DEFAULT_CELL_SIZE);
};

/** 校验并归一化货架尺寸；数据非法时返回 `null`（货架保持为空）。 */
const resolveDims = (data: RackData): RackDims | null => {
  const rowWidths = resolveSpans(data.row, data.width);
  const levelHeights = resolveSpans(data.col, data.height);
  if (!rowWidths || !levelHeights || !(data.depth > 0)) {
    return null;
  }
  return {
    rowWidths,
    levelHeights,
    totalWidth: rowWidths.reduce((sum, w) => sum + w, 0),
    totalHeight: levelHeights.reduce((sum, h) => sum + h, 0),
  };
};

// ===================== geometry builders =====================
// 货架原点在前缘左端：宽度沿 +X（0 … 总宽）、高度沿 +Y（0 … 总高）、深度沿 -Z（0 … -depth）。

/** 立柱：前后两排（`z = 0` / `z = -depth`），每个货位分界处各一根，贯穿全高。 */
const buildColumns = (frame: BoxInstance[], data: RackData, dims: RackDims): void => {
  const { depth } = data;
  const { rowWidths, totalHeight } = dims;
  const columnLength = totalHeight + BEAM_SIZE * 2;
  let x = 0;
  for (let i = 0; i <= rowWidths.length; i++) {
    for (const z of [0, -depth]) {
      frame.push({
        position: { x, y: columnLength / 2, z },
        scale: { x: BEAM_SIZE, y: columnLength + BEAM_SIZE, z: BEAM_SIZE },
      });
    }
    if (i < rowWidths.length) {
      x += rowWidths[i];
    }
  }
};

/** 横梁层：每个货位分界处一根纵深短梁 + 前后各一根通长横梁；按 {@link RackData.goodsPlank} 模式在货位内放层板。 */
const buildLevels = (frame: BoxInstance[], planks: BoxInstance[], data: RackData, dims: RackDims): void => {
  const { depth, goodsPlank } = data;
  const { rowWidths, levelHeights, totalWidth } = dims;
  let y = data.firstplane ? 0 : levelHeights[0];
  const firstLevel = data.firstplane ? 0 : 1;
  for (let i = firstLevel; i <= levelHeights.length; i++) {
    let x = 0;
    for (let j = 0; j <= rowWidths.length; j++) {
      // 货位分界处的纵深短梁
      frame.push({
        position: { x, y, z: -depth / 2 },
        scale: { x: BEAM_SIZE, y: BEAM_SIZE, z: depth },
      });
      // 货位内层板（显式数组模式不自动生成）
      if (j < rowWidths.length && (typeof goodsPlank === 'string' || typeof goodsPlank === 'number')) {
        const cellWidth = rowWidths[j];
        const plankWidth = typeof goodsPlank === 'string'
          ? (cellWidth - BEAM_SIZE) * (Number.parseInt(goodsPlank) / PERCENT_BASE)
          : goodsPlank;
        if (plankWidth > 0) {
          planks.push({
            position: { x: x + cellWidth / 2, y, z: -depth / 2 },
            scale: {
              x: plankWidth,
              y: BEAM_SIZE,
              // 百分比层板稍内缩，固定宽度层板用全深，与原版一致
              z: typeof goodsPlank === 'string' ? depth - BEAM_SIZE : depth,
            },
          });
        }
      }
      if (j < rowWidths.length) {
        x += rowWidths[j];
      }
    }
    // 前后两根通长横梁
    for (const z of [0, -depth]) {
      frame.push({
        position: { x: totalWidth / 2, y, z },
        scale: { x: totalWidth, y: BEAM_SIZE, z: BEAM_SIZE },
      });
    }
    if (i < levelHeights.length) {
      y += levelHeights[i];
    }
  }
};

/** 通长实心层板：每层顶部一块（`firstplane` 时最底层也有一块）。 */
const buildSolidShelves = (planks: BoxInstance[], data: RackData, dims: RackDims): void => {
  const { depth, firstplane } = data;
  const { levelHeights, totalWidth } = dims;
  const addShelf = (y: number): void => {
    planks.push({
      position: { x: totalWidth / 2, y, z: -depth / 2 },
      scale: { x: totalWidth, y: BEAM_SIZE, z: depth - BEAM_SIZE },
    });
  };
  if (firstplane) {
    addShelf(0);
  }
  let y = 0;
  for (const levelHeight of levelHeights) {
    y += levelHeight;
    addShelf(y);
  }
};

/** 显式层板：完全按数组指定的位置与尺寸生成。 */
const buildCustomPlanks = (planks: BoxInstance[], items: RackPlank[]): void => {
  for (const item of items) {
    planks.push({
      position: { x: item.position.x, y: item.position.y, z: item.position.z },
      scale: { x: item.width, y: BEAM_SIZE, z: item.depth },
    });
  }
};

// ===================== instanced mesh factory =====================

// 构建期复用的临时对象，避免反复分配。
const tmpMatrix = new THREE.Matrix4();
const tmpPosition = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const IDENTITY_QUATERNION = new THREE.Quaternion();

/** 由实例列表创建 InstancedMesh：容量 = 实例数，无旋转，一次性计算包围球。 */
const createInstancedMesh = (
  geometry: THREE.BoxGeometry,
  material: THREE.Material,
  instances: BoxInstance[],
): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  instances.forEach((instance, i) => {
    tmpPosition.set(instance.position.x, instance.position.y, instance.position.z);
    tmpScale.set(instance.scale.x, instance.scale.y, instance.scale.z);
    tmpMatrix.compose(tmpPosition, IDENTITY_QUATERNION, tmpScale);
    mesh.setMatrixAt(i, tmpMatrix);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
};

// ===================== Rack component =====================

/**
 * Rack —— 货架组件。
 *
 * 由立柱、横梁（框架）与层板组成的仓储货架。所有构件复用同一个单位 BoxGeometry，
 * 经两个 InstancedMesh（框架 + 层板）实例化渲染——无论货架多大规模，始终只有 2 个 draw call。
 *
 * **坐标系:** 原点位于货架前缘左端——宽度沿 +X（`0 … 总宽`）、高度沿 +Y（`0 … 总高`）、
 * 深度沿 -Z（`0 … -depth`），正面朝 +Z。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接加入任意 Three.js 场景
 * - `row` / `col` 支持数量（等分布局）或数组（逐货位宽度 / 逐层高度）
 * - `goodsPlank` 三种层板模式：百分比字符串 / 固定宽度数值 / 显式数组；不传则为整层通长实心层板
 * - `set()` 动态重建：只传变化字段（浅合并），适配数据驱动的场景（如智能排布）
 * - `copy()` / `clone()` 拷贝结构数据后整体重建，不与源实例共享任何实例网格
 * - 实现 {@link IDisposable} —— `dispose()` 释放实例网格与共享几何体（自建材质一并释放）
 *
 * @example
 * ```ts
 * import { Rack } from '@a3d/a3d-components/core';
 *
 * // 4 货位 × 3 层、深 1m 的等分货架，每货位放一块 60% 宽的层板
 * const rack = new Rack({
 *   data: { row: 4, col: 3, width: 1.2, height: 0.8, depth: 1, goodsPlank: '60' },
 * });
 * scene.add(rack);
 *
 * // 数据驱动重建：只改层数，其余沿用
 * rack.set({ col: 5 });
 *
 * // 逐货位宽度 + 逐层高度 + 显式层板
 * rack.set({
 *   row: [1, 2, 1],
 *   col: [0.5, 1, 1.5],
 *   goodsPlank: [{ position: { x: 1, y: 1, z: -0.5 }, width: 0.6, depth: 0.9 }],
 * });
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Rack extends THREE.Group implements IDisposable {
  private readonly content: THREE.Group;
  private readonly geometry: THREE.BoxGeometry;
  private readonly frameMaterial: THREE.Material;
  private readonly plankMaterial: THREE.Material;
  private readonly ownsFrameMaterial: boolean;
  private readonly ownsPlankMaterial: boolean;
  private rackData: RackData | null = null;

  constructor(options: RackOptions = {}) {
    super();

    // 内层组承载生成的实例网格：set() 重建时只清空它，不影响外部挂载的子节点。
    this.content = new THREE.Group();
    this.geometry = new THREE.BoxGeometry(1, 1, 1);

    this.ownsFrameMaterial = !options.frameMaterial;
    this.frameMaterial = options.frameMaterial ?? new THREE.MeshStandardMaterial({
      color: DEFAULT_FRAME_COLOR,
      roughness: 0.4,
      metalness: 0.3,
    });
    this.ownsPlankMaterial = !options.plankMaterial;
    this.plankMaterial = options.plankMaterial ?? new THREE.MeshStandardMaterial({
      color: DEFAULT_PLANK_COLOR,
      roughness: 0.9,
      metalness: 0,
    });

    if (options.name) {
      this.name = options.name;
    }
    if (options.visible !== undefined) {
      this.visible = options.visible;
    }
    if (options.userData) {
      this.userData = { ...options.userData };
    }

    this.add(this.content);
    if (options.data) {
      this.set(options.data);
    }
    if (options.children) {
      for (const child of options.children) {
        this.add(child);
      }
    }
  }

  /** 当前货架配置的独立副本（`set()` 合并后的结果）。 */
  get parameters(): Readonly<RackData> | null {
    return this.rackData ? Rack.cloneData(this.rackData) : null;
  }

  /**
   * 重建货架。与当前配置**浅合并**：只覆盖传入的字段，其余沿用上次配置。
   * @param data - 货架数据，可只传变化的部分。
   * @returns this，支持链式调用。
   */
  set(data: Partial<RackData>): this {
    const merged = { ...this.rackData, ...data };
    // 必填字段齐备才进入构建（rebuild 内还会做数值校验，不合法时货架保持为空）
    if (merged.row !== undefined && merged.col !== undefined && merged.depth !== undefined) {
      this.rackData = merged;
    } else {
      this.rackData = null;
    }
    this.rebuild();
    return this;
  }

  /**
   * 复制另一个货架：拷贝其变换与货架数据后整体重建（实例网格、材质数据不共享）。
   * 生成的构件由重建负责；源实例上额外挂载的子节点会被递归克隆保留。
   */
  copy(source: this): this {
    super.copy(source, false);
    this.clearContent();
    for (const child of source.children) {
      if (child !== source.content) {
        this.add(child.clone());
      }
    }
    this.rackData = source.rackData ? Rack.cloneData(source.rackData) : null;
    if (this.rackData) {
      this.rebuild();
    }
    return this;
  }

  /** 释放生成的实例网格、共享几何体；自建材质一并释放。 */
  dispose(): void {
    this.clearContent();
    this.clear();
    this.geometry.dispose();
    if (this.ownsFrameMaterial) {
      this.frameMaterial.dispose();
    }
    if (this.ownsPlankMaterial) {
      this.plankMaterial.dispose();
    }
    this.rackData = null;
  }

  /** 移除并释放已生成的实例网格（共享的单位 BoxGeometry 不在此释放）。 */
  private clearContent(): void {
    for (const mesh of this.content.children) {
      (mesh as THREE.InstancedMesh).dispose();
    }
    this.content.clear();
  }

  /** 按当前 rackData 重建全部构件；数据非法时货架保持为空。 */
  private rebuild(): void {
    this.clearContent();
    // dispose() 会移除内层组；重建时确保它仍然挂在组件上
    if (!this.content.parent) {
      this.add(this.content);
    }
    const data = this.rackData;
    if (!data) {
      return;
    }
    const dims = resolveDims(data);
    if (!dims) {
      return;
    }
    const frame: BoxInstance[] = [];
    const planks: BoxInstance[] = [];
    buildColumns(frame, data, dims);
    if (data.goodsPlank) {
      buildLevels(frame, planks, data, dims);
      if (Array.isArray(data.goodsPlank)) {
        buildCustomPlanks(planks, data.goodsPlank);
      }
    } else {
      buildSolidShelves(planks, data, dims);
    }
    this.content.add(createInstancedMesh(this.geometry, this.frameMaterial, frame));
    this.content.add(createInstancedMesh(this.geometry, this.plankMaterial, planks));
  }

  /** 深拷贝货架数据，避免副本与源实例共享可变数组。 */
  private static cloneData(data: RackData): RackData {
    return {
      ...data,
      row: Array.isArray(data.row) ? [...data.row] : data.row,
      col: Array.isArray(data.col) ? [...data.col] : data.col,
      goodsPlank: Array.isArray(data.goodsPlank)
        ? data.goodsPlank.map((plank) => ({ ...plank, position: { ...plank.position } }))
        : data.goodsPlank,
    };
  }
}

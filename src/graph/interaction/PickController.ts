/**
 * @module graph/interaction/PickController
 *
 * 图交互拾取控制器。
 *
 * 职责：
 * - 监听宿主 DOM（canvas）的 pointer 事件。
 * - 用 `THREE.Raycaster` 拾取 {@link Graph3D} 子树，通过 `userData.nodeId` /
 *   `userData.edgeId` 回查节点/边身份。**节点优先于边**：射线穿过节点时
 *   优先命中节点，避免近处边遮挡背后节点。
 * - 维护 hover / select(选中) 状态，应用**内置默认视觉反馈**：
 *   - 节点悬停：放大 1.25× + emissive 提亮；选中：emissive 常亮（更强）。
 *   - 边悬停/选中：提亮为强调色（橙色，不透明），与邻接边高亮一致。
 *   - 邻接边高亮：选中**节点**时，其关联边提亮（其余边保持原状不变）。
 * - 选中支持 `single`（互斥：选中新元素取消旧选中）/ `multiple`（纯累加 toggle：
 *   点击追加，再点已选取消）两种模式，运行时可切换。
 * - 节点与边均可被选中（边选中时自身提亮，不再参与邻接高亮判定）。
 * - 点击空白/地面（未命中任何元素）自动清空选中；另暴露
 *   {@link PickController.clearSelection} 供开发者主动调用。
 * - 同时把 {@link GraphEvent} 分发给用户回调（`onHover` / `onSelect`），
 *   用户可在回调中做任意额外视觉变化（信息面板、外部联动等）。
 *
 * 内置反馈与事件回调**并存**：关闭内置反馈（`highlightOn*` 置 false）后，
 * 事件仍照常分发 —— 即可「纯靠回调」驱动视觉。
 *
 * 反馈采用「重算」模型：hover/select 状态变化时，按 {选中 > 悬停 > 默认}
 * 优先级重算受影响元素视觉，避免缓存还原的叠加污染。
 */

import * as THREE from 'three';
import type { Node3D } from '../elements/Node3D';
import type { Edge3D } from '../elements/Edge3D';
import type { Graph3D } from '../Graph3D';
import type { NodeId } from '../types';
import type { GraphEvent, GraphEventHandler, GraphPickKind } from './types';

/** pointerdown → pointerup 的位移阈值（px），超过视为拖拽，不触发 click。 */
const CLICK_MOVE_THRESHOLD = 5;

/**
 * 直线边（`LineSegments`）拾取的**屏幕像素**距离阈值。点到线段两端点构成
 * 的直线段的最近屏幕距离 < 此值才算命中。摆脱 world-unit threshold 在远相机
 * 下覆盖屏幕过大的问题，使直线边热区在任意相机距离下都紧贴线本身。
 */
const LINE_PICK_PIXELS = 6;

/** 悬停放大倍率。 */
const HOVER_SCALE = 1.25;
/** 默认 emissive 强度（还原基准）。 */
const DEFAULT_EMISSIVE_INTENSITY = 0;
/** 节点悬停 emissive 强度。 */
const HOVER_EMISSIVE_INTENSITY = 0.35;
/** 节点选中 emissive 强度（强于悬停）。 */
const SELECT_EMISSIVE_INTENSITY = 0.6;

/** 反馈强调色（橙）—— 边悬停/选中 + 邻接边高亮 + 节点 emissive 共用。 */
const EDGE_HIGHLIGHT_COLOR = 0xff8a3b;
/** 边默认色（还原基准）。 */
const EDGE_DEFAULT_COLOR = 0x9aa7b8;
/** 节点默认色（还原基准）。 */
const NODE_DEFAULT_COLOR = 0x4a90e2;

// 复用临时对象，避免每帧分配。
const _ndc = /* @__PURE__ */ new THREE.Vector2();
const _projA = /* @__PURE__ */ new THREE.Vector3();
const _projB = /* @__PURE__ */ new THREE.Vector3();

/**
 * 屏幕空间：点 (px,py) 到线段 (ax,ay)-(bx,by) 的最近距离。
 */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * {@link PickController} 构造参数。
 *
 * @example
 * ```ts
 * const pick = new PickController({
 *   domElement: canvas,
 *   graph,
 *   camera,
 *   onHover: (e) => setStatus(`hover: ${e.id}`),
 *   onSelect: (e) => setStatus(`select: ${e.id}`),
 * });
 * // 销毁时：
 * pick.dispose();
 * ```
 */
export interface PickControllerOptions {
  /** 监听 pointer 事件的宿主（通常是渲染 canvas）。 */
  domElement: HTMLElement;
  /** 拾取目标图组件。 */
  graph: Graph3D;
  /** 摄像机（NDC 射线 origin）。 */
  camera: THREE.Camera;
  /** 是否启用。 @default true */
  enabled?: boolean;
  /** 是否启用 hover 拾取。 @default true */
  hover?: boolean;
  /** 是否应用内置悬停反馈（放大+发光）。 @default true */
  highlightOnHover?: boolean;
  /** 是否应用内置选中反馈（常亮发光）。 @default true */
  highlightOnSelect?: boolean;
  /** 选中节点时是否高亮相邻边（仅提亮邻接边，其余边不变）。 @default true */
  neighborHighlight?: boolean;
  /**
   * 选中模式。
   * - `'single'`（默认）：互斥。选中新元素自动取消旧选中。
   * - `'multiple'`：纯累加 toggle。点击追加选中，再点已选元素取消。
   *
   * 节点与边均可被选中。点击空白/地面清空全部选中。
   * @default 'single'
   */
  selectionMode?: 'single' | 'multiple';
  /** hover / unhover 事件回调。 */
  onHover?: GraphEventHandler;
  /** click / select / unselect 事件回调。 */
  onSelect?: GraphEventHandler;
}

/** 拾取命中的元素标识（节点或边）。 */
interface PickHit {
  kind: GraphPickKind;
  id: NodeId;
}

/**
 * PickController —— 图交互拾取与事件分发控制器。
 *
 * 不继承任何 Three 对象，仅作为「控制器」持有 Raycaster 与监听器。
 * 必须在不再使用时调用 {@link dispose} 移除事件监听并还原反馈状态。
 */
export class PickController {
  private readonly dom: HTMLElement;
  private readonly graph: Graph3D;
  private readonly camera: THREE.Camera;
  private readonly raycaster = new THREE.Raycaster();

  private enabled: boolean;
  private readonly hoverEnabled: boolean;
  private highlightOnHover: boolean;
  private highlightOnSelect: boolean;
  private neighborHighlight: boolean;
  /** 选中模式：'single' 互斥 / 'multiple' 累加 toggle。 */
  private selectionMode: 'single' | 'multiple';
  onHover?: GraphEventHandler;
  onSelect?: GraphEventHandler;

  /** 当前悬停的元素 id（含 kind）。 */
  private hovered: PickHit | null = null;
  /** 当前选中的节点 id 集合。 */
  private readonly selectedNodes = new Set<NodeId>();
  /** 当前选中的边 id 集合。 */
  private readonly selectedEdges = new Set<NodeId>();

  /** pointerdown 落点（用于判断 click vs 拖拽）。 */
  private downX = 0;
  private downY = 0;
  /** pointerdown 是否已记录（pointerup 时校验）。 */
  private downActive = false;

  // 绑定的 handler 引用，便于 removeEventListener。
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerLeave = () => this.handlePointerLeave();

  /**
   * @param options - 配置对象，见 {@link PickControllerOptions}。
   */
  constructor(options: PickControllerOptions) {
    this.dom = options.domElement;
    this.graph = options.graph;
    this.camera = options.camera;

    // 直线边（LineSegments）改用屏幕像素距离拾取（见 pickEdgeByScreen），
    // 故把 raycaster 的 line world-unit threshold 设为 0，禁用其默认的宽热区。
    this.raycaster.params.Line.threshold = 0;

    this.enabled = options.enabled ?? true;
    this.hoverEnabled = options.hover ?? true;
    this.highlightOnHover = options.highlightOnHover ?? true;
    this.highlightOnSelect = options.highlightOnSelect ?? true;
    this.neighborHighlight = options.neighborHighlight ?? true;
    this.selectionMode = options.selectionMode ?? 'single';
    this.onHover = options.onHover;
    this.onSelect = options.onSelect;

    this.dom.addEventListener('pointermove', this.onPointerMove);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('pointerleave', this.onPointerLeave);
  }

  /** 运行时启停拾取。停用时还原所有内置反馈。 */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.resetFeedback();
  }

  /** 运行时切换内置悬停反馈开关，并重算当前悬停元素视觉。 */
  setHighlightOnHover(value: boolean): void {
    this.highlightOnHover = value;
    if (this.hovered?.kind === 'node') this.reapplyNode(this.hovered.id);
    else if (this.hovered?.kind === 'edge') this.reapplyEdge(this.hovered.id);
  }

  /** 运行时切换内置选中反馈开关，并重算所有选中元素视觉。 */
  setHighlightOnSelect(value: boolean): void {
    this.highlightOnSelect = value;
    for (const id of this.selectedNodes) this.reapplyNode(id);
    for (const id of this.selectedEdges) this.reapplyEdge(id);
    this.reapplyAllEdges();
  }

  /** 运行时切换邻边高亮开关，并重算边的高亮状态。 */
  setNeighborHighlight(value: boolean): void {
    this.neighborHighlight = value;
    this.reapplyAllEdges();
  }

  /**
   * 运行时切换选中模式。
   * - 切到 `'single'` 时，若当前有多个选中，保留最近一个、清除其余。
   * - 切到 `'multiple'` 时，当前选中全部保留。
   */
  setSelectionMode(mode: 'single' | 'multiple'): void {
    if (this.selectionMode === mode) return;
    this.selectionMode = mode;
    if (mode === 'single') {
      // 保留最后一个选中元素（节点优先于边），清除其余并派 unselect。
      const lastNode = [...this.selectedNodes].pop();
      const lastEdge = [...this.selectedEdges].pop();
      this.clearSelection();
      if (lastNode !== undefined) {
        this.selectedNodes.add(lastNode);
        this.reapplyNode(lastNode);
      } else if (lastEdge !== undefined) {
        this.selectedEdges.add(lastEdge);
        this.reapplyEdge(lastEdge);
      }
      this.reapplyAllEdges();
    }
  }

  /** 取当前选中的节点 id 数组（只读副本）。 */
  getSelectedNodes(): NodeId[] {
    return [...this.selectedNodes];
  }

  /** 取当前选中的边 id 数组（只读副本）。 */
  getSelectedEdges(): NodeId[] {
    return [...this.selectedEdges];
  }

  /** 取当前悬停的元素标识（无则 null）。 */
  getHovered(): PickHit | null {
    return this.hovered;
  }

  /**
   * 每帧由渲染循环调用（可选）。当前内置反馈为即时反馈，本方法预留
   * 给后续步骤做平滑过渡（lerp emissive / scale）。
   */
  update(_delta: number): void {
    // 预留：平滑过渡反馈。当前即时反馈无需每帧逻辑。
  }

  /**
   * 清空全部选中（节点 + 边，还原反馈），并为每个被清元素派 `unselect` 事件。
   *
   * 供开发者主动调用（如点击信息面板的关闭按钮、重置场景）。
   * 点击空白/地面时 PickController 也会内部调用本方法。
   *
   * @param nativeEvent - 可选的原始事件，附带给每个 `unselect` 回调。
   * @returns 是否确实清空了（无选中时返回 false 且不派事件）。
   */
  clearSelection(nativeEvent?: PointerEvent): boolean {
    if (this.selectedNodes.size === 0 && this.selectedEdges.size === 0) return false;
    const prevNodes = [...this.selectedNodes];
    const prevEdges = [...this.selectedEdges];
    this.selectedNodes.clear();
    this.selectedEdges.clear();
    for (const id of prevNodes) {
      this.reapplyNode(id);
      this.dispatch({
        type: 'unselect',
        id,
        kind: 'node',
        nativeEvent: nativeEvent ?? new PointerEvent('pointerup'),
      });
    }
    for (const id of prevEdges) {
      this.reapplyEdge(id);
      this.dispatch({
        type: 'unselect',
        id,
        kind: 'edge',
        nativeEvent: nativeEvent ?? new PointerEvent('pointerup'),
      });
    }
    this.reapplyAllEdges();
    return true;
  }

  /**
   * 释放：移除事件监听，还原所有内置反馈状态。
   */
  dispose(): void {
    this.resetFeedback();
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
  }

  // ────────────────────────────── pointer handlers ──────────────────────────

  private handlePointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.hoverEnabled) return;
    const hit = this.pick(e);
    const prevId = this.hovered?.id;
    const nextId = hit?.id;

    if (prevId === nextId) return; // 未变化

    // 离开旧悬停。
    if (this.hovered) {
      const prev = this.hovered;
      this.hovered = null;
      if (prev.kind === 'node') this.reapplyNode(prev.id);
      else this.reapplyEdge(prev.id);
      this.dispatch({ type: 'unhover', id: prev.id, kind: prev.kind, nativeEvent: e });
    }

    // 进入新悬停。
    if (hit) {
      this.hovered = hit;
      if (hit.kind === 'node') this.reapplyNode(hit.id);
      else this.reapplyEdge(hit.id);
      this.dispatch({ type: 'hover', id: hit.id, kind: hit.kind, nativeEvent: e });
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downActive = true;
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.enabled || !this.downActive) return;
    this.downActive = false;
    // 区分点击 vs 拖拽（OrbitControls 拖拽不触发 click）。
    const dx = e.clientX - this.downX;
    const dy = e.clientY - this.downY;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return;

    const hit = this.pick(e);

    // 点击空白/地面（未命中任何元素）→ 清空选中。
    if (!hit) {
      this.clearSelection(e);
      return;
    }

    // 先派 click（节点与边都派）。
    this.dispatch({ type: 'click', id: hit.id, kind: hit.kind, nativeEvent: e });

    const set = hit.kind === 'node' ? this.selectedNodes : this.selectedEdges;
    const already = set.has(hit.id);

    if (this.selectionMode === 'single') {
      // 互斥：点已选 → 取消；点未选 → 清空旧选中后选中新元素。
      if (already) {
        set.delete(hit.id);
        if (hit.kind === 'node') this.reapplyNode(hit.id);
        else this.reapplyEdge(hit.id);
        this.reapplyAllEdges();
        this.dispatch({ type: 'unselect', id: hit.id, kind: hit.kind, nativeEvent: e });
      } else {
        // 清空旧选中（派 unselect），再选中新元素。
        this.clearSelection(e);
        set.add(hit.id);
        if (hit.kind === 'node') this.reapplyNode(hit.id);
        else this.reapplyEdge(hit.id);
        this.reapplyAllEdges();
        this.dispatch({ type: 'select', id: hit.id, kind: hit.kind, nativeEvent: e });
      }
    } else {
      // multiple：纯累加 toggle。点已选 → 取消；点未选 → 追加。
      if (already) {
        set.delete(hit.id);
        if (hit.kind === 'node') this.reapplyNode(hit.id);
        else this.reapplyEdge(hit.id);
        this.reapplyAllEdges();
        this.dispatch({ type: 'unselect', id: hit.id, kind: hit.kind, nativeEvent: e });
      } else {
        set.add(hit.id);
        if (hit.kind === 'node') this.reapplyNode(hit.id);
        else this.reapplyEdge(hit.id);
        this.reapplyAllEdges();
        this.dispatch({ type: 'select', id: hit.id, kind: hit.kind, nativeEvent: e });
      }
    }
  }

  private handlePointerLeave(): void {
    if (!this.enabled) return;
    if (this.hovered) {
      const prev = this.hovered;
      this.hovered = null;
      if (prev.kind === 'node') this.reapplyNode(prev.id);
      else this.reapplyEdge(prev.id);
      // pointerleave 无 nativeEvent 可用，构造一个空的合成事件用于回调。
      this.dispatch({ type: 'unhover', id: prev.id, kind: prev.kind, nativeEvent: new PointerEvent('pointerleave') });
    }
    this.downActive = false;
  }

  // ────────────────────────────── raycast ───────────────────────────────────

  /**
   * 把 client 坐标转 NDC 并拾取。**节点优先于边**：
   * 1. 先用 raycaster 拾取节点（mesh 面拾取，精准）。`raycaster.params.Line.threshold`
   *    已设 0，故 LineSegments 直线边**不会**被 raycaster 命中。
   * 2. 若无节点命中，再用**屏幕像素距离**判定直线边：鼠标屏幕点到边两端构成
   *    的线段的最近距离 < {@link LINE_PICK_PIXELS} 才算命中。
   *
   * 直线边用屏幕像素阈值而非 world-unit，使其热区在任意相机距离下都紧贴线本身，
   * 避免「离线很远也被拾取」。`'path'` 形态是 Mesh，走 raycaster 面拾取（见步骤 2）。
   */
  private pick(e: PointerEvent): PickHit | null {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);

    const intersects = this.raycaster.intersectObject(this.graph, true);

    // 第一轮：找节点（mesh 命中）。
    for (const it of intersects) {
      const nodeId = this.findUserData(it.object, 'nodeId');
      if (nodeId !== undefined) return { kind: 'node', id: nodeId as NodeId };
    }

    // 第二轮：path 形态边（Mesh，已被 raycaster 命中）。
    for (const it of intersects) {
      const edgeId = this.findUserData(it.object, 'edgeId');
      const edge = edgeId !== undefined ? this.graph.getEdge(edgeId as NodeId) : null;
      if (edge && edge.type === 'path') {
        return { kind: 'edge', id: edgeId as NodeId };
      }
    }

    // 第三轮：line 形态边，屏幕像素距离判定。
    return this.pickEdgeByScreen(e.clientX, e.clientY, rect);
  }

  /**
   * 用屏幕像素距离拾取直线边。遍历所有 `type==='line'` 的边，把其两端节点
   * 世界坐标投影到屏幕，算鼠标点到该线段的最近屏幕距离，取最小且 <
   * {@link LINE_PICK_PIXELS} 的边。返回 null 表示未命中。
   */
  private pickEdgeByScreen(
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ): PickHit | null {
    const edges = this.graph.getEdges();
    const w = rect.width || 1;
    const h = rect.height || 1;
    let bestId: NodeId | null = null;
    let bestDist = LINE_PICK_PIXELS;

    for (const edge of edges) {
      if (edge.type !== 'line') continue;
      const src = this.graph.getNode(edge.sourceId);
      const tgt = this.graph.getNode(edge.targetId);
      if (!src || !tgt) continue;

      // 两端世界坐标 → NDC → 屏幕像素。
      src.getWorldPosition(_projA).project(this.camera);
      tgt.getWorldPosition(_projB).project(this.camera);
      const ax = (_projA.x * 0.5 + 0.5) * w;
      const ay = (-_projA.y * 0.5 + 0.5) * h;
      const bx = (_projB.x * 0.5 + 0.5) * w;
      const by = (-_projB.y * 0.5 + 0.5) * h;

      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const dist = pointToSegmentDist(px, py, ax, ay, bx, by);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = edge.edgeId;
      }
    }
    return bestId !== null ? { kind: 'edge', id: bestId } : null;
  }

  /** 沿 object 父链回查指定 userData 键的值。 */
  private findUserData(obj: THREE.Object3D, key: string): unknown {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData[key] !== undefined) return cur.userData[key];
      cur = cur.parent;
    }
    return undefined;
  }

  // ────────────────────────────── builtin feedback ──────────────────────────

  /** 按 {选中 > 悬停 > 默认} 优先级重算单个节点的视觉。 */
  private reapplyNode(id: NodeId): void {
    const node = this.graph.getNode(id);
    if (!node) return;
    // Node3D 的材质恒为 MeshStandardMaterial（见 Node3D.getMaterial）。
    const mat = node.getMaterial() as THREE.MeshStandardMaterial;
    const isSelected = this.selectedNodes.has(id);
    const isHovered = this.hovered?.kind === 'node' && this.hovered.id === id;

    // emissive：选中 > 悬停 > 默认（仅在内置反馈开启时应用）。
    // 反馈色用强调橙（与邻边高亮色一致），靠 emissiveIntensity 控制强弱；
    // 关闭反馈或默认态时 intensity=0，emissive 不显效。
    let intensity = DEFAULT_EMISSIVE_INTENSITY;
    if (isSelected && this.highlightOnSelect) intensity = SELECT_EMISSIVE_INTENSITY;
    else if (isHovered && this.highlightOnHover) intensity = HOVER_EMISSIVE_INTENSITY;
    if (intensity > 0) {
      mat.emissive.setHex(EDGE_HIGHLIGHT_COLOR);
    } else {
      mat.emissive.setHex(0x000000);
    }
    mat.emissiveIntensity = intensity;

    // 缩放：仅悬停放大（选中不额外放大，靠 emissive 区分）。关闭反馈时还原 1。
    const targetScale = isHovered && this.highlightOnHover ? HOVER_SCALE : 1;
    node.scale.setScalar(targetScale);
  }

  /**
   * 按 {选中 > 悬停 > 默认} 优先级重算单条边的视觉。
   *
   * - 选中（且 `highlightOnSelect`）：提亮为强调橙、不透明。`'path'` 形态
   *   （MeshStandardMaterial）额外加 emissive 强化。
   * - 悬停（且 `highlightOnHover`）：提亮为强调橙、不透明（弱于选中，无 emissive）。
   * - 默认：还原色与透明度。**但**若该边是某选中节点的邻接边（见
   *   {@link reapplyAllEdges}），则保持邻接高亮 —— 故本方法不覆盖邻接高亮态，
   *   邻接高亮由 `reapplyAllEdges` 统一管理。
   *
   * 调用顺序约定：先 `reapplyAllEdges`（决定邻接高亮底色），再 `reapplyEdge`
   * （在 hover/select 时覆盖为更强态）。本方法在「非 hover/非 select」时
   * 仅还原默认，不主动应用邻接高亮（避免与 reapplyAllEdges 重复）。
   */
  private reapplyEdge(id: NodeId): void {
    const edge = this.graph.getEdge(id);
    if (!edge) return;
    const mat = edge.getMaterial();
    const isSelected = this.selectedEdges.has(id);
    const isHovered = this.hovered?.kind === 'edge' && this.hovered.id === id;
    const active = (isSelected && this.highlightOnSelect) || (isHovered && this.highlightOnHover);

    if (active) {
      mat.color.setHex(EDGE_HIGHLIGHT_COLOR);
      mat.transparent = true;
      mat.opacity = 1;
      // 'path' 形态是 MeshStandardMaterial，加 emissive 强化选中/悬停。
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(EDGE_HIGHLIGHT_COLOR);
        mat.emissiveIntensity = isSelected ? SELECT_EMISSIVE_INTENSITY : HOVER_EMISSIVE_INTENSITY;
      }
    } else {
      // 还原默认色/透明度（邻接高亮态由 reapplyAllEdges 覆盖，此处还原后会被它重设）。
      mat.color.setHex(EDGE_DEFAULT_COLOR);
      mat.transparent = edge.type === 'line';
      mat.opacity = edge.type === 'line' ? 0.85 : 1;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
      }
    }
  }

  /**
   * 重算所有边的状态：先全部还原默认，再应用「邻接边高亮」。
   *
   * 邻接边高亮：当存在选中**节点**且 `neighborHighlight` 开启时，把选中节点的
   * 关联边提亮为强调橙（不透明）；**其余边保持默认原状不变**（不 dim、不删除）。
   *
   * 注意：边的自身 hover/select 反馈由 {@link reapplyEdge} 覆盖，优先级高于
   * 邻接高亮。调用方应先调本方法设邻接底色，再对 hover/select 边调 reapplyEdge。
   */
  private reapplyAllEdges(): void {
    const edges = this.graph.getEdges();
    const index = this.graph.getIndex();
    const hasNodeSelection = this.selectedNodes.size > 0 && this.neighborHighlight;

    // 收集所有选中节点的邻接边 id。
    const highlightEdgeIds = new Set<NodeId>();
    if (hasNodeSelection && index) {
      const byEndpoints = new Map<string, Edge3D>();
      for (const e of edges) byEndpoints.set(`${e.sourceId}->${e.targetId}`, e);

      for (const nodeId of this.selectedNodes) {
        const incident = index.incidentEdges.get(nodeId) ?? [];
        for (const ie of incident) {
          // incidentEdges 记录的是原始 source/target；匹配正向或反向的边。
          const fwd = `${ie.source}->${ie.target}`;
          const rev = `${ie.target}->${ie.source}`;
          const e = byEndpoints.get(fwd) ?? byEndpoints.get(rev);
          if (e) highlightEdgeIds.add(e.edgeId);
        }
      }
    }

    for (const edge of edges) {
      const mat = edge.getMaterial();
      const isHovered = this.hovered?.kind === 'edge' && this.hovered.id === edge.edgeId;
      const isSelected = this.selectedEdges.has(edge.edgeId);
      const edgeActive =
        (isSelected && this.highlightOnSelect) || (isHovered && this.highlightOnHover);
      const neighborHighlight = hasNodeSelection && highlightEdgeIds.has(edge.edgeId);

      if (edgeActive) {
        // 边自身 hover/select 优先级最高。
        mat.color.setHex(EDGE_HIGHLIGHT_COLOR);
        mat.transparent = true;
        mat.opacity = 1;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(EDGE_HIGHLIGHT_COLOR);
          mat.emissiveIntensity = isSelected ? SELECT_EMISSIVE_INTENSITY : HOVER_EMISSIVE_INTENSITY;
        }
      } else if (neighborHighlight) {
        // 邻接边高亮：提亮、不透明，无 emissive（区分于边自身选中）。
        mat.color.setHex(EDGE_HIGHLIGHT_COLOR);
        mat.transparent = true;
        mat.opacity = 1;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
        }
      } else {
        // 其余边保持默认原状（不 dim、不删除）。
        mat.color.setHex(EDGE_DEFAULT_COLOR);
        mat.transparent = edge.type === 'line';
        mat.opacity = edge.type === 'line' ? 0.85 : 1;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = DEFAULT_EMISSIVE_INTENSITY;
        }
      }
    }
  }

  /** 还原所有内置反馈到默认（hover/select 清空时调用）。 */
  private resetFeedback(): void {
    const prevHovered = this.hovered;
    const prevNodes = [...this.selectedNodes];
    const prevEdges = [...this.selectedEdges];
    this.hovered = null;
    this.selectedNodes.clear();
    this.selectedEdges.clear();

    if (prevHovered?.kind === 'node') this.reapplyNode(prevHovered.id);
    else if (prevHovered?.kind === 'edge') this.reapplyEdge(prevHovered.id);
    for (const id of prevNodes) this.reapplyNode(id);
    for (const id of prevEdges) this.reapplyEdge(id);
    this.reapplyAllEdges();
  }

  // ────────────────────────────── event dispatch ────────────────────────────

  /** 构造 GraphEvent 并回调用户处理器（附带元素 data）。 */
  private dispatch(
    base: Omit<GraphEvent, 'data'>,
  ): void {
    const data = this.readElementData(base.kind, base.id);
    const evt: GraphEvent = { ...base, data };
    if (base.type === 'hover' || base.type === 'unhover') {
      this.onHover?.(evt);
    } else {
      this.onSelect?.(evt);
    }
  }

  /** 读取节点/边携带的 data 字段（用于事件回调）。 */
  private readElementData(kind: GraphPickKind, id: NodeId): Record<string, unknown> | undefined {
    if (kind === 'node') {
      return this.graph.getNode(id)?.data?.data as Record<string, unknown> | undefined;
    }
    const edges = this.graph.getEdges();
    const edge = edges.find((e) => e.edgeId === id);
    // Edge3D 未直接暴露 data；从 Graph3D 规范化数据回查。
    if (!edge) return undefined;
    const graphData = this.graph.getData();
    if (!graphData) return undefined;
    const edgeData = graphData.edges.find((e) => e.id === id);
    return edgeData?.data as Record<string, unknown> | undefined;
  }
}

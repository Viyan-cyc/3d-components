
import * as THREE from 'three';
import type { IDisposable, IUpdatable } from '../../types';
import {
  makeBackdropTexture, makeCircleTexture, makeLabelTexture, makeRingTexture,
} from './textures';
import type { GizmoContent } from './GizmoHelper';

/** 单条轴的亮 / 暗双色 `[正面色, 背面色]`。 */
export type AxisColorPair = [THREE.ColorRepresentation, THREE.ColorRepresentation];

/**
 * Options for constructing a {@link GizmoViewport}.
 *
 * @example
 * ```ts
 * const opts: GizmoViewportOptions = {
 *   onPick: (dir) => gizmo.tweenCamera(dir),
 *   colors: { x: ['#f73c3c', '#942424'], y: ['#6ccb26', '#417a17'], z: ['#178cf0', '#0e5490'] },
 * };
 * ```
 */
export interface GizmoViewportOptions {

  /**
   * 点击轴头时的回调，参数为该轴的世界方向（如 `(1,0,0)`）。
   * 通常传 `(dir) => gizmo.tweenCamera(dir)`。
   */
  onPick?: (direction: THREE.Vector3) => void;

  /**
   * 三轴颜色，每条轴为 `[正面亮色, 背面暗色]`。
   * @default { x:['#f73c3c','#942424'], y:['#6ccb26','#417a17'], z:['#178cf0','#0e5490'] }
   */
  colors?: { x: AxisColorPair; y: AxisColorPair; z: AxisColorPair };

  /** 正轴气泡标签文字 `[X, Y, Z]`（常显）。 @default ['X','Y','Z'] */
  labels?: [string, string, string];

  /** 负轴气泡标签文字 `[-X, -Y, -Z]`（仅悬停时显示）。 @default ['-X','-Y','-Z'] */
  negativeLabels?: [string, string, string];

  /** 标签文字常规色（正轴未悬停时）。 @default '#222222' */
  labelColor?: THREE.ColorRepresentation;

  /** 悬停时文字变白的颜色。 @default '#ffffff' */
  hoverColor?: THREE.ColorRepresentation;

  /** 负轴气泡填充透明度。 @default 0.35 */
  negativeOpacity?: number;

  /** 整体悬停时出现的白色圆底透明度（0 关闭）。 @default 0.13 */
  backdropOpacity?: number;

  /** 气泡整体缩放。 @default 1 */
  size?: number;

  /** 是否隐藏负方向轴头（−X/−Y/−Z）。 @default false */
  hideNegativeAxes?: boolean;

  /** 是否隐藏所有轴头（仅保留轴线）。 @default false */
  hideAxisHeads?: boolean;

  /** 是否禁用点击拾取。 @default false */
  disabled?: boolean;

  /** `Object3D.name`。 */
  name?: string;
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);

// ---- 视口 gizmo 布局常量 ----
const PRIMARY_BUBBLE_SCALE = 0.42;
const NEGATIVE_BUBBLE_SCALE = 0.34;
const LETTER_RATIO = 0.62;
const HIT_SPRITE_MIN = 0.34;
const HIT_SPRITE_SCALE = 1.7;
const HEAD_DISTANCE = 1.0;
const BACKDROP_SCALE = 2.7;
const BACKDROP_RENDER_ORDER = -100;
const HIT_RENDER_ORDER = -1;
const LINE_RADIUS = 0.022;
const LINE_SEGMENTS = 8;
const LINE_ORIGIN_OFFSET = 0.5;
const FRONT_Z_THRESHOLD = -0.001;
const DEPTH_SORT_STEP = 4;
const DEFAULT_NEGATIVE_OPACITY = 0.35;
const DEFAULT_BACKDROP_OPACITY = 0.13;

interface AxisEntry {

  /** 单位方向（局部）。 */
  dir: THREE.Vector3;
  primary: boolean;
  bright: THREE.Color;
  dark: THREE.Color;

  /** 逐帧计算：该轴在镜像后世界空间中的 z（用于深度色与绘制排序）。 */
  worldZ: number;
  bubble: THREE.Sprite;
  bubbleMat: THREE.SpriteMaterial;

  /** 不可见的较大命中精灵（拾取 / 悬停判定用，比可见气泡大一圈，便于命中）。 */
  hit: THREE.Sprite;
  line: THREE.Mesh | null;
  lineMat: THREE.MeshBasicMaterial | null;
  letter: THREE.Sprite | null;
  letterMat: THREE.SpriteMaterial | null;
}

const AXES_DEF = [
  { key: 'x', dir: new THREE.Vector3(1, 0, 0) },
  { key: 'y', dir: new THREE.Vector3(0, 1, 0) },
  { key: 'z', dir: new THREE.Vector3(0, 0, 1) },
] as const;

/**
 * GizmoViewport —— 三轴视口指示器（GizmoHelper 的默认内容），仿 **ThreeOrbitControlsGizmo**
 * （[Fennec-hub/ThreeOrbitControlsGizmo](https://github.com/Fennec-hub/ThreeOrbitControlsGizmo)）的 2D 扁平气泡样式。
 *
 * 样式细节：
 * - **连接线**：仅 +X / +Y / +Z 正轴从中心连出细彩色线；负轴无线。
 * - **正轴气泡**：实心彩色圆 + 常显暗色字母（X/Y/Z）。
 * - **负轴气泡**：半透明同色填充 + 同色实心边框；字母（−X/−Y/−Z）仅悬停时显示。
 * - **深度色**：每帧按各轴朝向切换 正面=亮色 / 背面=暗色，并按深度排序绘制（前压后）。
 * - **整体悬停**：鼠标进入 helper 区域时，背后浮现一个浅白色透明圆底（`backdropOpacity` 可调）。
 * - **气泡悬停**：悬停某个气泡时，**仅其字母变白**，气泡填充 / 边框不变。
 *
 * 气泡为始终面向相机的 `Sprite`。点击任一轴头触发 {@link GizmoViewportOptions.onPick}，
 * 交由 {@link GizmoHelper.tweenCamera} 把主相机平滑旋转到对应标准视角。
 *
 * @example
 * ```ts
 * import { GizmoViewport } from '@a3d/a3d-components/helper';
 *
 * const viewport = new GizmoViewport({ onPick: (dir) => gizmo.tweenCamera(dir) });
 * gizmo.setContent(viewport);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link GizmoContent} and {@link IDisposable}.
 */
export class GizmoViewport extends THREE.Group implements IUpdatable, IDisposable, GizmoContent {
  /** 可被射线拾取的子对象（轴头气泡精灵）。 */
  readonly pickables: THREE.Object3D[] = [];

  private readonly _disposables: { dispose: () => void }[] = [];
  private readonly _onPick?: (direction: THREE.Vector3) => void;
  private readonly _disabled: boolean;
  private readonly _labelColor: THREE.Color;
  private readonly _hoverColor: THREE.Color;
  private readonly _entries: AxisEntry[] = [];
  private readonly _worldDir = new THREE.Vector3();
  private readonly _backdrop: THREE.Sprite;
  private _backdropMat!: THREE.SpriteMaterial;

  /**
   * @param options - 配置对象，所有属性均为可选（`onPick` 强烈建议提供）。
   */
  constructor(options: GizmoViewportOptions = {}) {
    super();
    this.name = options.name ?? 'GizmoViewport';

    const {
      onPick,
      colors = {
        x: ['#f73c3c', '#942424'],
        y: ['#6ccb26', '#417a17'],
        z: ['#178cf0', '#0e5490'],
      },
      labels = ['X', 'Y', 'Z'],
      negativeLabels = ['-X', '-Y', '-Z'],
      labelColor = '#222222',
      hoverColor = '#ffffff',
      negativeOpacity = DEFAULT_NEGATIVE_OPACITY,
      backdropOpacity = DEFAULT_BACKDROP_OPACITY,
      size = 1,
      hideNegativeAxes = false,
      hideAxisHeads = false,
      disabled = false,
    } = options;

    this._onPick = onPick;
    this._disabled = disabled;
    this._labelColor = new THREE.Color(labelColor);
    this._hoverColor = new THREE.Color(hoverColor);

    const shared = this._createSharedAssets(negativeOpacity);
    const bubbleScales = this._computeBubbleScales(size);

    this._buildAxes({
      colors,
      labels,
      negativeLabels,
      shared,
      bubbleScales,
      showNegative: !hideNegativeAxes,
      withHead: !hideAxisHeads,
    });

    this._backdrop = this._createBackdrop(backdropOpacity, size);
  }

  /** 创建共享贴图和材质。 */
  private _createSharedAssets(negativeOpacity: number): {
    circleTex: THREE.CanvasTexture;
    ringTex: THREE.CanvasTexture;
    hitMat: THREE.SpriteMaterial;
    lineGeo: THREE.BufferGeometry;
  } {
    // 共享贴图：实心圆（正轴）、半透明填充+实心边框（负轴）、字母（白字可着色）
    const circleTex = makeCircleTexture();
    const ringTex = makeRingTexture(negativeOpacity);
    this._disposables.push(circleTex, ringTex);

    // 命中精灵共用材质（不可见，仅用于射线拾取 / 悬停判定）
    const hitMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this._disposables.push(hitMat);

    // 细轴线几何体（沿 Y，0..1，原点端在中心）
    const lineGeo = new THREE.CylinderGeometry(LINE_RADIUS, LINE_RADIUS, 1, LINE_SEGMENTS);
    lineGeo.translate(0, LINE_ORIGIN_OFFSET, 0);
    this._disposables.push(lineGeo);

    return {
      circleTex,
      ringTex,
      hitMat,
      lineGeo,
    };
  }

  /** 计算气泡缩放参数。 */
  private _computeBubbleScales(size: number): {
    primaryBubble: number;
    negativeBubble: number;
    letterScale: number;
  } {
    const primaryBubble = PRIMARY_BUBBLE_SCALE * size;
    const negativeBubble = NEGATIVE_BUBBLE_SCALE * size;
    const letterScale = primaryBubble * LETTER_RATIO;
    return {
      primaryBubble,
      negativeBubble,
      letterScale,
    };
  }

  /** 构建所有轴线。 */
  private _buildAxes(cfg: {
    colors: { x: AxisColorPair; y: AxisColorPair; z: AxisColorPair };
    labels: [string, string, string];
    negativeLabels: [string, string, string];
    shared: {
      circleTex: THREE.CanvasTexture;
      ringTex: THREE.CanvasTexture;
      hitMat: THREE.SpriteMaterial;
      lineGeo: THREE.BufferGeometry;
    };
    bubbleScales: { primaryBubble: number; negativeBubble: number; letterScale: number };
    showNegative: boolean;
    withHead: boolean;
  }): void {
    for (let i = 0; i < AXES_DEF.length; i++) {
      this._buildSingleAxis(i, cfg);
    }
  }

  /** 构建单条轴的正/负方向。 */
  private _buildSingleAxis(index: number, cfg: {
    colors: { x: AxisColorPair; y: AxisColorPair; z: AxisColorPair };
    labels: [string, string, string];
    negativeLabels: [string, string, string];
    shared: {
      circleTex: THREE.CanvasTexture;
      ringTex: THREE.CanvasTexture;
      hitMat: THREE.SpriteMaterial;
      lineGeo: THREE.BufferGeometry;
    };
    bubbleScales: { primaryBubble: number; negativeBubble: number; letterScale: number };
    showNegative: boolean;
    withHead: boolean;
  }): void {
    const def = AXES_DEF[index];
    const pair = cfg.colors[def.key];
    const bright = new THREE.Color(pair[0]);
    const dark = new THREE.Color(pair[1]);

    // 正轴：线 + 实心气泡 + 常显字母
    this._addPrimaryAxis(def.dir, bright, dark, cfg, index);
    // 负轴：无线 + 半透明带边框气泡 + 悬停字母
    if (cfg.showNegative) {
      this._addNegativeAxis(def.dir, bright, dark, cfg, index);
    }
  }

  /** 添加正轴。 */
  private _addPrimaryAxis(
    dir: THREE.Vector3,
    bright: THREE.Color,
    dark: THREE.Color,
    cfg: {
      shared: { circleTex: THREE.CanvasTexture; hitMat: THREE.SpriteMaterial; lineGeo: THREE.BufferGeometry };
      bubbleScales: { primaryBubble: number; letterScale: number };
      withHead: boolean;
      labels: [string, string, string];
    },
    index: number,
  ): void {
    this._addAxis({
      direction: dir,
      primary: true,
      bright,
      dark,
      headTex: cfg.shared.circleTex,
      lineGeo: cfg.shared.lineGeo,
      hitMat: cfg.shared.hitMat,
      withHead: cfg.withHead,
      bubbleScale: cfg.bubbleScales.primaryBubble,
      letterScale: cfg.bubbleScales.letterScale,
      label: cfg.labels[index],
    });
  }

  /** 添加负轴。 */
  private _addNegativeAxis(
    dir: THREE.Vector3,
    bright: THREE.Color,
    dark: THREE.Color,
    cfg: {
      shared: { ringTex: THREE.CanvasTexture; hitMat: THREE.SpriteMaterial; lineGeo: THREE.BufferGeometry };
      bubbleScales: { negativeBubble: number; letterScale: number };
      withHead: boolean;
      negativeLabels: [string, string, string];
    },
    index: number,
  ): void {
    const negDir = dir.clone().multiplyScalar(-1);
    this._addAxis({
      direction: negDir,
      primary: false,
      bright,
      dark,
      headTex: cfg.shared.ringTex,
      lineGeo: cfg.shared.lineGeo,
      hitMat: cfg.shared.hitMat,
      withHead: cfg.withHead,
      bubbleScale: cfg.bubbleScales.negativeBubble,
      letterScale: cfg.bubbleScales.letterScale,
      label: cfg.negativeLabels[index],
    });
  }

  /** 创建整体悬停时的浅白圆底。 */
  private _createBackdrop(opacity: number, size: number): THREE.Sprite {
    const backdropTex = makeBackdropTexture();
    this._disposables.push(backdropTex);
    this._backdropMat = new THREE.SpriteMaterial({
      map: backdropTex,
      color: 0xffffff,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    this._disposables.push(this._backdropMat);
    const sprite = new THREE.Sprite(this._backdropMat);
    sprite.scale.setScalar(BACKDROP_SCALE * size);
    sprite.renderOrder = BACKDROP_RENDER_ORDER;
    sprite.visible = false;
    this.add(sprite);
    return sprite;
  }

  /** 创建正轴的连接线。 */
  private _createLine(
    direction: THREE.Vector3,
    bright: THREE.Color,
    lineGeo: THREE.BufferGeometry,
  ): { line: THREE.Mesh; lineMat: THREE.MeshBasicMaterial } {
    const lineMat = new THREE.MeshBasicMaterial({
      color: bright.clone(),
      transparent: true,
      depthTest: false,
    });
    this._disposables.push(lineMat);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.quaternion.setFromUnitVectors(AXIS_Y, direction);
    this.add(line);
    return { line, lineMat };
  }

  /** 创建命中精灵。 */
  private _createHitSprite(
    direction: THREE.Vector3,
    bubbleScale: number,
    hitMat: THREE.SpriteMaterial,
  ): THREE.Sprite {
    const hit = new THREE.Sprite(hitMat);
    hit.position.copy(direction).multiplyScalar(HEAD_DISTANCE);
    hit.scale.setScalar(Math.max(bubbleScale, HIT_SPRITE_MIN) * HIT_SPRITE_SCALE);
    // 不渲染，但仍参与射线拾取（matrixWorld 照常更新）
    hit.visible = false;
    hit.renderOrder = HIT_RENDER_ORDER;
    this.add(hit);
    return hit;
  }

  /** 创建气泡精灵。 */
  private _createBubble(
    direction: THREE.Vector3,
    headTex: THREE.Texture,
    bright: THREE.Color,
    bubbleScale: number,
  ): { bubble: THREE.Sprite; bubbleMat: THREE.SpriteMaterial } {
    const bubbleMat = new THREE.SpriteMaterial({
      map: headTex,
      color: bright.clone(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this._disposables.push(bubbleMat);
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.position.copy(direction).multiplyScalar(HEAD_DISTANCE);
    bubble.scale.setScalar(bubbleScale);
    this.add(bubble);
    return { bubble, bubbleMat };
  }

  /** 创建字母精灵。 */
  private _createLetter(
    direction: THREE.Vector3,
    label: string,
    letterScale: number,
    primary: boolean,
  ): { letter: THREE.Sprite; letterMat: THREE.SpriteMaterial } {
    const labelTex = makeLabelTexture(label);
    this._disposables.push(labelTex);
    const letterMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this._disposables.push(letterMat);
    const letter = new THREE.Sprite(letterMat);
    letter.position.copy(direction).multiplyScalar(HEAD_DISTANCE);
    // 按贴图宽高比设置 scale，保持字号一致（高度相同），多字符仅横向变宽
    const aspect = labelTex.image.width / labelTex.image.height;
    letter.scale.set(letterScale * aspect, letterScale, 1);
    // 负轴字母默认隐藏，仅悬停显示
    letter.visible = primary;
    this.add(letter);
    return { letter, letterMat };
  }

  /**
   * 添加一条轴：正轴含细线；气泡（正轴实心 / 负轴带边框）；字母（正轴常显，负轴默认隐藏）。
   */
  private _addAxis(cfg: {
    direction: THREE.Vector3;
    primary: boolean;
    bright: THREE.Color;
    dark: THREE.Color;
    headTex: THREE.Texture;
    lineGeo: THREE.BufferGeometry;
    hitMat: THREE.SpriteMaterial;
    withHead: boolean;
    bubbleScale: number;
    letterScale: number;
    label: string;
  }): void {
    const lineResult = this._createAxisLine(cfg);
    const hit = this._createHitSprite(cfg.direction, cfg.bubbleScale, cfg.hitMat);
    const headResult = this._createAxisHead(cfg, hit);

    this._pushEntry(cfg, lineResult, hit, headResult);
    this._setupPickable(cfg.direction, hit);
  }

  /** 创建轴线（仅正轴有连接线）。 */
  private _createAxisLine(cfg: {
    primary: boolean;
    direction: THREE.Vector3;
    bright: THREE.Color;
    lineGeo: THREE.BufferGeometry;
  }): { line: THREE.Mesh | null; lineMat: THREE.MeshBasicMaterial | null } {
    if (!cfg.primary) {
      return { line: null, lineMat: null };
    }
    const result = this._createLine(cfg.direction, cfg.bright, cfg.lineGeo);
    return { line: result.line, lineMat: result.lineMat };
  }

  /** 创建气泡和字母（仅在 withHead 时）。 */
  private _createAxisHead(
    cfg: {
      direction: THREE.Vector3;
      headTex: THREE.Texture;
      hitMat: THREE.SpriteMaterial;
      bright: THREE.Color;
      bubbleScale: number;
      label: string;
      letterScale: number;
      primary: boolean;
      withHead: boolean;
    },
    fallbackHit: THREE.Sprite,
  ): {
    bubble: THREE.Sprite;
    bubbleMat: THREE.SpriteMaterial;
    letter: THREE.Sprite | null;
    letterMat: THREE.SpriteMaterial | null;
  } {
    if (!cfg.withHead) {
      return {
        bubble: fallbackHit,
        bubbleMat: cfg.hitMat,
        letter: null,
        letterMat: null,
      };
    }
    const bubbleResult = this._createBubble(cfg.direction, cfg.headTex, cfg.bright, cfg.bubbleScale);
    let letter: THREE.Sprite | null = null;
    let letterMat: THREE.SpriteMaterial | null = null;
    if (cfg.label) {
      const letterResult = this._createLetter(cfg.direction, cfg.label, cfg.letterScale, cfg.primary);
      letter = letterResult.letter;
      letterMat = letterResult.letterMat;
    }
    return {
      bubble: bubbleResult.bubble,
      bubbleMat: bubbleResult.bubbleMat,
      letter,
      letterMat,
    };
  }

  /** 构造并保存 AxisEntry。 */
  private _pushEntry(
    cfg: {
      direction: THREE.Vector3;
      primary: boolean;
      bright: THREE.Color;
      dark: THREE.Color;
    },
    lineResult: { line: THREE.Mesh | null; lineMat: THREE.MeshBasicMaterial | null },
    hit: THREE.Sprite,
    headResult: {
      bubble: THREE.Sprite;
      bubbleMat: THREE.SpriteMaterial;
      letter: THREE.Sprite | null;
      letterMat: THREE.SpriteMaterial | null;
    },
  ): void {
    const entry: AxisEntry = {
      dir: cfg.direction,
      primary: cfg.primary,
      bright: cfg.bright,
      dark: cfg.dark,
      worldZ: 0,
      bubble: headResult.bubble,
      bubbleMat: headResult.bubbleMat,
      hit,
      line: lineResult.line,
      lineMat: lineResult.lineMat,
      letter: headResult.letter,
      letterMat: headResult.letterMat,
    };
    this._entries.push(entry);
  }

  /** 设置拾取回调。 */
  private _setupPickable(direction: THREE.Vector3, hit: THREE.Sprite): void {
    if (this._disabled || !this._onPick) {
      return;
    }
    const dir = direction.clone();
    hit.userData.onPick = () => this._onPick!(dir);
    this.pickables.push(hit);
  }

  /** 计算各轴世界 Z 并按深度排序。 */
  private _sortEntriesByDepth(): void {
    for (const e of this._entries) {
      this._worldDir.copy(e.dir).applyQuaternion(this.quaternion);
      e.worldZ = this._worldDir.z;
    }
    // 按深度排序：背面（z 小）先画，正面（z 大）后画 → 正面压在背面之上
    this._entries.sort((a, b) => a.worldZ - b.worldZ);
  }

  /** 更新单条轴的渲染状态。 */
  private _updateEntry(e: AxisEntry, index: number): void {
    const front = e.worldZ >= FRONT_Z_THRESHOLD;
    const base = front ? e.bright : e.dark;

    // 气泡填充 / 边框与线：仅随深度变色，悬停不变（req5：背景不变）
    e.bubbleMat.color.copy(base);
    if (e.lineMat) {
      e.lineMat.color.copy(base);
    }

    // 绘制层级（前压后；同轴内 字母 > 气泡 > 线）
    const baseRO = index * DEPTH_SORT_STEP;
    if (e.line) {
      e.line.renderOrder = baseRO;
    }
    e.bubble.renderOrder = baseRO + 1;
    if (e.letter) {
      e.letter.renderOrder = baseRO + 2;
    }

    // 字母：正轴常显（悬停→白），负轴仅悬停显示（白）。
    // 悬停判定基于较大的命中精灵。
    const hovered = e.hit.userData.gizmoHover === true;
    if (e.letter && e.letterMat) {
      if (e.primary) {
        e.letter.visible = true;
        e.letterMat.color.copy(hovered ? this._hoverColor : this._labelColor);
      } else {
        e.letter.visible = hovered;
        if (hovered) {
          e.letterMat.color.copy(this._hoverColor);
        }
      }
    }
  }

  /**
   * 逐帧：计算各轴深度 → 排序绘制顺序 → 按 正/背 切换亮暗色；整体悬停显圆底；气泡悬停仅字母变白。
   * 由 GizmoHelper 在镜像相机朝向后调用。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_delta: number): void {
    // 整体悬停 → 浅白圆底
    this._backdrop.visible = this.userData.helperHover === true;

    this._sortEntriesByDepth();

    for (let i = 0; i < this._entries.length; i++) {
      this._updateEntry(this._entries[i], i);
    }
  }

  /**
   * 释放所有几何体 / 材质 / 贴图。
   */
  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
    this.pickables.length = 0;
    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
    this.clear();
  }
}

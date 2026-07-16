import * as THREE from 'three';
import { BaseGroup } from '../../core/BaseGroup';
import type { GizmoContent } from './GizmoHelper';
import { makeCircleTexture, makeRingTexture, makeBackdropTexture, makeLabelTexture } from './textures';

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

interface AxisEntry {
  dir: THREE.Vector3; // 单位方向（局部）
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
 * import { GizmoViewport } from '@cyc/3d-components/helper';
 *
 * const viewport = new GizmoViewport({ onPick: (dir) => gizmo.tweenCamera(dir) });
 * gizmo.setContent(viewport);
 * ```
 *
 * @extends BaseGroup (THREE.Group)
 *
 * Implements {@link GizmoContent} and {@link IDisposable}（继承自 BaseGroup）。
 */
export class GizmoViewport extends BaseGroup implements GizmoContent {
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
  private readonly _backdropMat: THREE.SpriteMaterial;

  /**
   * @param options - 配置对象，所有属性均为可选（`onPick` 强烈建议提供）。
   */
  constructor(options: GizmoViewportOptions = {}) {
    super({ name: options.name ?? 'GizmoViewport' });

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
      negativeOpacity = 0.35,
      backdropOpacity = 0.13,
      size = 1,
      hideNegativeAxes = false,
      hideAxisHeads = false,
      disabled = false,
    } = options;

    this._onPick = onPick;
    this._disabled = disabled;
    this._labelColor = new THREE.Color(labelColor);
    this._hoverColor = new THREE.Color(hoverColor);

    // 共享贴图：实心圆（正轴）、半透明填充+实心边框（负轴）、字母（白字可着色）
    const circleTex = makeCircleTexture();
    const ringTex = makeRingTexture(negativeOpacity);
    this._disposables.push(circleTex, ringTex);

    // 命中精灵共用材质（不可见，仅用于射线拾取 / 悬停判定）
    const hitMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this._disposables.push(hitMat);

    // 细轴线几何体（沿 Y，0..1，原点端在中心）
    const lineGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
    lineGeo.translate(0, 0.5, 0);
    this._disposables.push(lineGeo);

    for (let i = 0; i < AXES_DEF.length; i++) {
      const def = AXES_DEF[i];
      const pair = colors[def.key];
      const bright = new THREE.Color(pair[0]);
      const dark = new THREE.Color(pair[1]);

      // 气泡尺寸（负轴略小）；字母尺寸统一按正轴气泡计算 → −X/−Y/−Z 与 X/Y/Z 字号一致
      const primaryBubble = 0.42 * size;
      const negativeBubble = 0.34 * size;
      const letterScale = primaryBubble * 0.62;

      // 正轴：线 + 实心气泡 + 常显字母
      this._addAxis(def.dir, true, bright, dark, circleTex, lineGeo, hitMat, !hideAxisHeads, primaryBubble, letterScale, labels[i]);
      // 负轴：无线 + 半透明带边框气泡 + 悬停字母
      if (!hideNegativeAxes) {
        this._addAxis(def.dir.clone().multiplyScalar(-1), false, bright, dark, ringTex, lineGeo, hitMat, !hideAxisHeads, negativeBubble, letterScale, negativeLabels[i]);
      }
    }

    // 整体悬停时的浅白圆底（始终朝向相机、不参与深度，renderOrder 最低 → 最后面）
    const backdropTex = makeBackdropTexture();
    this._disposables.push(backdropTex);
    this._backdropMat = new THREE.SpriteMaterial({
      map: backdropTex,
      color: 0xffffff,
      transparent: true,
      opacity: backdropOpacity,
      depthTest: false,
      depthWrite: false,
    });
    this._disposables.push(this._backdropMat);
    this._backdrop = new THREE.Sprite(this._backdropMat);
    this._backdrop.scale.setScalar(2.7 * size);
    this._backdrop.renderOrder = -100;
    this._backdrop.visible = false;
    this.add(this._backdrop);
  }

  /**
   * 添加一条轴：正轴含细线；气泡（正轴实心 / 负轴带边框）；字母（正轴常显，负轴默认隐藏）。
   */
  private _addAxis(
    direction: THREE.Vector3,
    primary: boolean,
    bright: THREE.Color,
    dark: THREE.Color,
    headTex: THREE.Texture,
    lineGeo: THREE.BufferGeometry,
    hitMat: THREE.SpriteMaterial,
    withHead: boolean,
    bubbleScale: number,
    letterScale: number,
    label: string,
  ): void {
    // 仅正轴有连接线
    let line: THREE.Mesh | null = null;
    let lineMat: THREE.MeshBasicMaterial | null = null;
    if (primary) {
      lineMat = new THREE.MeshBasicMaterial({ color: bright.clone(), transparent: true, depthTest: false });
      this._disposables.push(lineMat);
      line = new THREE.Mesh(lineGeo, lineMat);
      line.quaternion.setFromUnitVectors(AXIS_Y, direction);
      this.add(line);
    }

    let bubble: THREE.Sprite | null = null;
    let bubbleMat: THREE.SpriteMaterial | null = null;
    let letter: THREE.Sprite | null = null;
    let letterMat: THREE.SpriteMaterial | null = null;

    // 不可见的较大命中精灵：拾取 / 悬停判定都用它，命中范围比可见气泡大一圈，
    // 这样鼠标只要进入气泡附近即可触发（不必精确压在字母上）。
    const hit = new THREE.Sprite(hitMat);
    hit.position.copy(direction).multiplyScalar(1.0);
    hit.scale.setScalar(Math.max(bubbleScale, 0.34) * 1.7);
    hit.visible = false; // 不渲染，但仍参与射线拾取（matrixWorld 照常更新）
    hit.renderOrder = -1;
    this.add(hit);

    if (withHead) {
      bubbleMat = new THREE.SpriteMaterial({
        map: headTex,
        color: bright.clone(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this._disposables.push(bubbleMat);
      bubble = new THREE.Sprite(bubbleMat);
      bubble.position.copy(direction).multiplyScalar(1.0);
      bubble.scale.setScalar(bubbleScale);
      this.add(bubble);

      if (label) {
        const labelTex = makeLabelTexture(label);
        this._disposables.push(labelTex);
        letterMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false, depthWrite: false });
        this._disposables.push(letterMat);
        letter = new THREE.Sprite(letterMat);
        letter.position.copy(direction).multiplyScalar(1.0);
        // 按贴图宽高比设置 scale，保持字号一致（高度相同），多字符仅横向变宽
        const aspect = labelTex.image.width / labelTex.image.height;
        letter.scale.set(letterScale * aspect, letterScale, 1);
        // 负轴字母默认隐藏，仅悬停显示
        letter.visible = primary;
        this.add(letter);
      }
    }

    const entry: AxisEntry = { dir: direction, primary, bright, dark, worldZ: 0, bubble: bubble ?? hit, bubbleMat: bubbleMat ?? hitMat, hit, line, lineMat, letter, letterMat };
    this._entries.push(entry);

    // 拾取回调（挂在 hit 精灵上）
    if (!this._disabled && this._onPick) {
      const dir = direction.clone();
      hit.userData.onPick = () => this._onPick!(dir);
      this.pickables.push(hit);
    }
  }

  /**
   * 逐帧：计算各轴深度 → 排序绘制顺序 → 按 正/背 切换亮暗色；整体悬停显圆底；气泡悬停仅字母变白。
   * 由 GizmoHelper 在镜像相机朝向后调用。
   */
  update(_delta: number): void {
    // 整体悬停 → 浅白圆底
    this._backdrop.visible = this.userData.helperHover === true;

    // 计算各轴（镜像后）世界 z
    for (const e of this._entries) {
      this._worldDir.copy(e.dir).applyQuaternion(this.quaternion);
      e.worldZ = this._worldDir.z;
    }
    // 按深度排序：背面（z 小）先画，正面（z 大）后画 → 正面压在背面之上
    this._entries.sort((a, b) => a.worldZ - b.worldZ);

    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      const front = e.worldZ >= -0.001;
      const base = front ? e.bright : e.dark;

      // 气泡填充 / 边框与线：仅随深度变色，悬停不变（req5：背景不变）
      e.bubbleMat.color.copy(base);
      if (e.lineMat) e.lineMat.color.copy(base);

      // 绘制层级（前压后；同轴内 字母 > 气泡 > 线）
      const baseRO = i * 4;
      if (e.line) e.line.renderOrder = baseRO;
      e.bubble.renderOrder = baseRO + 1;
      if (e.letter) e.letter.renderOrder = baseRO + 2;

      // 字母：正轴常显（悬停→白），负轴仅悬停显示（白）。悬停判定基于较大的命中精灵。
      const hovered = e.hit.userData.gizmoHover === true;
      if (e.letter && e.letterMat) {
        if (e.primary) {
          e.letter.visible = true;
          e.letterMat.color.copy(hovered ? this._hoverColor : this._labelColor);
        } else {
          e.letter.visible = hovered;
          if (hovered) e.letterMat.color.copy(this._hoverColor);
        }
      }
    }
  }

  /**
   * 释放所有几何体 / 材质 / 贴图。
   */
  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
    this.pickables.length = 0;
    super.dispose();
  }
}

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GroupComponentOptions, IDisposable } from '../types';

/**
 * Outlines 的配置选项。
 */
export interface OutlinesOptions extends GroupComponentOptions {
  /** 要描边的父级网格。支持普通 `Mesh`、`SkinnedMesh`、`InstancedMesh`。 */
  mesh: THREE.Mesh | THREE.SkinnedMesh | THREE.InstancedMesh;
  /** 描边颜色。 @default 'black' */
  color?: THREE.ColorRepresentation;
  /** 描边不透明度。 @default 1 */
  opacity?: number;
  /** 描边是否透明。 @default false */
  transparent?: boolean;
  /**
   * 线宽是否与缩放无关（屏幕空间恒定）。
   * - `true`：厚度按世界单位沿法线偏移，与摄像机距离无关；
   * - `false`（默认）：厚度按裁剪空间偏移，远处更细、近处更粗。
   * @default false
   */
  screenspace?: boolean;
  /** 描边线宽。 @default 0.05 */
  thickness?: number;
  /**
   * 几何折痕角度（弧度）。
   * - `0` = 不分裂、直接复用父级法线；
   * - `Math.PI`（默认）= 在每个硬边处分裂法线，使描边沿轮廓外扩、平面区域不被描边。
   * @default Math.PI
   */
  angle?: number;
  /** 渲染顺序。 @default 0 */
  renderOrder?: number;
  /** 是否启用多边形偏移（避免与父级表面 Z-fighting）。 @default false */
  polygonOffset?: boolean;
  /** 多边形偏移因子。 @default 0 */
  polygonOffsetFactor?: number;
  /** 是否参与色调映射。 @default true */
  toneMapped?: boolean;
  /** 裁剪平面列表。 */
  clippingPlanes?: THREE.Plane[];
}

/**
 * 顶点着色器：沿法线把背面几何外扩。
 *
 * - `screenspace = true`：沿世界法线偏移 `thickness`，线宽与缩放无关；
 * - `screenspace = false`：在裁剪空间沿投影法线偏移 `thickness / size * w * 2`，
 *   近处粗、远处细（默认行为，体积感更自然）。
 *
 * 兼容 morph / skinning / instancing，与 drei Outlines 实现一致。
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  #include <clipping_planes_pars_vertex>
  uniform float thickness;
  uniform bool screenspace;
  uniform vec2 size;
  void main() {
    #if defined (USE_SKINNING)
      #include <beginnormal_vertex>
      #include <morphnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>
    #endif
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    #include <clipping_planes_vertex>
    vec4 tNormal = vec4(normal, 0.0);
    vec4 tPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      tNormal = instanceMatrix * tNormal;
      tPosition = instanceMatrix * tPosition;
    #endif
    if (screenspace) {
      vec3 newPosition = tPosition.xyz + tNormal.xyz * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    } else {
      vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
      vec4 clipNormal = projectionMatrix * modelViewMatrix * tNormal;
      vec2 offset = normalize(clipNormal.xy) * thickness / size * clipPosition.w * 2.0;
      clipPosition.xy += offset;
      gl_Position = clipPosition;
    }
  }
`;

/**
 * 片元着色器：纯色输出（背面），参与裁剪平面、色调映射与色彩空间转换。
 */
const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    gl_FragColor = vec4(color, opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 创建描边材质（背面渲染、自定义着色器）。
 * 复刻 drei `Outlines` 的 `OutlinesMaterial` 行为，但不依赖 R3F `shaderMaterial`。
 */
function createOutlinesMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      color: { value: new THREE.Color('black') },
      opacity: { value: 1 },
      thickness: { value: 0.05 },
      screenspace: { value: false },
      size: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader,
  });
}

/**
 * Outlines — 描边组件。
 *
 * 参考自 [pmndrs/drei 的 `Outlines`](https://github.com/pmndrs/drei/blob/master/src/core/Outlines.tsx)，
 * 但实现为原生 Three.js 类（继承 `THREE.Group`），不依赖 React/R3F。
 *
 * 工作原理：取父级 `Mesh` 的几何体，按折痕角度分裂法线后生成一个**背面渲染**的描边网格，
 * 在顶点着色器里沿法线把几何外扩 `thickness`，再叠回父级之下，形成轮廓描边效果。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接挂到任意 Three.js 场景
 * - 支持普通 `Mesh`、`SkinnedMesh`（绑定骨架）、`InstancedMesh`（复用实例矩阵）
 * - `screenspace` 切换屏幕空间 / 世界空间线宽
 * - 通过 `toCreasedNormals` 在硬边处分裂法线，描边沿真实轮廓外扩
 * - 实现 {@link IDisposable} —— `dispose()` 释放描边几何体与材质
 *
 * @example
 * ```ts
 * import { Outlines } from '@cyc/3d-components/core';
 *
 * const mesh = new THREE.Mesh(geometry, material);
 * const outline = new Outlines({ mesh, color: 'red', thickness: 0.05 });
 * mesh.add(outline); // 描边作为 mesh 的子级，自动跟随变换 / 骨架
 * scene.add(mesh);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Outlines extends THREE.Group implements IDisposable {
  /** 父级网格（描边的来源）。 */
  private readonly mesh: NonNullable<OutlinesOptions['mesh']>;
  /** 描边着色器材质（由本组件持有并释放）。 */
  private readonly material: THREE.ShaderMaterial;
  /** 由本组件生成、需要释放的描边几何体（angle > 0 时为分裂法线后的副本）。 */
  private outlineGeometry: THREE.BufferGeometry | null = null;
  /** 上一轮使用的折痕角度，用于判断是否需要重建几何体。 */
  private currentAngle = 0;
  /** 用于读取绘图缓冲尺寸（screenspace 偏移归一化）。 */
  private renderer: THREE.WebGLRenderer | null = null;
  /** 绑定的 resize 监听（卸载时移除）。 */
  private resizeHandler: (() => void) | null = null;

  /**
   * @param options - 配置对象。`mesh` 必填，其余可选。
   */
  constructor(options: OutlinesOptions) {
    super();

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };

    this.mesh = options.mesh;
    this.material = createOutlinesMaterial();
    this.currentAngle = options.angle ?? Math.PI;

    // 初次构建描边网格。
    this.rebuild(options.angle ?? Math.PI);

    // 应用一次材质 / 网格属性。
    this.applyOptions(options);

    if (options.children) {
      for (const child of options.children) this.add(child);
    }
  }

  /**
   * 重建描边网格（当 `angle` 或父级几何体变化时调用）。
   *
   * - `angle > 0`：用 `toCreasedNormals` 生成分裂法线副本（独立于父级法线属性）；
   * - `angle = 0`：直接复用父级几何体（不拷贝，不释放父级资源）。
   *
   * 支持 `SkinnedMesh`（绑定骨架）与 `InstancedMesh`（复用实例矩阵）。
   */
  private rebuild(angle: number): void {
    const parent = this.mesh;
    const geometry = parent.geometry;
    if (!geometry) return;

    // 释放旧的描边网格与（自建的）几何体。
    const old = this.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
    if (old) {
      if (this.outlineGeometry) this.outlineGeometry.dispose();
      this.remove(old);
    }

    this.currentAngle = angle;
    // angle > 0 时用官方 toCreasedNormals 在硬边分裂法线（生成独立副本）；angle = 0 时复用父级几何。
    this.outlineGeometry = angle ? toCreasedNormals(geometry, angle) : null;

    let mesh: THREE.Mesh | THREE.SkinnedMesh | THREE.InstancedMesh;
    if ((parent as THREE.SkinnedMesh).skeleton) {
      const skinned = new THREE.SkinnedMesh();
      skinned.material = this.material;
      skinned.bind((parent as THREE.SkinnedMesh).skeleton, (parent as THREE.SkinnedMesh).bindMatrix);
      mesh = skinned;
    } else if ((parent as THREE.InstancedMesh).isInstancedMesh) {
      const inst = new THREE.InstancedMesh(geometry, this.material, (parent as THREE.InstancedMesh).count);
      inst.instanceMatrix = (parent as THREE.InstancedMesh).instanceMatrix;
      mesh = inst;
    } else {
      mesh = new THREE.Mesh();
      mesh.material = this.material;
    }

    mesh.geometry = this.outlineGeometry ?? geometry;
    mesh.morphTargetInfluences = (parent as THREE.Mesh).morphTargetInfluences;
    mesh.morphTargetDictionary = (parent as THREE.Mesh).morphTargetDictionary;
    this.add(mesh);
  }

  /**
   * 把构造选项应用到描边网格与材质上（颜色、厚度、透明度、裁剪平面等）。
   */
  private applyOptions(options: OutlinesOptions): void {
    const mesh = this.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
    if (!mesh) return;

    mesh.renderOrder = options.renderOrder ?? 0;

    const u = this.material.uniforms;
    const color = new THREE.Color(options.color ?? 'black');
    u.color.value.copy(color);
    u.opacity.value = options.opacity ?? 1;
    u.thickness.value = options.thickness ?? 0.05;
    u.screenspace.value = options.screenspace ?? false;

    this.material.transparent = options.transparent ?? false;
    this.material.toneMapped = options.toneMapped ?? true;
    this.material.polygonOffset = options.polygonOffset ?? false;
    this.material.polygonOffsetFactor = options.polygonOffsetFactor ?? 0;
    const planes = options.clippingPlanes;
    this.material.clippingPlanes = planes ? planes.slice() : null;
    this.material.clipping = !!(planes && planes.length > 0);
  }

  /**
   * 绑定到渲染器以读取绘图缓冲尺寸（`screenspace` 偏移归一化用），并监听 canvas resize。
   *
   * 仅在 `screenspace = true` 时有必要调用；不传则 `size` 默认为 1×1。
   *
   * @param renderer - 当前场景使用的 WebGL 渲染器。
   */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    const update = (): void => {
      if (!this.renderer) return;
      this.material.uniforms.size.value.copy(this.renderer.getDrawingBufferSize(new THREE.Vector2()));
    };
    update();
    // 监听 canvas 尺寸变化（非全屏时也可用 ResizeObserver 兜底）。
    const canvas = renderer.domElement;
    this.resizeHandler = update;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(canvas);
      // 存到 userData 以便 dispose 时断开。
      this.userData.__outlinesRO = ro;
    }
  }

  /**
   * 在折痕角度或父级几何体变化后重建描边网格。
   *
   * @param angle - 新的折痕角度（弧度）。`0` = 不分裂法线。
   */
  setAngle(angle: number): void {
    if (this.currentAngle === angle) return;
    this.rebuild(angle);
  }

  /**
   * 当父级几何体被替换后，调用此方法重建描边（旧的自建几何体会被释放）。
   */
  refresh(): void {
    this.rebuild(this.currentAngle);
  }

  /**
   * 释放描边几何体与材质，并断开 resize 监听。
   * 不会触碰父级网格的资源（几何体 / 材质由父级自行管理）。
   */
  dispose(): void {
    if (this.outlineGeometry) {
      this.outlineGeometry.dispose();
      this.outlineGeometry = null;
    }
    this.material.dispose();
    const ro = this.userData.__outlinesRO as ResizeObserver | undefined;
    if (ro) ro.disconnect();
    this.clear();
  }
}

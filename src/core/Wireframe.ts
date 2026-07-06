import * as THREE from 'three';
import type { GroupComponentOptions, IDisposable } from '../types';

/**
 * Wireframe 的配置选项。
 */
export interface WireframeOptions extends GroupComponentOptions {
  /** 要线框化的父级网格。 */
  mesh: THREE.Mesh;
  /** 线条（描边）颜色。 @default '#ff0000' */
  stroke?: THREE.ColorRepresentation;
  /** 背面线条颜色（仅在 `colorBackfaces` 为真时用于背面）。 @default '#0000ff' */
  backfaceStroke?: THREE.ColorRepresentation;
  /** 填充颜色（三角形内部）。 @default '#00ff00' */
  fill?: THREE.ColorRepresentation;
  /** 线条不透明度。 @default 1 */
  strokeOpacity?: number;
  /** 填充不透明度。 @default 0.25 */
  fillOpacity?: number;
  /**
   * 填充颜色与原材质 `diffuse` 的混合比例（仅 `overrideMaterial` 模式有效）。
   * - `0` = 完全用 `fill`；
   * - `1` = 完全用原材质漫反射色。
   * @default 0
   */
  fillMix?: number;
  /** 线条粗细（0–1，经 `map(0,1,0,0.34)` 映射为实际像素厚度）。 @default 0.05 */
  thickness?: number;
  /** 是否给背面单独着色（用 `backfaceStroke`）。 @default false */
  colorBackfaces?: boolean;
  /** 是否启用虚线。 @default false */
  dash?: boolean;
  /** 虚线是否反转（亮 / 暗段互换）。 @default true */
  dashInvert?: boolean;
  /** 虚线重复次数（每条边重复几段）。 @default 4 */
  dashRepeats?: number;
  /** 虚线一段中「亮」的占比（0–1）。 @default 0.5 */
  dashLength?: number;
  /** 是否启用中间收窄（线条向段中心变细）。 @default false */
  squeeze?: boolean;
  /** 收窄最小值。 @default 0.2 */
  squeezeMin?: number;
  /** 收窄最大值。 @default 1 */
  squeezeMax?: number;
  /**
   * 渲染顺序。 @default 0
   */
  renderOrder?: number;
  /** 是否参与色调映射。 @default false */
  toneMapped?: boolean;
  /**
   * 是否覆盖父级材质（`onBeforeCompile` 注入），而非生成独立线框网格。
   * - `false`（默认）：创建一个 `THREE.Mesh` 子级，用独立 `WireframeMaterial` 渲染线框，
   *   父级原材质不受影响，线框与填充叠在同一个几何体上；
   * - `true`：直接改写父级材质（`onBeforeCompile`），把线框融入原 PBR 渲染，
   *   适合「带光照的线框化模型」。此模式下 `fillMix` 生效。
   * @default false
   */
  overrideMaterial?: boolean;
}

// ===================== GLSL shaders (源自 drei WireframeMaterial) =====================

/**
 * 顶点着色器：读取 `barycentric` 属性并传给片元。
 * `initWireframe()` 由主 `main()` 调用。
 */
const wireframeVertex = /* glsl */ `
  attribute vec3 barycentric;

  varying vec3 v_edges_Barycentric;
  varying vec3 v_edges_Position;

  void initWireframe() {
    v_edges_Barycentric = barycentric;
    v_edges_Position = position.xyz;
  }
`;

/**
 * 片元着色器核心：基于重心坐标计算每条边的抗锯齿线条，支持虚线 / 收窄。
 * 与 drei 实现一致，依赖 `fwidth`（standard derivatives）。
 */
const wireframeFragment = /* glsl */ `
  #ifndef PI
    #define PI 3.1415926535897932384626433832795
  #endif

  varying vec3 v_edges_Barycentric;
  varying vec3 v_edges_Position;

  uniform float strokeOpacity;
  uniform float fillOpacity;
  uniform float fillMix;
  uniform float thickness;
  uniform bool colorBackfaces;

  // Dash
  uniform bool dashInvert;
  uniform bool dash;
  uniform float dashRepeats;
  uniform float dashLength;

  // Squeeze
  uniform bool squeeze;
  uniform float squeezeMin;
  uniform float squeezeMax;

  // Colors
  uniform vec3 stroke;
  uniform vec3 backfaceStroke;
  uniform vec3 fill;

  // 抗锯齿阶梯：基于 fwidth 的 smoothstep，让线条边缘平滑。
  float wireframe_aastep(float threshold, float dist) {
    float afwidth = fwidth(dist) * 0.5;
    return smoothstep(threshold - afwidth, threshold + afwidth, dist);
  }

  float wireframe_map(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
  }

  float getWireframe() {
    vec3 barycentric = v_edges_Barycentric;

    // 到三角形三条边的最小距离（重心坐标的最小分量）。
    float d = min(min(barycentric.x, barycentric.y), barycentric.z);

    // 沿线段方向 0..1 的位置（用于虚线 / 收窄）。
    float positionAlong = max(barycentric.x, barycentric.y);
    if (barycentric.y < barycentric.x && barycentric.y < barycentric.z) {
      positionAlong = 1.0 - positionAlong;
    }

    // 线条厚度（0..1 → 0..0.34）。
    float computedThickness = wireframe_map(thickness, 0.0, 1.0, 0.0, 0.34);

    // 向段中心收窄。
    if (squeeze) {
      computedThickness *= mix(squeezeMin, squeezeMax, (1.0 - sin(positionAlong * PI)));
    }

    // 虚线模式。
    if (dash) {
      float offset = 1.0 / dashRepeats * dashLength / 2.0;
      if (!dashInvert) {
        offset += 1.0 / dashRepeats / 2.0;
      }
      float pattern = fract((positionAlong + offset) * dashRepeats);
      computedThickness *= 1.0 - wireframe_aastep(dashLength, pattern);
    }

    // 抗锯齿描边。
    float edge = 1.0 - wireframe_aastep(computedThickness, d);
    return edge;
  }
`;

/**
 * 独立线框材质（不覆盖父级）的完整顶点着色器。
 */
const standaloneVertexShader = /* glsl */ `
  ${wireframeVertex}
  void main() {
    initWireframe();
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 独立线框材质的完整片元着色器：填充色 + 描边色混合。
 */
const standaloneFragmentShader = /* glsl */ `
  ${wireframeFragment}
  void main() {
    float edge = getWireframe();
    vec4 colorStroke = vec4(stroke, edge);

    #ifdef FLIP_SIDED
      colorStroke.rgb = backfaceStroke;
    #endif

    vec4 colorFill = vec4(fill, fillOpacity);
    vec4 outColor = mix(colorFill, colorStroke, edge * strokeOpacity);

    gl_FragColor = outColor;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 默认 uniform 值（与 drei 一致）。 */
function createWireframeUniforms() {
  return {
    strokeOpacity: { value: 1 },
    fillOpacity: { value: 0.25 },
    fillMix: { value: 0 },
    thickness: { value: 0.05 },
    colorBackfaces: { value: false },
    dashInvert: { value: true },
    dash: { value: false },
    dashRepeats: { value: 4 },
    dashLength: { value: 0.5 },
    squeeze: { value: false },
    squeezeMin: { value: 0.2 },
    squeezeMax: { value: 1 },
    stroke: { value: new THREE.Color('#ff0000') },
    backfaceStroke: { value: new THREE.Color('#0000ff') },
    fill: { value: new THREE.Color('#00ff00') },
  };
}

/**
 * 创建独立的线框 `ShaderMaterial`（双面、透明）。
 *
 * > `fwidth`（standard derivatives）在 WebGL2 下默认可用，无需显式开启；
 * > WebGL1 时代需要的 `derivatives: true` 标志已被 Three.js 移除。
 */
function createWireframeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: createWireframeUniforms(),
    vertexShader: standaloneVertexShader,
    fragmentShader: standaloneFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/**
 * 为几何体计算 `barycentric` 顶点属性（线框着色器的核心输入）。
 *
 * 每个三角形的三个顶点分别赋 `(1,0,0)`、`(0,1,0)`、`(0,0,1)`，
 * 这样在片元阶段，重心坐标的最小分量即「到最近边的距离」，可据此画出抗锯齿线条。
 *
 * **索引几何必须先去索引**：相邻三角形共享同一顶点时，该顶点的重心坐标无法同时满足
 * 多个三角形，因此把几何体转成非索引（每个三角形独占 3 个顶点）后再赋值。
 * 这是 drei `Wireframe` 组件同样的做法。
 *
 * > 注：本函数会**就地修改**传入几何体（添加 `barycentric` 属性）；
 * > 若需要保留原几何体，请传入副本。
 */
function applyBarycentric(geometry: THREE.BufferGeometry): void {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!position) return;

  // 非索引化：让每个三角形独占顶点，避免共享顶点的重心坐标冲突。
  const nonIndexed = index ? geometry.toNonIndexed() : geometry;
  const count = nonIndexed.getAttribute('position').count;

  // 每 3 个顶点（一个三角形）依次赋 (1,0,0)/(0,1,0)/(0,0,1)。
  const barycentric = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const corner = i % 3;
    barycentric[i * 3 + corner] = 1;
  }

  nonIndexed.setAttribute('barycentric', new THREE.BufferAttribute(barycentric, 3));

  // 若原几何是索引的，toNonIndexed 已生成新缓冲；把它写回原 geometry。
  if (index) {
    geometry.setAttribute('position', nonIndexed.getAttribute('position'));
    geometry.setAttribute('barycentric', nonIndexed.getAttribute('barycentric'));
    // 同步其它已存在的属性（uv / normal 等）以免丢失。
    for (const key of Object.keys(nonIndexed.attributes)) {
      if (key === 'position' || key === 'barycentric') continue;
      if (!geometry.getAttribute(key)) geometry.setAttribute(key, nonIndexed.getAttribute(key));
    }
    geometry.setIndex(null);
  }
}

/**
 * 把线框逻辑注入到已有材质（`onBeforeCompile`），使其带光照渲染。
 *
 * 与 drei `setWireframeOverride` 等价：在顶点着色器插入 `initWireframe()`，
 * 在片元着色器把 `getWireframe()` 结果混合进 `diffuseColor`。被注入的材质会
 * 自动设为 `DoubleSide` + `transparent`。**注意：调用方需自行保证几何体
 * 已具备 `barycentric` 属性**（用 {@link applyBarycentric}）。
 *
 * @param material - 要注入的材质（如 `MeshStandardMaterial`）。
 * @param uniforms - 线框 uniform 集合（由 {@link createWireframeUniforms} 创建）。
 */
function applyWireframeOverride(material: THREE.Material, uniforms: Record<string, THREE.IUniform>): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };

    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      /* glsl */ `
        ${wireframeVertex}
        void main() {
          initWireframe();
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      /* glsl */ `
        ${wireframeFragment}
        void main() {
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
        #include <color_fragment>
        float edge = getWireframe();
        vec4 colorStroke = vec4(stroke, edge);
        #ifdef FLIP_SIDED
          colorStroke.rgb = backfaceStroke;
        #endif
        vec4 colorFill = vec4(mix(diffuseColor.rgb, fill, fillMix), mix(diffuseColor.a, fillOpacity, fillMix));
        vec4 outColor = mix(colorFill, colorStroke, edge * strokeOpacity);

        diffuseColor.rgb = outColor.rgb;
        diffuseColor.a *= outColor.a;
      `,
    );
  };

  (material as THREE.Material & { side: THREE.Side }).side = THREE.DoubleSide;
  (material as THREE.Material & { transparent: boolean }).transparent = true;
  material.needsUpdate = true;
}

/**
 * Wireframe — 线框化组件。
 *
 * 参考自 [pmndrs/drei 的 `WireframeMaterial`](https://github.com/pmndrs/drei/blob/master/src/materials/WireframeMaterial.tsx)，
 * 实现为原生 Three.js 类（继承 `THREE.Group`），不依赖 React/R3F。
 *
 * 工作原理：基于**重心坐标（barycentric）**在每个三角形内计算到三条边的最小距离，
 * 用 `fwidth` 抗锯齿画出线条；支持虚线、收窄、正反面不同色、半透明填充。
 *
 * 提供两种模式：
 * - **独立线框**（默认，`overrideMaterial = false`）：在父级网格下挂一个子 `Mesh`，
 *   用独立 `ShaderMaterial` 渲染线框 + 填充，父级原材质不变；
 * - **材质覆盖**（`overrideMaterial = true`）：通过 `onBeforeCompile` 把线框注入
 *   父级材质，与原 PBR 光照混合渲染，适合「带光照的线框模型」。
 *
 * 两种模式都要求几何体具备 `barycentric` 属性——本组件会在初始化时自动调用
 * {@link applyBarycentric} 计算（**就地修改父级几何体**，必要时请传入副本）。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接挂到任意 Three.js 场景
 * - 抗锯齿线条（standard derivatives）、虚线 / 收窄可调
 * - 正反面独立着色、半透明填充
 * - 实现 {@link IDisposable} —— `dispose()` 释放线框几何体与材质
 *
 * @example
 * ```ts
 * import { Wireframe } from '@cyc/3d-components/core';
 *
 * const mesh = new THREE.Mesh(geometry, standardMaterial);
 * const wf = new Wireframe({ mesh, stroke: '#ff0000', thickness: 0.1, dash: true });
 * mesh.add(wf); // 作为子级，自动跟随父级变换
 * scene.add(mesh);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Wireframe extends THREE.Group implements IDisposable {
  /** 父级网格。 */
  private readonly mesh: THREE.Mesh;
  /** 独立线框材质（由本组件持有并释放；overrideMaterial 模式下为注入用的 uniform 容器）。 */
  private readonly material: THREE.ShaderMaterial;
  /** 是否走材质覆盖路径。 */
  private readonly override: boolean;
  /** 由本组件生成、需释放的线框几何体（独立模式下为父级几何的 barycentric 副本）。 */
  private wireGeometry: THREE.BufferGeometry | null = null;
  /** 是否由本组件注入了 `onBeforeCompile`（dispose 时还原）。 */
  private injectedParent = false;

  /**
   * @param options - 配置对象。`mesh` 必填，其余可选。
   */
  constructor(options: WireframeOptions) {
    super();

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };

    this.mesh = options.mesh;
    this.override = options.overrideMaterial ?? false;
    this.material = createWireframeMaterial();

    if (this.override) {
      // 覆盖模式：把 barycentric 写到父级几何体，并把线框逻辑注入父级材质。
      const parentGeo = this.mesh.geometry;
      if (parentGeo && !parentGeo.getAttribute('barycentric')) {
        applyBarycentric(parentGeo);
      }
      if (this.mesh.material) {
        const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
        for (const m of materials) applyWireframeOverride(m, this.material.uniforms);
        this.injectedParent = true;
      }
    } else {
      // 独立模式：复制一份父级几何体并补上 barycentric，挂为子 Mesh。
      const parentGeo = this.mesh.geometry;
      if (parentGeo) {
        this.wireGeometry = parentGeo.clone();
        if (!this.wireGeometry.getAttribute('barycentric')) applyBarycentric(this.wireGeometry);
        const wireMesh = new THREE.Mesh(this.wireGeometry, this.material);
        wireMesh.renderOrder = options.renderOrder ?? 0;
        this.add(wireMesh);
      }
    }

    // 应用一遍 uniform / 材质属性。
    this.applyOptions(options);

    if (options.children) {
      for (const child of options.children) this.add(child);
    }
  }

  /**
   * 把构造选项同步到材质 uniform。
   */
  private applyOptions(options: WireframeOptions): void {
    const u = this.material.uniforms;
    if (options.strokeOpacity !== undefined) u.strokeOpacity.value = options.strokeOpacity;
    if (options.fillOpacity !== undefined) u.fillOpacity.value = options.fillOpacity;
    if (options.fillMix !== undefined) u.fillMix.value = options.fillMix;
    if (options.thickness !== undefined) u.thickness.value = options.thickness;
    if (options.colorBackfaces !== undefined) u.colorBackfaces.value = options.colorBackfaces;
    if (options.dash !== undefined) u.dash.value = options.dash;
    if (options.dashInvert !== undefined) u.dashInvert.value = options.dashInvert;
    if (options.dashRepeats !== undefined) u.dashRepeats.value = options.dashRepeats;
    if (options.dashLength !== undefined) u.dashLength.value = options.dashLength;
    if (options.squeeze !== undefined) u.squeeze.value = options.squeeze;
    if (options.squeezeMin !== undefined) u.squeezeMin.value = options.squeezeMin;
    if (options.squeezeMax !== undefined) u.squeezeMax.value = options.squeezeMax;
    if (options.stroke !== undefined) (u.stroke.value as THREE.Color).set(options.stroke);
    if (options.backfaceStroke !== undefined) (u.backfaceStroke.value as THREE.Color).set(options.backfaceStroke);
    if (options.fill !== undefined) (u.fill.value as THREE.Color).set(options.fill);
    if (options.toneMapped !== undefined) this.material.toneMapped = options.toneMapped;
  }

  /**
   * 运行时更新某个 uniform（链式）。
   *
   * @param key - uniform 名（如 `'thickness'`、`'stroke'`）。
   * @param value - 新值；颜色项接受 `THREE.ColorRepresentation`。
   * @returns this，便于链式调用。
   */
  setUniform(key: keyof WireframeOptions, value: unknown): this {
    const u = this.material.uniforms;
    const colorKeys: Record<string, 'stroke' | 'backfaceStroke' | 'fill'> = {
      stroke: 'stroke',
      backfaceStroke: 'backfaceStroke',
      fill: 'fill',
    };
    if (key in colorKeys) {
      (u[colorKeys[key]].value as THREE.Color).set(value as THREE.ColorRepresentation);
    } else if (key in u) {
      (u[key as string] as THREE.IUniform).value = value;
    }
    return this;
  }

  /**
   * 释放资源。
   *
   * - 独立模式：释放线框几何体副本与线框材质；
   * - 覆盖模式：仅释放线框材质（uniform 容器），**不还原父级材质 / 几何体**
   *   （`onBeforeCompile` 注入无法安全撤销；如需还原请重建父级材质）。
   */
  dispose(): void {
    if (this.wireGeometry) {
      this.wireGeometry.dispose();
      this.wireGeometry = null;
    }
    this.material.dispose();
    this.clear();
  }
}

/**
 * @packageDocumentation
 *
 * # GizmoHelper
 *
 * 视口导航 Gizmo（Viewport Gizmo），自包含组件文件夹：
 * - {@link GizmoHelper} —— 主控制器（叠层渲染 + 相机同步 + 平滑切换 + 射线拾取）。
 * - {@link GizmoViewport} —— 默认内容（仿 ThreeOrbitControlsGizmo 的扁平气泡样式）。
 * - `textures.ts` —— 内部贴图工厂（圆 / 环 / 圆底 / 字母）。
 *
 * ## 快速开始
 * ```ts
 * import { GizmoHelper, GizmoViewport } from '@cyc/3d-components/helper';
 *
 * const gizmo = new GizmoHelper({ camera, renderer, controls });
 * gizmo.setContent(new GizmoViewport({ onPick: (dir) => gizmo.tweenCamera(dir) }));
 *
 * // 渲染循环（renderOverlay 必须在主渲染之后）：
 * gizmo.update(delta);
 * renderer.render(scene, camera);
 * gizmo.renderOverlay();
 * ```
 *
 * @remarks
 * GizmoHelper 管理自己的虚拟场景，**不要** `scene.add(gizmo)`。
 */

// 主控制器
export { GizmoHelper } from './GizmoHelper';
export type {
  GizmoHelperOptions,
  GizmoAlignment,
  GizmoControlsLike,
  GizmoContent,
} from './GizmoHelper';

// 默认内容
export { GizmoViewport } from './GizmoViewport';
export type { GizmoViewportOptions, AxisColorPair } from './GizmoViewport';

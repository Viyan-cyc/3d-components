/**
 * @packageDocumentation
 *
 * # helper
 *
 * 视口辅助 / 导航组件（Viewport Helpers），独立于主场景以叠层方式渲染。
 *
 * 每个辅助组件以自包含文件夹形式组织（主类 + 内部辅助文件 + `index.ts`），
 * 风格同 `core/InstancedMesh2`、`material/MeshReflectorMaterial`。
 *
 * ## 组件
 * - {@link GizmoHelper} —— 视口导航 Gizmo 容器：在屏幕角落绘制独立小视口，
 *   镜像主相机朝向，并支持点击平滑旋转相机。
 * - {@link GizmoViewport} —— GizmoHelper 的默认内容：扁平气泡样式的三轴指示器。
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

export * from './GizmoHelper';

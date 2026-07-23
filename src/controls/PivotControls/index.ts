/**
 * @packageDocumentation
 *
 * # PivotControls
 *
 * 统一变换操控 Gizmo（平移 / 旋转 / 缩放一体），自包含组件文件夹：
 * - {@link PivotControls} —— 主控制器（矩阵合成 + 指针射线拾取 + 每帧缩放补偿）。
 * - `PivotHandle` —— 四类操控件的公共基类。
 * - `AxisArrow` / `PlaneSlider` / `AxisRotator` / `ScalingSphere` —— 四类操控件。
 * - `FatLine` —— 可控线宽线段（Line2 封装）。
 * - `calculateScaleFactor` —— `fixed` 模式恒定像素尺寸所需的缩放因子。
 *
 * 参考 [drei PivotControls](https://github.com/pmndrs/drei/tree/master/src/web/pivotControls)，
 * 改写为原生 Three.js（`THREE.Group` 子类，无 React）。
 *
 * ## 快速开始
 * ```ts
 * import { PivotControls } from '@cyc/3d-components/controls';
 *
 * const pivot = new PivotControls({ camera, renderer, controls: orbit });
 * scene.add(pivot);
 * pivot.add(model);
 *
 * function frame() {
 *   const dt = clock.getDelta();
 *   orbit.update();
 *   pivot.update(dt);          // 每帧调用
 *   renderer.render(scene, camera);
 *   requestAnimationFrame(frame);
 * }
 * ```
 */

export { PivotControls } from './PivotControls';
export type { PivotControlsOptions, PivotControlsLike } from './PivotControls';
export type { OnDragStartProps, LimitsTuple, AxisLimit, AxisIndex, PointerSample } from './context';

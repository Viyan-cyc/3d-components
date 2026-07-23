/**
 * @module controls
 *
 * **交互操控组件 (Interaction Controls)**
 *
 * 可叠加到场景中的 3D 操控 Gizmo，与 `core` / `material` 等模块同级。
 * 每个组件以自包含文件夹形式组织（主类 + 内部辅助 + `index.ts`）。
 *
 * ## 组件
 * - {@link PivotControls} —— 平移 / 旋转 / 缩放一体的变换操控 Gizmo。
 *
 * @example
 * ```ts
 * import { PivotControls } from '@cyc/3d-components/controls';
 *
 * const pivot = new PivotControls({ camera, renderer, controls: orbit });
 * scene.add(pivot);
 * pivot.add(model);
 * // 每帧：pivot.update(delta);
 * ```
 */

export * from './PivotControls';

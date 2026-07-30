/**
 * @module camera
 *
 * **相机控制器 (Camera Controls)**
 *
 * 轨道式相机控制器，TypeScript 实现。
 *
 * 支持 `PerspectiveCamera` 和 `OrthographicCamera`，提供轨道旋转、dolly/zoom、truck/pan、
 * 边界约束、碰撞检测、可配置的鼠标/触控输入映射。
 *
 * @example
 * ```ts
 * import { CameraControls } from '@a3d/a3d-components/camera';
 *
 * const controls = new CameraControls({
 *   camera,
 *   domElement: renderer.domElement,
 *   smoothTime: 0.3,
 * });
 *
 * // 编程式旋转
 * await controls.rotateTo(Math.PI / 4, Math.PI / 3, true);
 *
 * // 每帧更新
 * controls.update(delta);
 * ```
 */

export { CameraControls } from './CameraControls';
export { ACTION, MOUSE_BUTTON, DOLLY_DIRECTION } from './types';
export type {
	CameraControlsOptions,
	CameraControlsEventMap,
	CameraControlsEventType,
	CameraControlsEvent,
	CameraControlsLerpState,
	MouseButtons,
	Touches,
	FitToOptions,
} from './types';

/**
 * @module graph/interaction
 *
 * 图交互层 —— Raycaster 拾取与事件分发。
 *
 * - {@link PickController}：监听 pointer 事件，拾取 `Graph3D` 子树，
 *   应用内置视觉反馈（hover/select/邻边高亮）并分发 {@link GraphEvent}。
 * - {@link GraphEvent} / {@link GraphEventHandler}：事件契约，供用户注册回调。
 */

export { PickController } from './PickController';
export type { PickControllerOptions } from './PickController';
export type { GraphEvent, GraphEventType, GraphEventHandler, GraphPickKind } from './types';

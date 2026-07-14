/**
 * @module graph/interaction/types
 *
 * 图交互事件类型契约。
 *
 * {@link PickController} 在拾取到节点/边、状态切换（hover / select）时，
 * 构造 {@link GraphEvent} 分发给用户注册的回调（`onHover` / `onSelect`）。
 * 用户可在回调中读取元素 `data`、`nativeEvent` 做任意视觉变化
 * （信息面板、轨迹绘制、外部状态联动等）。
 *
 * 注：内置视觉反馈（悬停放大+发光、选中常亮、邻边高亮）由 `PickController`
 * 自身应用，与事件回调并存 —— 关闭内置反馈后事件仍照常分发。
 */

import type { NodeId } from '../types';

/**
 * 交互事件类型。
 * - `'hover'` / `'unhover'`：指针进入 / 离开某元素。
 * - `'click'`：点击某元素（区分于 OrbitControls 拖拽）。
 * - `'select'` / `'unselect'`：选中 / 取消选中某元素（点击节点时 toggle）。
 */
export type GraphEventType = 'hover' | 'unhover' | 'click' | 'select' | 'unselect';

/**
 * 拾取到的元素种类。
 * - `'node'`：节点（回查 `userData.nodeId`）。
 * - `'edge'`：边（回查 `userData.edgeId`）。
 */
export type GraphPickKind = 'node' | 'edge';

/**
 * 图交互事件。由 {@link PickController} 在交互状态变化时分发。
 *
 * @example
 * ```ts
 * pick.onHover = (e: GraphEvent) => {
 *   console.log('hover', e.kind, e.id, e.data);
 * };
 * ```
 */
export interface GraphEvent {
  /** 事件类型。 */
  type: GraphEventType;
  /** 被交互的元素 id（节点或边）。 */
  id: NodeId;
  /** 元素种类（节点 / 边）。 */
  kind: GraphPickKind;
  /** 该元素携带的业务数据（节点的 `NodeData.data` / 边的 `EdgeData.data`）。 */
  data?: Record<string, unknown>;
  /** 触发该事件的原始指针事件。 */
  nativeEvent: PointerEvent;
}

/** 交互事件回调签名。 */
export type GraphEventHandler = (e: GraphEvent) => void;

/**
 * @module graph/layouts
 *
 * 布局算法模块。
 *
 * **核心输出规范：** 所有布局算法统一签名 `(nodes, config) => NodePos3D[]`，
 * 输出包含完整 x/y/z 三维坐标。
 *
 * 第一步仅建立类型骨架（本目录的 `types.ts`）；具体算法在后续步骤填充：
 * - 第三步：环形布局 3D 化、3D 力导向。
 * - 第四步：六边形蜂巢布局、网格布局。
 *
 * 填充后所有算法会从此 barrel 暴露为 `Layouts` 命名空间工具，可在组件外部独立调用。
 */

export type { BaseLayoutConfig, LayoutFn } from './types';

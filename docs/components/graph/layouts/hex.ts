// 六边形蜂巢布局 Tab —— 演示 hex 的半径 / 多层堆叠 / 层间距 / 朝向 / 平面。
// 为凸显蜂巢拼合效果，本 Tab 把节点球体换成**六边形瓦片**（graph.setNodeGeometry）：
// 瓦片外接圆半径 = 布局 radius，正好与蜂巢格尺度一致 → 瓦片密铺成蜂巢。
// 默认 6 段圆柱 = 平顶（顶点朝 ±x）；尖顶旋转 30°。闭式廉价布局：滑块 input 即时重排。
import * as THREE from 'three';
import type { HexLayoutConfig } from '../../../../src/graph/layouts/types';
import { slider, select, type LayoutTab, type LayoutTabContext } from './shared';

export const hexTab: LayoutTab = {
  type: 'hex',
  label: '六边形',
  mount(host, ctx: LayoutTabContext) {
    const R0 = 1.3;
    const LSPACE0 = 2.4;
    const cfg: HexLayoutConfig = {
      radius: R0,
      plane: 'xz',
      orientation: 'flat',
      layers: 1,
      layerSpacing: LSPACE0,
    };

    // 六边形瓦片工厂：外接圆半径 = 布局 radius（与蜂巢格尺度一致 → 密铺）。
    const hexTile = (): THREE.BufferGeometry => {
      const cellR = cfg.radius ?? 1;
      // 略缩 0.95：瓦片间留一道细勾边，确保零重叠、单元格清晰可辨。
      const r = cellR * 0.95;
      const h = Math.max(0.15, cellR * 0.18); // 扁平瓦片
      const g = new THREE.CylinderGeometry(r, r, h, 6);
      // Three.js 6 段圆柱默认「尖顶朝 ±z」（首顶点 θ=0 落在 +z：x=sinθ,z=cosθ）。
      // 布局 flat-top 的平边朝 ±z、pointy 的尖顶朝 ±z ——
      // 故 flat 需旋转 30° 对齐（尖顶→平边朝 ±z），pointy 用默认。之前条件写反会导致瓦片偏 30° 重叠。
      if (cfg.orientation === 'flat') g.rotateY(Math.PI / 6);
      if (cfg.plane === 'xy') g.rotateX(-Math.PI / 2); // 圆柱轴 Y→Z，面板朝相机
      return g;
    };
    // 重建所有节点瓦片（radius/朝向/平面变化时调用）。
    const rebuildTiles = () => ctx.graph.setNodeGeometry(() => hexTile());

    const apply = (instant: boolean) =>
      ctx.apply({ type: 'hex', config: { ...cfg } }, { instant });

    host.append(
      slider({
        label: '外接圆半径',
        min: 0.3,
        max: 4,
        step: 0.1,
        value: R0,
        onInput: (v) => {
          cfg.radius = v;
          rebuildTiles(); // 瓦片尺度随半径变
          apply(true);
        },
      }),
      slider({
        label: '堆叠层数',
        min: 1,
        max: 6,
        step: 1,
        value: 1,
        format: (v) => String(v),
        onInput: (v) => {
          cfg.layers = v;
          apply(true);
        },
      }),
      slider({
        label: '层间距',
        min: 0,
        max: 4,
        step: 0.1,
        value: LSPACE0,
        onInput: (v) => {
          cfg.layerSpacing = v;
          apply(true);
        },
      }),
      select<'flat' | 'pointy'>(
        {
          label: '朝向',
          value: 'flat',
          options: [
            { value: 'flat', label: '平顶' },
            { value: 'pointy', label: '尖顶' },
          ],
        },
        (v) => {
          cfg.orientation = v;
          rebuildTiles();
          apply(false);
        },
      ),
      select<'xz' | 'xy'>(
        {
          label: '平面',
          value: 'xz',
          options: [
            { value: 'xz', label: 'xz 地面' },
            { value: 'xy', label: 'xy 立面' },
          ],
        },
        (v) => {
          cfg.plane = v;
          rebuildTiles();
          apply(false);
        },
      ),
    );

    rebuildTiles(); // 节点换六边形瓦片
    apply(false); // 进入 Tab 动画过渡到蜂巢
    return () => {};
  },
};

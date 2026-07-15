// 网格布局 Tab —— 演示 grid 的纵向层数 / 三向间距 / 列数(自动↔手动)。
// 闭式廉价布局：滑块 input 即时重排。
import type { GridLayoutConfig } from '../../../../src/graph/layouts/types';
import { slider, check, type LayoutTab, type LayoutTabContext } from './shared';

export const gridTab: LayoutTab = {
  type: 'grid',
  label: '网格',
  mount(host, ctx: LayoutTabContext) {
    const SX0 = 1.3;
    const SY0 = 2.4;
    const SZ0 = 1.3;
    const cfg: GridLayoutConfig = {
      levels: 1,
      spacingX: SX0,
      spacingY: SY0,
      spacingZ: SZ0,
    };
    let colsManual = false;
    let cols = 4;

    const apply = (instant: boolean) => {
      const config: GridLayoutConfig = { ...cfg };
      if (colsManual) config.cols = cols; // 手动指定列数；否则缺省由布局按节点数推算
      ctx.apply({ type: 'grid', config }, { instant });
    };

    const colsSlider = slider({
      label: '列数(手动)',
      min: 1,
      max: 20,
      step: 1,
      value: cols,
      format: (v) => String(v),
      onInput: (v) => {
        cols = v;
        if (colsManual) apply(true);
      },
    });
    colsSlider.style.opacity = '0.5'; // 默认自动推算，手动滑块置灰

    host.append(
      check('手动指定列数(否则自动推算)', false, (v) => {
        colsManual = v;
        colsSlider.style.opacity = v ? '1' : '0.5';
        apply(false); // 切换模式动画过渡
      }),
      colsSlider,
      slider({
        label: '纵向层数',
        min: 1,
        max: 6,
        step: 1,
        value: 1,
        format: (v) => String(v),
        onInput: (v) => {
          cfg.levels = v;
          apply(true);
        },
      }),
      slider({
        label: '列间距 X',
        min: 0.3,
        max: 4,
        step: 0.1,
        value: SX0,
        onInput: (v) => {
          cfg.spacingX = v;
          apply(true);
        },
      }),
      slider({
        label: '层间距 Y',
        min: 0.3,
        max: 4,
        step: 0.1,
        value: SY0,
        onInput: (v) => {
          cfg.spacingY = v;
          apply(true);
        },
      }),
      slider({
        label: '行间距 Z',
        min: 0.3,
        max: 4,
        step: 0.1,
        value: SZ0,
        onInput: (v) => {
          cfg.spacingZ = v;
          apply(true);
        },
      }),
    );

    // 进入 Tab：还原球体节点（从六边形 Tab 切回时），动画过渡。
    ctx.graph.setNodeGeometry(null);
    apply(false); // 进入 Tab 动画过渡
    return () => {};
  },
};

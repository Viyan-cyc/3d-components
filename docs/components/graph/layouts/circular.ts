// 环形布局 Tab —— 演示 circular 的半径 / 同心多环 / 弧角 / 平面 / 分组分层。
// 闭式廉价布局：滑块 input 即时重排（instant），实时响应；切 Tab / 切分组用动画过渡。
import type { CircularLayoutConfig } from '../../../../src/graph/layouts/types';
import { slider, select, check, type LayoutTab, type LayoutTabContext } from './shared';

export const circularTab: LayoutTab = {
  type: 'circular',
  label: '环形',
  mount(host, ctx: LayoutTabContext) {
    const R0 = 3.5;
    const RINGS0 = 1;
    const STEP0 = 1;
    const cfg: CircularLayoutConfig = {
      radius: R0,
      plane: 'xz',
      rings: RINGS0,
      radiusStep: STEP0,
      startAngle: 0,
      endAngle: Math.PI * 2,
    };
    let groupByOn = false;

    // instant=true → 无动画（滑块拖动用）；instant=false → 走全局 animate 开关。
    const apply = (instant: boolean) => {
      const config: CircularLayoutConfig = { ...cfg };
      if (groupByOn) {
        // 按 node.group 分桶，每组一个深度层（layerSpacing 控制层间距）。
        config.groupBy = 'group';
        config.layerSpacing = 1.8;
      }
      ctx.apply({ type: 'circular', config }, { instant });
    };

    host.append(
      slider({
        label: '半径',
        min: 0.5,
        max: 8,
        step: 0.1,
        value: R0,
        onInput: (v) => {
          cfg.radius = v;
          apply(true);
        },
      }),
      slider({
        label: '同心环数',
        min: 1,
        max: 6,
        step: 1,
        value: RINGS0,
        format: (v) => String(v),
        onInput: (v) => {
          cfg.rings = v;
          apply(true);
        },
      }),
      slider({
        label: '环半径步进',
        min: 0,
        max: 3,
        step: 0.1,
        value: STEP0,
        onInput: (v) => {
          cfg.radiusStep = v;
          apply(true);
        },
      }),
      slider({
        label: '起始角',
        min: 0,
        max: 6.283,
        step: 0.01,
        value: 0,
        format: (v) => `${(v / Math.PI).toFixed(2)}π`,
        onInput: (v) => {
          cfg.startAngle = v;
          apply(true);
        },
      }),
      slider({
        label: '结束角',
        min: 0,
        max: 6.283,
        step: 0.01,
        value: 6.283,
        format: (v) => `${(v / Math.PI).toFixed(2)}π`,
        onInput: (v) => {
          cfg.endAngle = v;
          apply(true);
        },
      }),
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
          apply(true);
        },
      ),
      check('分组分层(按 group)', false, (v) => {
        groupByOn = v;
        apply(false); // 切换分组用动画过渡更直观
      }),
    );

    // 进入 Tab：还原球体节点（从六边形 Tab 切回时），动画过渡到环形。
    ctx.graph.setNodeGeometry(null);
    apply(false);
    return () => {};
  },
};

// 力导向布局 Tab —— 演示 force 的斥力 / 弹簧 / 迭代 / 维度 / Barnes-Hut 加速。
// 力导向昂贵（每应用一次跑 N×iterations）：滑块用 change（释放）触发，避免拖动时反复迭代卡顿。
import { Layouts } from '../../../../src/graph/layouts';
import type { ForceLayoutConfig } from '../../../../src/graph/layouts/types';
import { slider, select, check, statusLine, type LayoutTab, type LayoutTabContext } from './shared';

export const forceTab: LayoutTab = {
  type: 'force',
  label: '力导向',
  mount(host, ctx: LayoutTabContext) {
    const CHARGE0 = 30;
    const LINK0 = 1;
    const STIFF0 = 0.3;
    const ITER0 = 300;
    const cfg: ForceLayoutConfig = {
      dimensions: 3,
      iterations: ITER0,
      chargeStrength: CHARGE0,
      linkDistance: LINK0,
      linkStrength: STIFF0,
    };
    const perf = statusLine('—');

    const run = () => {
      // 纯函数耗时自检：直接调 Layouts.force 计时（大图可见 Barnes-Hut 提速）。
      const data = ctx.graph.getData();
      if (data && data.nodes.length) {
        const edges = data.edges.map((e) => ({ source: e.source, target: e.target }));
        const t0 = performance.now();
        Layouts.force(data.nodes, { ...cfg, edges });
        const ms = performance.now() - t0;
        perf.set(
          `计算耗时 <code>${ms.toFixed(0)}ms</code> · Barnes-Hut <code>${cfg.barnesHut ? '开' : '关'}</code>`,
        );
      }
      // 实际应用（force 过渡稍长，便于观察收敛形态）。
      ctx.apply({ type: 'force', config: { ...cfg } }, { duration: 0.9 });
    };

    host.append(
      slider({
        label: '斥力',
        min: 0,
        max: 150,
        step: 1,
        value: CHARGE0,
        format: (v) => String(v),
        onCommit: (v) => {
          cfg.chargeStrength = v;
          run();
        },
      }),
      slider({
        label: '弹簧长度',
        min: 0.2,
        max: 6,
        step: 0.1,
        value: LINK0,
        onCommit: (v) => {
          cfg.linkDistance = v;
          run();
        },
      }),
      slider({
        label: '弹簧刚度',
        min: 0,
        max: 1,
        step: 0.01,
        value: STIFF0,
        onCommit: (v) => {
          cfg.linkStrength = v;
          run();
        },
      }),
      slider({
        label: '迭代步数',
        min: 50,
        max: 800,
        step: 10,
        value: ITER0,
        format: (v) => String(v),
        onCommit: (v) => {
          cfg.iterations = v;
          run();
        },
      }),
      select<'3' | '2'>(
        {
          label: '维度',
          value: '3',
          options: [
            { value: '3', label: '3D' },
            { value: '2', label: '2D(xz)' },
          ],
        },
        (v) => {
          cfg.dimensions = Number(v) as 2 | 3;
          run();
        },
      ),
      check('Barnes-Hut(3D 大图 O(n log n) 加速)', false, (v) => {
        cfg.barnesHut = v;
        if (v && cfg.theta == null) cfg.theta = 0.9;
        run();
      }),
      slider({
        label: 'BH 开角 θ',
        min: 0.3,
        max: 1.5,
        step: 0.05,
        value: 0.9,
        onCommit: (v) => {
          cfg.theta = v;
          run();
        },
      }),
      perf.el,
    );

    // 进入 Tab：还原球体节点（从六边形 Tab 切回时）。
    ctx.graph.setNodeGeometry(null);
    run();
    return () => {};
  },
};

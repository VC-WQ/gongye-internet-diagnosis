# V2.5 研究舞台与信息交接

以 `ec9e74a` 为基线的增量改造，保留现有 API、权限、Pico 协议、Logo 与主题。研究中心由长文章改为固定舞台；全部 5 主题和 13 研究点仍可访问。

## 单一叙事进度

- `stageTimeline.ts` 将既有 19 个目录标识映射为场景。每段前 58% 用于稳定阅读，后 42% 局部图形交接（最新整改见 `VISUAL_CORRECTIONS.md`）。逆向滚动使用同一映射，没有另一套返回动画。
- `useStageTimeline.ts` 只读取自然文档 scrollY，相对 runway 计算 position。目录和上/下场景按钮通过可中断的滚动 tween 改变同一个 scrollY。
- `ResearchScrollIntent` 的 epoch 管理动画所有权；迟到回调无法更新新意图。停止后没有常驻 RAF。
- URL 的 hash 表示场景身份，不是 DOM 标题锚点。滚动观测只 replace；内部 replace 签名阻止 Router 写入反馈回路。旧 `/research/:topic/:point` 首次进入不自动改写，保留 Pico 精确 URL 回执。
- sticky 舞台及祖先不裁切；只有内层 viewport 裁切出入场景。窗口尺寸重测保留当前进度，移动目录展开为覆盖层。
- 当前相邻场景最多两层；XJTU/SDE 的同源 RUL 共用一层。非当前场景 inert/aria-hidden；键盘目录完成后聚焦稳定标题；退休场景中的焦点转到稳定工具条。

## 数据与完整详情

`stagePlots.ts` 为信号、孪生和跨域提供复杂图形，`stageEvidence.ts` 为其余已知协议显式提取代表数据，不扫描任意数字字段，不跨任务混合单位。真实零值、负 R²、缺失状态仍由 `dataContract.ts` 决定。柱图保留零基线，负值自然扩展。CWRU 为 g/ms，孪生时间为小时；仿真与运行数据分别标注。

舞台展示代表性图。Drawer 直接 lazy 复用全部 12 个原始研究 renderer、证据索引和全景，保留完整轴、单位、图例、模型参数和来源。关闭销毁图表；外层 `ResearchDataProvider` 保留 RUL/XJTU 显式选择和同一数据作用域。公开入口不读取运行统计。旧文章估高与锚点控制 hooks 已移除，避免第二套导航所有者。

## 信息交接的适用范围

`FlipText` / `FlipValue` 用于短文本或值：固定裁切窗口，旧值向上、新值从下进入，WAAPI 从中断姿态衔接，revision 拒绝旧完成。辅助技术只读最新值。尺寸预留由真实文本测量获得。

`FlipContent snapshot="..."` 明确用于纯文本（当前设备编号与类型），复用完整交接。当前默认复杂内容使用单实例的旧展示退出、最新展示进入；退出 DTO 冻结并 inert/aria-hidden，真实 Workspace 与数据订阅立即切换。不要包裹 Provider 或可写表单来保留旧业务状态；详见 `CONTENT_MOTION.md`。chart/form/provider 不复制。

`FlipSelection` 是单独的实测轨道，接受受控 selector；只在尺寸实际变化时由 RO 重定位，避免初次通知取消动画。动态 reduced-motion 立即取消自有动画并按真实选中位置落位。

## 动效层级与维护

短反馈复用现有 token：hover/pressed 约 120–180ms；控件/选择约 180–300ms；面板按现有 content token。研究场景由真实滚动进度驱动，不播放伪加载时间线。微交互只作用于原生按钮、图标或内层文字，避免和行退出、图表、Pico Avatar 的动画所有权冲突。disabled 和 reduced-motion 单独处理。

没有新增依赖；参考本地 Inspira ScrollSwapText 的空间关系、AnimatedTabs 的共享指示器与 GSAP Skills 的作用域清理原则，以原有 React/WAAPI/RAF 实现。未复制 Vue 框架代码。

## 验证入口

- `npm test`：原测试 + 交接中断/RM + 场景映射/进度/单位/零值/负值/缺失。
- `npm run typecheck`、`npm run build`。
- 浏览器验收：三真实场景进/停/出、19 目录、12 次快切、滚轮打断/RM/resize/POP/refresh/旧路径、五尺寸双主题、详情关闭、Pico、工厂手势、资源循环。
- 审计、截图、录屏和实际运行结果保存在仓库外 `_agent_runs/gongye-internet-diagnosis/v2_5_stage`；未验证项在最终交付报告明确标为 UNVERIFIED。

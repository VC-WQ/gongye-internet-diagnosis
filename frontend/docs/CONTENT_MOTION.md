# 内容交接与业务状态

文字、复杂内容和 Tab 共用机械交接规范，但各自保留合适的生命周期。业务设备、事件、权限和路由应立即更新；动画只决定旧展示如何退出。

## 文字与数字

- `FlipText` 保留打断时仍在窗口内的文字层，新文字接着当前可见位置进入。
- `FlipValue` 复用同一动画并使用等宽数字。
- 相同字符串不会重播。静态标题、每个实时采样点和连续滚动进度不应强加翻牌。
- 无障碍文字即时更新；动画层和测量层均不进入读屏内容。
- 仅在过渡过程中保留旧、新尺寸，完成后恢复最新文字的实际占位。

## 复杂内容

`FlipContent` 的复杂模式使用 `useContentTransition` 与纯状态机 `contentPresence.ts`，始终只有一个展示子树：

1. 目标身份改变，业务父组件立即处理新身份与请求。
2. 旧展示保留 128ms 退出，根节点立即 `inert`、`aria-hidden`；若焦点在其中，移到外部持久面板。
3. 退出完成后只提交最新目标，使用 192ms 入场。A→B→C 不会等待展示未出现过的 B。
4. 退出过程中回到 A，从当前可见位姿恢复，不先清空 A。旧动画完成回调由 revision 拒绝。
5. 相同身份的采样、数值或内容刷新正常渲染，不再播放整块交接。

传入复杂模式的内容应是由父组件提供的展示 DTO。不要把 `WorkspaceProvider`、请求 Hook 所有者、工业操作表单或控制器包在动画中。否则旧视觉退场可能连带保留旧订阅。工厂监测的采样订阅由 `FactoryWorkspace` 所有，`SensorChart` 本身只有图形展示；设备外观编辑器位于摘要交接外，直接跟随当前业务设备。

`snapshot` 模式仅用于纯文字，交由 `FlipText` 处理。它不抓取 DOM，也不复制 Canvas、图表、表单或订阅。

## Tab

`ContentTabs` 复用 Ant Design 现有 pane 动画与挂载机制，启用旧 pane 退出和新 pane 进入。离开的 pane 立即标为 inert，结束后销毁；选中的 Tab 与 URL 不等待动画。

带有读取或轮询的 pane 还应接收当前业务 `active` 状态，在离开时立即停用读取。当前时间线、阈值建议和 PHM 展示均保留默认 `active=true` 的独立使用方式。事件处置操作组件在离开处置 Tab 时立即卸载，不能在透明旧 pane 或 Portal 中留下可执行操作。

## 中断与资源

- `prefers-reduced-motion` 在动画中改变时立即取消并提交最新目标。
- 视口尺寸变化结束过渡到最新展示，不读取旧矩形继续裁切。
- 只使用 transform、opacity 和 clip-path；不逐帧改变内容宽高。
- WAAPI 由组件独占并在卸载时取消。共享交接不创建 RAF、定时器、DOM 克隆或第二个图表实例。
- 路由模块动画仍由 `routeMotion.ts` 的唯一 document ViewTransition 所有；局部交接不调用第二个 document ViewTransition。

## 验证

运行 `node --test tests/content-presence.test.mjs tests/text-handoff.test.mjs tests/table-motion.test.mjs` 验证状态不变量。浏览器还必须检查快速 A→B→C、A→B→A、清选、错误/加载/空态、RM 中途切换、视口改变与焦点。

可通过 `data-content-phase`、`data-content-identity`、`data-content-target` 检查展示阶段、退出身份与当前业务目标。不得以纯状态测试通过替代真实图表、表单和浏览器交接验收。

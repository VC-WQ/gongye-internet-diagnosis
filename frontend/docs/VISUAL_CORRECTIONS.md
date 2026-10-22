# V2.5 视觉交互整改交接

基线：`e78dab4375ddc1b43ee30fe883cdb2afaf2afdcb`。保留现有业务 API、权限、Pico Agent 协议、Three.js 角色、Logo、品牌红和研究目录身份。本轮不修改后端业务逻辑，也不新增动效框架。

## 登录与工厂

`loginTimeline.ts` 的 A/B/C 为独立时间线。`settle()` 只有一个有界过冲峰，端点精确归位。A 的红、白、表单分别落位；B 保留预备/收拢/裁切/RouteReady；C 白纸以左侧为原点展开，红块随后进入，表单最后恢复。仍由原有 epoch、认证清理和 provider RAF 管理中断。

工厂删除全屏入口、状态、监听和浏览器全屏调用。五个筛选等宽；连接状态独立布局。桌面看板按真实顶部及底部 padding 测量剩余视口，窄屏恢复自然文档流。

`FactoryScene` 的 controller 唯一写设备位置，React 仅渲染不可变业务快照，稳定 key 保持模型身份。选中聚焦仅由有效业务上下文触发；初始化等待真实布局，按设备、视口与目标座位签名去重。手势仍由原指针会话仲裁。

`sceneLayout` 在 Hermite 路径上叠加端点位移/导数均为零的有界弧度。空间寻路与时间校验共用 `TEMPORAL_GAP`；有限的预约边界候选代替密集启动时间扫描。每个候选仍检查完整设备包围盒与 swept interval；弧线不可行时允许安全直线/既有稳定回退。禁止为性能跳过碰撞验证。

## 文字、Pico 与偏好

`FlipText` 保留中断时窗口中所有可见文字层，而不是把尚未入窗的字符串当作旧画面。`textHandoff` 是运行时使用的纯组合几何函数。WAAPI 完成有 revision 防护，减少动画和卸载会取消。相同宽度桶保留最大行高，Resize 重新测量；当前设备名称固定预留两行，全名可由辅助技术和 tooltip 读取。

Pico attention 增强视线、倾斜与前倾，短时间重复 attention 合并；触摸不触发悬停，工作台内部焦点移动不重启注意动作。保留有意的打开、发送和语音动作优先级。实验台大小、速度使用数值型 Ant Design Select。

主题只有 `UiPreferencesProvider.theme` 一份业务状态。共享指示器从取消前的实际矩形继续到目标；主题 effect 不在读取姿态前取消动画，ResizeObserver 与卸载各自清理。

## 研究舞台

固定舞台、绘图区、标题与来源槽位。兼容的 XJTU → SDE/PF 使用同一轴承的真实 RUL 路径，只有在身份、长度及每个 actual 值全部相等且两份证据均 available 时共享。原始采样点的分钟坐标用于对齐；预测 null 保留断线，详情继续保留原百分比坐标、基线负 R² 和全部选择。

CWRU 使用时域/FFT/t-SNE 多网格，孪生使用退化事件及 TTF 样本，跨域使用逐设备准确率热力图与源/目标指标。没有跨域嵌入坐标，因此不生成目标域散点。手机将主图重排，完整图表仍在详情。ECharts 在 option 边界使用 `notMerge` 去除旧网格，滚动帧不调用 setOption。

非兼容图形沿同一进度局部裁切与轻微缩放，标题/来源小幅交接；没有整张场景 ±106% 平移。共享 Life 的实际路径不重挂载。减少动画使用完整 active 快照，不残留半幅 mask。最多保留当前/相邻两场景。

展示顺序与目录顺序独立，开场为信号 → 退化 → 预测 → 孪生 → 跨域。全部 5 个主题、13 个研究点、19 个 ID、旧路径、公开/登录边界和详情入口保留。滚动反向使用同一进度，历史与目录仍由 `useStageTimeline` 单独管理。

## 参考与验证

阅读本机 design-references 的 GSAP timeline/react/performance Skills，以及 Inspira UI README、AnimatedTabs、TextScrollReveal/Parallax 实现。采用单进度、共享指示器、作用域清理、合成属性优先的原则；未复制 Vue 组件或引入 GSAP/Motion 依赖。

运行 `npm test`、`npm run typecheck`、`npm run build`。浏览器必须补充登录 A/B/C、24+ 次混合选择、快速筛选、触屏/触控板事件、Pico A–F、主题反向、19 个研究身份、三种宽高、双主题、减少动画、Resize、历史和资源释放。测试不能以构建通过替代视觉验收。

审计日志、截图、录屏、数据夹具和交付状态矩阵位于仓库外 `_agent_runs/gongye-internet-diagnosis/v2_5_corrections`。目录内保留最初失败与修复后证据；物理触控板、物理手机和真实在线模型不因浏览器模拟通过而被宣称完成。

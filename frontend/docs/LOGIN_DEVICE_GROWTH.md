# 登录面板与工厂设备三维生长

基线：V2.6 整合提交 `6c5aea12ffdef3dca0310a82d1f966a261286f14`。本增量不修改登录 A/B/C 外壳时间轴、研究中心、Pico Agent、设备 API、工厂路径/碰撞/相机算法或后端。

## 登录

`LoginTransition` 的原 A RAF 发布只读 `IntroProgressChannel`。`useLoginPanelEntrance` 驱动标题、说明、Tab、两字段、主操作和辅助入口的局部样式，没有第二条常驻时间轴。移动端揭示窗口稍晚，所有子项在 A 结束前完成。CSS 默认完整可见；取消、减少动画、切换 Tab、卸载均恢复静态样式。

`loginSnapshot` 识别密码容器及 autocomplete 语义，密码眼睛切至 text 也不会进入快照；克隆设为 inert、移除焦点和 ID，并把瞬态入场样式归一化，供原 B/C 使用。认证、注册、returnTo 与 RouteReady 沿用既有实现。

回滚内层动效可移除 Login 的 `useLoginPanelEntrance` 调用，保留静态布局和快照密码保护；不要删除或改写外壳时间轴。

## 三维层与唯一业务身份

- `FactoryScene` 继续拥有 SVG、布局、相机与原输入控制器；`DeviceSceneBridge` 在同一 paint 完成后发布实际锚点，不轮询 DOM。
- `projection.ts` 从 SVG 和设备 screen CTM 计算相对仿射变换，再校准正交相机。模型底部四角与原非对称平台一致；Canvas 可视区排除底部 44px 控件。DPR 仅影响绘制缓冲区，最高 1.5。
- `GrowthMotion` 唯一持有展示进度/速度及 activeId。Workspace selected ID 始终是业务身份；A 回收时查询、诊断和 Pico 已使用最新 B。零进度才交换模型身份，A→B→A 在零点前可保留 A。
- `models.ts` 提供 compressor、pump、motor、generic 程序化 Mesh；固定底座，主体转台，base/body/mechanics/details 重叠生长。未知类型显示“通用示意”，不是数字孪生或真实设备结构承诺。
- `DeviceGrowthHost` 首次合法可见选择才导入运行层。每个工厂路由最多一个 renderer，静止无 Factory 自驱 RAF；SVG 移动时同步跟随原 paint。没有外部资产请求或设备级异步模型 Promise。
- 拖动热区只在展开且原 SVG 无 pointer 会话时启用；双指跨边界转交原 SVG 控制器；wheel/gesture 复用原相机。局部左右键/旋转按钮和 Esc 可用。展开资料卡保留真实 ID、类型、状态和有别名时的真实名称。

WebGL 初始化失败、context lost、无效/零尺寸锚点、设备消失或过滤隐藏均撤销热区、还原 SVG。context restored 有界重建；懒模块失败提示重新加载页面，不循环重试。卸载释放本层的几何、材质、监听器及 context，不影响 Pico。

回滚三维层可移除 FactoryScene 的 DeviceGrowthHost 挂载，保留原 SVG 与业务入口；同时移除或隐藏外观入口即可完整退回原展示。不要禁用原相机、碰撞、诊断或 Pico 以规避故障。

## 外观偏好与账户

`DeviceVisualProvider` 只读取已验证账户，键为 `factory:visual:v1:<encoded origin>:<userId>/device/<encoded deviceId>`。每设备独立写入，跨 Tab storage 同步，避免旧 map 覆盖。应用在 token 跨 Tab 变化时撤销旧请求并重新验证账户，旧 Provider 的写操作也核对 sessionToken。

别名按 NFC 归一化，2–24 个 Unicode 字符，禁止控制/隐藏格式字符；图标和色值均白名单校验。偏好只修改展示，不调用设备写 API，不覆盖 Device DTO 或状态色。持久化失败仅内存生效并明确提示；坏 entry 独立忽略，恢复默认只删除本设备偏好键。

## 验证与维护

运行 `npm test`、`npm run typecheck`、`npm run build`。新增自动化覆盖登录进度/快照、真实 Three 模型结构与释放、投影/射线、可逆速度与身份交换、外观校验/账户键。真实浏览器验收及性能测量使用仓库外的受控 SQLite 副本和模拟采样，不连接工业 MQTT、不执行事件处置或设备控制。

开发模式 DOM 只读 `__growthQA` 用于角点证据，生产构建不导出该对象；data 属性用于阶段、实例和资源计数。GPU 显存、真实 Safari 触控板和手机软键盘需要硬件专项验证。审计日志、截图、录屏及临时数据库保存在仓库外 `_agent_runs/gongye-internet-diagnosis/login-device-growth-20261022`。

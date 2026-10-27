# HarmonyOS 应用端（工业设备智能诊断平台）

本目录是对应"AI+鸿蒙"ICT 赛题、纯软件方向的 **HarmonyOS ArkTS/ArkUI 应用端**。
复用 `backend` 提供的 REST API（`/api/v1` 前缀），与 `frontend`（React Web）访问同一套后端数据，
用于证明"端（感知与交互）- 云（业务中枢）- 智（AI 大脑）"三层架构中的"端"采用鸿蒙架构落地。

## 已实现能力

- **设备监控看板**：设备目录 + 健康分 + 边缘异常分 + 状态徽章（`/devices`）。
- **诊断事件**：事件列表、事件详情、人工确认/拒绝、状态时间线（`/command-loop/events/*`）。
- **诊断报告**：按事件 ID 生成并查看完整诊断报告（`/reports/event/{id}`）。
- **登录鉴权**：JWT 登录（`/auth/login`），token 存于 AppStorage，请求头自动携带。

## 目录结构

```
harmony/
├── AppScope/app.json5                        应用级配置（bundleName、图标、名称）
├── build-profile.json5 / hvigorfile.ts / oh-package.json5  工程级构建配置
└── entry/
    ├── src/main/module.json5                 模块配置（ability、权限、页面路由）
    ├── src/main/resources/base/profile/main_pages.json5   页面清单
    ├── src/main/resources/base/element/*.json            字符串/颜色资源
    └── src/main/ets/
        ├── entryability/EntryAbility.ets     入口 UIAbility
        ├── common/Constants.ets              后端地址配置（重点修改）
        ├── model/Models.ets                  后端 DTO 类型
        ├── service/ApiClient.ets             通用 HTTP 客户端（含鉴权头）
        ├── service/AuthStore.ets             登录态存储
        ├── service/DataService.ets           业务接口封装
        └── pages/
            ├── Index.ets                     设备监控看板（首页）
            ├── LoginPage.ets                 登录页
            ├── EventPage.ets                 诊断事件列表
            ├── EventDetailPage.ets           事件详情 + 确认/拒绝 + 时间线
            └── ReportPage.ets                诊断报告
```

## 运行前提

1. 先启动后端（`backend/`），接口监听 8000 端口，访问 `http://127.0.0.1:8000/health` 应返回 `{"status":"ok"}`。
2. 后端需已有可登录账号（开发模式默认演示管理员 `admin`，口令见后端 `.env` 的 `BOOTSTRAP_ADMIN_PASSWORD`）。

## 关键配置：后端地址

编辑 `entry/src/main/ets/common/Constants.ets` 中的 `BASE_URL`：

```ts
export class ApiConfig {
  // 模拟器访问本机后端：
  static readonly BASE_URL: string = 'http://10.0.2.2:8000/api/v1';
  // 真机请改为运行后端电脑的局域网 IP，例如：
  // static readonly BASE_URL: string = 'http://192.168.1.100:8000/api/v1';
}
```

> 真机调试时，确保手机与后端电脑在同一局域网，且后端 `cors_origins` 不影响原生 App（鸿蒙端不走浏览器 CORS）。

## 编译运行

1. 安装 DevEco Studio（HarmonyOS NEXT，API 12 及以上）。
2. 用 DevEco Studio 打开本 `harmony/` 目录（识别为工程根）。
3. 等待工程同步（Sync）后，选择模拟器或真机运行。
4. 首次打开若 SDK 版本不匹配，请在 DevEco Studio 的工程设置中同步 `compatibleSdkVersion` 到本机已安装的 SDK 版本。

> 说明：本工程按 HarmonyOS 5.0（API 12）Stage 模型编写；不同 DevEco Studio 版本可能提示升级 hvigor/SDK 版本，按 IDE 提示一键同步即可。

## 使用流程

1. 启动后端 + 启动鸿蒙应用。
2. 首页（设备看板）默认可匿名查看设备目录。
3. 点击右上角「登录」，输入后端账号。
4. 进入「诊断事件」查看事件，点击进入详情，对待确认事件执行「确认执行 / 拒绝」。
5. 在详情或「诊断报告」页输入事件 ID 生成完整报告。

## 与 Web 端的关系

鸿蒙端与 `frontend`（React Web）调用同一后端、同一数据库、同一批接口，仅前端渲染层不同。
演示时可在视频中并置展示两者访问同一后端数据，凸显"端采用 HarmonyOS 架构"。
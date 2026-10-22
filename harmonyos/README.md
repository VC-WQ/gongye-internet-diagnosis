# 鸿蒙端

这是赛题里的交互端。它是一个 HarmonyOS Stage 模型应用，用 ArkTS 和 ArkUI 写，跑在手机或平板上。云和智能诊断仍在仓库原来的 FastAPI 里。

| 层 | 在这个仓库里 | 做什么 |
| --- | --- | --- |
| 端 | `harmonyos/` | 登录、选设备、看采样、发起诊断、确认或拒绝、下发润滑 / 降载 / 检修 |
| 云 | `backend/` | 账号、设备目录、采样窗口、会诊、指令发布 |
| 智 | 云上的模型和会诊 | 泵的梯度提升树、电机剩余寿命、会诊解读。鸿蒙端不计算分数 |

网页大屏 `frontend/` 还在，和鸿蒙端调用同一组 `/api/v1` 接口。

## 用 DevEco Studio 打开

1. 安装 DevEco Studio 5 或更新版本，并安装 HarmonyOS SDK，API 12 及以上。
2. 用 DevEco 打开本目录 `harmonyos/`，不要打开仓库根目录。
3. 第一次同步时按提示配置自动签名。`build-profile.json5` 里的 `signingConfig` 会由 DevEco 补全。
4. 选手机或平板模拟器，或连接真机，运行 `entry`。
5. 若工程提示 SDK 版本高于本机，按向导把 `compatibleSdkVersion` 调成本机已安装的版本。页面代码不用改。

当前这台开发环境没有 DevEco，也没有鸿蒙模拟器，所以这里不能编出 HAP，也不能在模拟器里点按。能在 DevEco 里编译、安装和操作的是你自己的电脑。

## 连到云

登录页要填云地址，应用会请求 `{云地址}/api/v1/...`。

- 模拟器访问本机后端：`http://10.0.2.2:8000`
- 真机访问电脑：填电脑的局域网地址，例如 `http://192.168.1.20:8000`。手机和电脑在同一网络，并放行 8000 端口
- 首次启动后端时的账号：`admin` / `admin123`

明文 HTTP 已在 `entry/src/main/resources/base/profile/network_config.json` 放开。生产环境应改成 HTTPS，再关掉明文。

先启动后端，并让模拟器或公开数据回放把采样送进云侧。设备页没有采样时，诊断页不能发起诊断。

## 页面

1. **设备**：读取 `GET /devices`。卡片上的健康分是设备目录里的记录，不是本次诊断算出来的。
2. **采样**：每 5 秒读 `GET /mqtt-pipeline/window/{id}`。最近一条超过 15 秒，诊断页不允许发起。
3. **诊断**：把当前窗口提交到 `POST /command-loop/events`。泵、电机的分数和说明用云侧返回的 `health_score`、`health_basis`、`model_card`。没有模型输出时显示未评分，端上不补一个分数。
4. 待确认时可以确认或拒绝。确认只进入处置，还不给设备下发动作。
5. 处置中只能下发 `lubricate`、`reduce_load`、`repair`。页面写明：云侧返回指令编号只表示已经发布，不表示设备已经执行，也不表示故障已经恢复。本页没有回执查询。

同一台设备若还有未闭环事件，云侧会复用该事件。页面会说明没有新建诊断。

## 目录

```
harmonyos/
├── AppScope/                 # 应用名、包名、图标
├── entry/src/main/ets/
│   ├── entryability/         # 启动
│   ├── pages/Index.ets       # 登录或主界面
│   ├── view/                 # 设备、采样、诊断
│   └── common/               # 登录态和 /api/v1 客户端
└── entry/src/main/module.json5
```

包名是 `com.industrial.diagnosis.harmony`。

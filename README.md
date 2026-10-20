# 物理数字孪生驱动的工业设备多智能体诊断系统

> Industrial Equipment Multi-Agent Diagnosis System driven by Physical Digital Twin
>
> 统一接口前缀：`/api/v1`　后端：FastAPI　前端：React + TypeScript + Ant Design　实时通信：MQTT + WebSocket

---

## 0. 这是什么

本系统面向工业旋转机械（离心泵、驱动电机、空压机）的**预测性维护与故障诊断**。核心设计原则一句话：

> **让大模型只做「解读」，不做「计算」。**

所有数值判断（振动分类、物理残差、数字孪生、健康评分）交给可解释的算法；大模型（DeepSeek）只负责把硬指标转述成自然语言诊断报告，从机制上规避数值幻觉。

使用前请先读第 4 节（启动）与第 9 节（注意事项），其中包含数据库、大模型 Key、MQTT 等最容易踩坑的配置点。说明文档就是本 README。

---

## 1. 系统架构一览

```
┌──────────────┐   MQTT(1883)   ┌──────────────┐   WebSocket    ┌──────────────┐
│  虚拟设备模拟器  │ ─────────────▶ │  MQTT Broker  │ ────────────▶ │              │
│  simulators/   │                │  (Mosquitto)  │               │   后端 FastAPI │
│  耦合SDE退化    │                └──────────────┘               │  backend/     │
└──────────────┘                                                  │  /api/v1      │
                                                                  └──────┬───────┘
                                                                         │ HTTP
                                                                         ▼
                                                                  ┌──────────────┐
                                                                  │  前端 React   │
                                                                  │  frontend/    │
                                                                  │  5173 / 80    │
                                                                  └──────────────┘
```

- **模拟器**：用耦合随机微分方程（SDE）对 6 台异构设备的退化过程建模，产出振动/温度/电流/压力/转速/声压等观测值，可选通过 MQTT 上报。
- **后端**：FastAPI，18 个功能模块路由，负责诊断、孪生、多智能体会诊、报告、阈值、可视化数据等。
- **前端**：React 单页应用，V2.2 四域工作空间（工厂 / 工具 / 管理 / 关于），ECharts 绘图、Three.js 数字人 Pico；工厂与 Pico 使用统一的设备/事件上下文。
- **大模型**：DeepSeek（OpenAI 兼容接口），仅用于会诊报告的「解读」环节，可用 Mock 模式离线运行。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI 0.115 + Uvicorn，SQLAlchemy 2.0，Pydantic 2 |
| 实时通信 | paho-mqtt 2.1 + WebSocket（自研连接管理器） |
| 机器学习 | PyTorch 2.5（1D-CNN 故障分类、PINN 物理正则自编码器） |
| 多智能体 | LangGraph 0.2 + LangChain 0.3 |
| 大模型 | DeepSeek（`openai` SDK 兼容调用） |
| 认证 | PyJWT + bcrypt |
| 数据库 | SQLite（默认）/ MySQL（可切换） |
| 前端 | React 18 + TypeScript 5 + Vite 5 + Ant Design 5 |
| 可视化 | ECharts 5 + echarts-for-react；Three.js 0.186（数字人） |
| 部署 | Docker Compose（backend / frontend / mqtt / simulator 四服务） |

---

## 3. 目录结构详解（每个文件夹/文件是干什么的）

```
.
├── backend/                # 后端服务（FastAPI）
├── frontend/               # 前端应用（React + Vite）
├── simulators/             # 虚拟设备模拟器（物理数字孪生 SDE）
├── data/                   # 运行时导出物（视觉检测曲线/样例图等）
├── mqtt/                   # Mosquitto broker 配置
├── scripts/                # 数据分析、训练、一键启动脚本
├── tools/                  # 工具与开发期脚本（非运行时依赖）
├── docker-compose.yml      # 一键编排
├── start-local.bat         # Windows 本机一键启动
├── .npmrc                  # npm 源配置
└── .gitignore
```

> 原始数据集（`datasets/`）和模型权重（`models/*.pt`）体积较大，未纳入本仓库。需要时按第 3.4 / 3.5 节自行准备。

### 3.1 `backend/` —— 后端服务

```
backend/
├── Dockerfile              # 后端镜像（python:3.10-slim，uvicorn 启动）
├── requirements.txt        # Python 依赖清单（锁定版本）
├── .env                    # 环境变量（DB / DeepSeek / 密钥）★需按需修改★
├── init_db.py              # 手动初始化数据库脚本
├── industrial_diagnosis.db # SQLite 数据库（运行时会用到）
└── app/
    ├── main.py             # ★应用入口★：注册全部路由、生命周期、种子数据
    ├── config.py           # 全局配置（Settings，读 .env）
    ├── data/               # 可视化用的静态 JSON 数据（CWRU/蒸汽量/孪生等）
    ├── models/             # ORM 模型（device/diagnosis/event/user）
    ├── services/           # 预留服务层（当前为空命名空间）
    ├── utils/              # 通用工具（logger）
    └── modules/            # ★业务模块，每个子目录=一个功能域★
```

`app/data/` 下的 JSON 是**前端图表的数据源**（由 `scripts/` 预先分析生成）：

| 文件 | 内容 |
|---|---|
| `dataset_registry.json` | 8 个数据集的目录登记（样本量/维度/任务/来源） |
| `cwru_signal.json` | CWRU 轴承时域/频域/特征频率数据 |
| `ml_classification.json` | 故障分类的混淆矩阵、ROC、特征重要性 |
| `ml_rul.json` | 剩余寿命（RUL）预测结果 |
| `xjtu_rul.json` | XJTU-SY 轴承健康指标退化曲线 |
| `pump_phm.json` | 泵的数字孪生 PHM（退化轨迹/TTF/维护价值） |
| `smartfactory.json` | 产线级多机组异常态势 |
| `steam_analysis.json` / `steam_ml.json` | 工业蒸汽量多模型分析与回归指标 |

`app/modules/` 各模块（路由挂载在 `/api/v1`）：

| 模块 | 作用 |
|---|---|
| `auth/` | 登录鉴权（JWT）、用户管理（`admin.py`）、密码加密（`security.py`） |
| `device_catalog/` | 设备目录 CRUD |
| `mqtt_pipeline/` | MQTT 接入 + WebSocket 实时推送（`mqtt_client` / `websocket_manager`） |
| `edge_inference/` | 边缘端推理接口 |
| `anomaly_detect/` | ★核心诊断★：`cnn_classifier`(1D-CNN)、`pinn_residual`(物理正则)、`health_scorer`(健康评分)、训练脚本 |
| `digital_twin/` | 数字孪生隐状态演化服务 |
| `multi_agent/` | ★多智能体会诊★：`graph`(LangGraph 流程)、`signal_agent`/`knowledge_agent`/`chairman`(各角色)、`llm_client`(DeepSeek)、`knowledge_base/` |
| `command_loop/` | ★指令闭环★：状态机（`alarm→consulting→pending→handling→observing→resolved/rejected`）、反馈评估、准确率跟踪、阈值自适应建议；另含 `revise()` 人工修订（改写报告建议/故障标签 + 写审计时间线，**不推进状态机**） |
| `threshold/` | 阈值管理 |
| `report/` | 诊断报告生成（快报/事件报告） |
| `timeline/` | 事件时间线 |
| `records/` | 诊断记录 |
| `feedback/` | 反馈采集 |
| `acoustic/` | 声学频谱分析 |
| `vision/` | 视觉检测（NEU-DET）：`samples/`(样例图) `weights/`(模型) `comparison.json` |
| `viz/` | ★可视化数据聚合接口★（前端所有图表数据的统一出口） |

### 3.2 `frontend/` —— 前端应用

```
frontend/
├── Dockerfile          # 多阶段构建：node 构建 → nginx 托管
├── nginx.conf          # 生产反代：/ 走 SPA，/api 转发 backend:8000
├── vite.config.ts      # 开发端口 5173，/api 代理到 localhost:8000
├── index.html          # 页面模板
├── package.json        # 依赖与脚本（dev/build/preview）
├── tsconfig*.json      # TS 配置
├── node_modules/       # 依赖（已安装）
└── src/
    ├── main.tsx        # 应用挂载入口
    ├── App.tsx         # ★路由与整体布局★（业务页 + 管理页 + 登录，含兜底跳转）
    ├── index.css       # 全局样式（tech-dark 主题）
    ├── services/api.ts # ★全部接口封装★（baseURL='/api/v1'，附带 token）
    ├── theme/echarts.ts# ECharts 深色主题
    ├── components/     # 可复用可视化/功能组件（见下表）
    └── pages/          # 各页面（每页一个目录，index.tsx）
```

**`src/components/` 组件：**

| 组件 | 作用 |
|---|---|
| `ChartNote.tsx` | 图表说明浮层（统一提供 说明/数据来源/如何解读 三问） |
| `DigitalTwinPhm.tsx` | 数字孪生预测性维护（退化轨迹/故障分布/TTF/维护价值 ROI） |
| `SmartFactory.tsx` | 产线级多机组异常态势（工段分布/多传感器异常度/故障率） |
| `CwruSignal.tsx` | CWRU 轴承信号诊断（时域/频域/t-SNE/严重度热力图） |
| `VisionDetect.tsx` | 视觉检测智能体（上传图→YOLOv8s/RT-DETR 检测） |
| `DataAssetRegistry.tsx` | 数据资产总览（数据集目录卡片） |
| `DigitalHuman3D.tsx` | Three.js 全息数字人（会诊播报，中文 TTS） |
| `DomainAdapt.tsx` | CWRU 域适应对比 |
| `FPCnnCompare.tsx` | FP-CNN 对比实验 |
| `RulSdePf.tsx` | SDE + 粒子滤波剩余寿命 |
| `SelfEvolutionLoop.tsx` | 自进化闭环可视化 |

**`src/pages/` 页面（对应路由）：**

| 目录 | 路由 | 说明 |
|---|---|---|
| `features/factory/` | `/dashboard` | 工厂工作台：可点击状态筛选、设备导航、中心场景、实时监测、当前设备、事件与报告、原位展开层 |
| `features/factory/panels/` | `/dashboard?panel=...` | 设备分析（7 Tab）、诊断、事件处置、报告；共用真实 event/device 数据 |
| `features/tools/` | `/tools`、`/tools/{simulation,vision,pico,evaluation,settings}` | 仿真、缺陷检测、数字伴侣、系统自评、界面偏好 |
| `features/about/` | `/about`、`/about/research/:topic/:point` | 研究目录与真实数据文章（数据/信号、诊断、健康、机理、成果） |
| `features/admin/` | `/admin/users`、`/admin/devices`、`/admin/records` | 权限受控的后台管理 |
| `features/pico/` | 全局 Dock + `/tools/pico` | 单一 Provider 的只读助手、连续形变、自动朗读、3D 表情 |
| `motion/` | 全局 | 运动令牌、登录 A/B 时间线、FlipValue、内容过渡 |
| `pages/Login/` | `/login` | 登录；A 红色揭幕、B 面板缩圆与纸层跟随 |
| `pages/Timeline/` | 嵌入事件工作区 | 事件传感器/审计时间线组件 |
| `pages/SystemEval/` | `/tools/evaluation` | 系统自评组件 |
| `pages/ThresholdSuggestions/` | 设备分析“阈值建议”Tab | 按设备阈值建议（管理员审批） |
| `pages/FaultInjection/` | `/tools/simulation` | 管理员仿真状态工具 |

V2.2 保留旧地址兼容：`/devices`、`/device/:id`、`/diagnose`、`/events`、`/reports`、`/dashboard?view=*`、`/lab`、`/ops?tab=*` 均单向迁移到新工厂/工具/关于地址；`/dashboard` 的设备、事件、状态筛选、面板、详情 Tab、分页与通道仍是同一看板的内部状态。

工厂使用 `/dashboard?device=...&event=...&status=...&panel=...&detail=...` 的单一状态；后退/前进走浏览器历史，“上一级”按信息层级返回（工厂展开层 → 工厂，工具子页 → 工具，研究文章 → 研究方向 → 研究目录）。旧 `/diagnose?tab=timeline` / `trajectory` / `report` 链接兼容迁移到事件或报告面板。

实时推送复用 `/api/v1/mqtt-pipeline/ws`，开发代理启用 WebSocket；断线时每 5 秒读取采样窗口。超过 15 秒的采样标记过期，缺少有效时间或数值的窗口不能发起诊断。数据来源、时效与回答方式保留在必要的详情/消息“详情”中，主界面不重复堆叠来源标签。数字场景是设备目录分组示意，不代表工厂平面或物理连接。研究图表与实时监测分开，且只渲染后端已提供的数据。

人工确认与下发指令是两次独立操作。当前后端尚未提供指令回执查询接口，页面不会把下发成功或观察期解释为设备执行成功或故障恢复。

前端检查：在 `frontend/` 运行 `npm run test`、`npm run typecheck`、`npm run build`。采样契约测试使用 Node 内置测试运行器与已有 TypeScript 依赖，不需要额外测试库。

### 3.3 `simulators/` —— 虚拟设备模拟器

| 文件 | 作用 |
|---|---|
| `virtual_device.py` | ★核心★：耦合 SDE 退化模型，6 台异构设备，输出观测值（可选 MQTT 上报） |
| `edge_inference.py` | 模拟边缘端推理 |
| `local_broker.py` | 本地轻量 Broker（无 Mosquitto 时可用） |
| `Dockerfile` | 模拟器镜像 |

### 3.4 `datasets/` —— 数据集（8 个，未随仓库分发）

| 目录 | 用途 |
|---|---|
| `CWRU/` | 凯斯西储大学轴承数据集（故障分类/特征频率） |
| `XJTU-SY_Bearing_Datasets/` | 西安交大轴承全寿命数据集（RUL 退化） |
| `NEU-DET/` | 东北大学热轧带钢表面缺陷（视觉检测 6 类） |
| `工业蒸汽量预测/` | 回归任务（多模型对比） |
| `机器故障数据集/` | 通用机器故障 |
| `工业制造缺陷预测数据集/` | 制造缺陷预测 |
| `SmartFactory/` | 产线级多机组异常 |
| `DigitalTwin/` | 数字孪生仿真数据 |

> 数据体量较大，本仓库不包含原始数据集目录。可视化用的预计算结果在 `backend/app/data/*.json`。

### 3.5 `models/` —— 模型权重（未随仓库分发）

| 文件 | 说明 |
|---|---|
| `cnn_bearing.pt` | 1D-CNN 轴承故障分类模型 |
| `pinn_baseline.pt` | PINN 物理正则自编码器基线 |

### 3.6 `scripts/` —— 脚本（分析 / 训练 / 启动）

| 脚本 | 作用 |
|---|---|
| `start_all.bat` / `start_all.sh` | ★一键启动后端+前端★（Windows/Linux） |
| `start_mysql.bat` | 启动 MySQL（若用 MySQL 数据库） |
| `demo_e2e.py` | 端到端演示闭环（无 Broker 时的替代路径） |
| `seed_demo_data.py` | 写入演示数据 |
| `download_cwru.py` / `prepare_cwru.py` / `analyze_cwru.py` | CWRU 下载/预处理/分析 |
| `analyze_pump.py` / `analyze_xjtu.py` / `analyze_steam.py` / `analyze_smartfactory.py` | 各数据集分析（产出 `app/data/*.json`） |
| `ml_classification.py` / `ml_rul.py` / `ml_steam.py` | 机器学习实验脚本 |
| `train_neu_det.py` / `finish_rtdetr.py` | NEU-DET 视觉模型训练 |
| `generate_dataset_registry.py` | 生成数据集登记 JSON |
| `calibrate_health.py` | 健康评分标定 |
| `data_leakage_check.py` | 数据泄漏检查（严谨性） |
| `test_detect_e2e.py` | 视觉检测端到端测试 |

### 3.7 `tools/` —— 工具与开发脚本（非运行时依赖）

| 文件 | 作用 |
|---|---|
| `docker-cleanup-admin.bat` | Docker 清理辅助脚本 |
| `dev-scripts/` | 开发期一次性脚本（验收、数据集 profiling、e2e 冒烟等），**不影响系统运行，可忽略/清理** |

### 3.8 `data/` —— 运行时数据

| 内容 | 说明 |
|---|---|
| `industrial_diagnosis.db` | SQLite 数据库（若用 SQLite 模式） |
| `neu_det_export/` | 视觉检测导出：曲线、样例图、模型权重、`comparison.json` |

---

## 4. 如何启动系统

### 4.1 方式一：Docker Compose（推荐，最省事）

**要求**：安装 Docker Desktop。

```bash
# 在仓库根目录执行
# 如需大模型解读，先设置 Key（否则可用 Mock）
export DEEPSEEK_API_KEY=你的key        # Windows PowerShell: $env:DEEPSEEK_API_KEY="你的key"
docker compose up --build
```

启动后：

| 服务 | 地址 |
|---|---|
| 前端 | http://localhost |
| 后端 API 文档 | http://localhost:8000/docs |
| MQTT | localhost:1883（WebSocket 9001） |

> Compose 中后端数据库固定为容器内 SQLite（`sqlite:////app/data/industrial_diagnosis.db`），挂载 `./backend/data`。

### 4.2 方式二：本地手动启动（开发调试）

**环境要求**：
- Python 3.10+（仓库已带 `.venv`，推荐直接用）
- Node.js 18+（前端）
- Eclipse Mosquitto（可选，实时数据管道需要；`tools/mosquitto-install.exe` 可装）

**① 启动后端**

```bash
cd backend
# 直接用仓库自带虚拟环境（Windows）
..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
# 或 Linux/macOS
../.venv/bin/python -m uvicorn app.main:app --port 8000
```

首次启动会自动建表，并写入 **6 台种子设备** 与 **默认管理员**（见 4.4）。

**② 启动前端**

```bash
cd frontend
npm install     # 首次
npm run dev     # http://localhost:5173
```

**③ （可选）启动 MQTT Broker 与模拟器**

```bash
# 启动 broker（已装 Mosquitto 时）
mosquitto -c mqtt/mosquitto.conf
# 启动虚拟设备上报
python simulators/virtual_device.py
```

> 也可直接运行 `scripts/start_all.bat`（Windows）或 `scripts/start_all.sh`（Linux/macOS）一键拉起后端+前端。

**④ 一键启动（Windows，本机已跑通）**

仓库根目录的 `start-local.bat`（已修复 npm 路径空格与 Vite IPv4 监听问题）会依次拉起 MySQL → 后端（:8000）→ 前端（:5173），并自动打开浏览器：

```bat
start-local.bat
```

> 脚本实际做三件事：启动 MySQL（`D:\MySQL\bin\mysqld.exe`，写死路径）→ 后端用**仓库自带虚拟环境** `..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` → 前端 `npm run dev`。换机器时主要改 MySQL 路径与 Python 解释器路径两处；Node 走系统 PATH 里的 `npm`。
>
> 会弹出 **MySQL / 后端 / 前端三个命令行窗口，请勿关闭**；关掉它们即停止系统。

> **本机已验证环境（2026-10-09 跑通）**：Windows + MySQL 便携版 `D:\MySQL`（root/123456，库 `industrial_diagnosis`） + Python 3.11.9 + Node 22.22.2；`.venv` 与 `frontend/node_modules` 均已装好。双击 `start-local.bat` 后访问 http://localhost:5173 ，账号 `admin/admin123`。
>
> ⚠️ **数据库路径坑**：整理文件夹时数据库从 `backend/data/` 挪到了仓库根 `data/`，`.env` 里若写 **相对路径** `sqlite:///./data/...` 会报 `unable to open database file`。现用 MySQL（`mysql+pymysql://root:123456@127.0.0.1:3306/industrial_diagnosis?charset=utf8mb4`）；若改用 SQLite，必须写**绝对路径**。

### 4.3 无 Broker / 无大模型时的降级路径

- **无 MQTT**：前端实时曲线无数据，但仍可在「AI 诊断」页**手动发起会诊**，或运行 `python scripts/demo_e2e.py` 演示完整闭环。
- **无 DeepSeek Key**：在 `backend/.env` 设 `DEEPSEEK_MOCK=true`，会诊走本地模拟话术，不影响流程演示。

### 4.4 默认账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 管理员 |

> 由 `backend/app/main.py` 的 `_seed_admin()` 在首次启动时写入。

---

## 5. 关键配置说明

配置优先级：**环境变量 > `backend/.env` > `config.py` 默认值**。

`backend/.env` 当前内容：

```ini
DEEPSEEK_API_KEY=sk-********          # 大模型 Key（仅用于报告解读）
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MOCK=true                    # true=离线模拟（当前默认），不调用真实大模型

# MySQL 数据库连接
DATABASE_URL=mysql+pymysql://root:123456@127.0.0.1:3306/industrial_diagnosis?charset=utf8mb4
SECRET_KEY=industrial-diagnosis-2026-secret-key-7f3a
```

**配置项对照 `backend/app/config.py`：**

| 配置 | 默认值 | 说明 |
|---|---|---|
| `database_url` | `sqlite:///./data/industrial_diagnosis.db` | 数据库；**`.env` 已覆盖为 MySQL** |
| `mqtt_host` / `mqtt_port` | `localhost` / `1883` | MQTT 地址 |
| `model_device` | `cpu` | 推理设备（cpu/cuda） |
| `deepseek_mock` | `false` | 是否离线模拟 |
| `secret_key` | 内置默认值 | JWT 签名密钥（**生产必须修改**） |
| `cors_origins` | `["http://localhost:5173"]` | 允许跨域来源 |

⚠️ **重点提醒**：`.env` 里 `DATABASE_URL` 指向 **MySQL**，若本机没有运行 MySQL，后端启动会连接失败。二选一：
1. 启动 MySQL 并建库 `industrial_diagnosis`（可执行 `scripts/start_mysql.bat`）；
2. 或把该行改成 SQLite：`DATABASE_URL=sqlite:///./data/industrial_diagnosis.db`。

---

## 6. 后端接口与模块速查

- 全部路由挂载于 `/api/v1`，交互式文档：**http://localhost:8000/docs**
- 根路径健康检查：`GET /`；健康探针：`GET /health`
- 核心数据出口：
  - 可视化数据：`/api/v1/viz/*`（前端所有图表数据来源）
  - 多智能体会诊：`/api/v1/multi-agent/*`（直接会诊）、`/api/v1/command-loop/events`（事件驱动会诊，含状态机）
  - 实时窗口：`/api/v1/mqtt-pipeline/window/{id}`
  - 设备与历史：`/api/v1/devices`、`/api/v1/devices/{id}/health-history`
  - 报告 / 时间线 / 阈值：`/api/v1/report/*`、`/api/v1/timeline/*`、`/api/v1/threshold/*`

> 前端调用全部集中在 `frontend/src/services/api.ts`，需要联调时从这里找端点。

---

## 7. 数据流（一次诊断是怎么走完的）

1. **模拟器**按 SDE 演化设备隐状态 → 生成观测值 → （可选）MQTT 上报。
2. **后端 mqtt_pipeline** 订阅数据 → 经 WebSocket 推给前端实时曲线。
3. 触发诊断 → **anomaly_detect** 计算（CNN 分类 + PINN 残差 + 健康评分）。
4. **multi_agent** 编排多智能体（信号/物理/知识/分类/主席）并行会诊，交叉验证。
5. **llm_client** 调用 DeepSeek，把硬指标转述为自然语言报告；失败自动降级为本地模板文案，不阻塞会诊。
6. **report** 生成报告，**records** 落库，前端在「报告中心/时间线」展示。
7. **人工决策（人在回路）**：值班人在「AI 诊断」报告卡上作出三种选择之一——
   - **确认执行** → `confirmEvent` + `executeEvent`，按报告建议下发指令（回显指令编号，如 `cmd-compressor-001-1`），事件进入处置中 → 观察期；
   - **修改建议** → `POST /command-loop/events/{id}/revise`，改写故障结论/维护建议并留审计痕（**不推进状态机**），报告卡打「已人工修订」标签；
   - **拒绝** → 必填理由后 `rejectEvent`，事件退回告警态。
8. **command_loop** 采集反馈、跟踪准确率、给出阈值自适应建议，形成闭环。

> 状态机：`alarm`（告警）→ `consulting`（会诊中）→ `pending`（待人工确认）→ `handling`（处置中）→ `observing`（观察期）→ `resolved`（已恢复）/ `rejected`（已驳回）。每一次人工动作都写入 `EventTimeline`（谁、什么时候、为什么、状态从哪到哪），可全程追溯。

---

## 8. 常见问题（FAQ）

| 现象 | 排查 |
|---|---|
| 后端启动即报数据库连接错误 | `.env` 的 `DATABASE_URL` 指向 MySQL 但未启动 → 见第 5 节 |
| 前端页面空白 / 401 跳登录 | token 失效，重新登录（`admin/admin123`）；确认后端已启动 |
| 图表无数据 | 后端未启动，或 `/api/v1/viz/*` 返回异常；可视化静态 JSON 在 `backend/app/data/` |
| 实时曲线不动 | 未启动 MQTT broker 或模拟器；可先看 4.3 降级路径 |
| 会诊没有 AI 回复 | DeepSeek Key 无效/欠费/401 → 设 `DEEPSEEK_MOCK=true` 离线演示 |
| 会诊超时卡死（30s+） | `DEEPSEEK_MOCK=false` 但 API Key 不可用，LLM 调用每次超时 20s × 多次 → 改成 `DEEPSEEK_MOCK=true` 并重启后端 |
| 图表看不懂 / 不知道数据哪来的 | 每张图右上角都有「说明」按钮（`ChartNote`），点开有「图表说明 / 数据来源 / 如何解读」三栏 |
| 时间线传感器曲线横轴看不清 | 横轴是采样点（非绝对时间）；用卡片上的**通道下拉**切换「单通道（带单位）」或「全部通道叠加」，叠加时各通道独立配色 |
| 会诊报告点「确认执行」没反应 | 先等状态走到 `pending`（待确认）；确认后会立即下发指令，报告卡显示指令编号 |
| `unable to open database file` | `.env` 里 SQLite 写了相对路径 → 改成绝对路径，或换 MySQL 并确保 `D:\MySQL` 已启动 |
| Docker 构建慢 | 首次拉取 torch 等大依赖属正常；后续有缓存 |
| 中文路径乱码（Windows 脚本） | 用系统默认 shell 运行 `.bat`；`.ps1` 需存为 UTF-8 with BOM |

---

## 9. 注意事项 / 技术要点

1. **诚实标注数据来源**：系统同时使用 **真实公开数据集**（CWRU/XJTU-SY/NEU-DET/蒸汽量等）与 **物理仿真数据**（数字孪生 SDE / SmartFactory / DigitalTwin）。对外介绍时务必区分，切勿把仿真结果表述为实测数据。
2. **大模型只在解读环节**：修改 `multi_agent/llm_client.py` 时不要让它参与数值计算，这是系统的核心设计约束。
3. **`.env` 含真实密钥**：`DEEPSEEK_API_KEY` 与 `SECRET_KEY` 属敏感信息，**不要提交到公开仓库**，生产环境务必更换 `SECRET_KEY`。
4. **模型权重**：`models/*.pt` 与 `backend/app/modules/vision/weights/`、`data/neu_det_export/weights/` 分别服务于轴承诊断与视觉检测，缺一不可。
5. **可视化数据是预生成的**：`backend/app/data/*.json` 由 `scripts/analyze_*.py` / `ml_*.py` 离线产出；改数据需重跑脚本，而不是改接口。
6. **前端接口集中管理**：新增接口请改 `frontend/src/services/api.ts`，不要在页面里硬编码 URL。
7. **`tools/dev-scripts/` 为一次性开发脚本**，与系统运行无关，可按需清理。
8. **端口占用**：后端 8000、前端 5173（dev）/80（prod）、MQTT 1883 与 9001，冲突时自行调整。
9. **人机闭环的三条分支语义不同**（详见第 7 节）：`confirm+execute` 推进状态机并下发指令；`revise` **只改写报告内容、刻意不推进状态机**（避免"改个错别字就把事件推进下一步"），另写一条 `EventTimeline` 留痕；`reject` 必填理由后退回告警态。改动这三处逻辑时请保持该语义。
10. **新增图表必须带说明**：统一复用 `components/ChartNote.tsx` 的 `desc / dataSource / insight` 三字段；ECharts 的 `xAxis/yAxis` 要显式写 `axisLabel / axisLine / axisTick / splitLine`，`grid.bottom` 留 60+ 像素给轴名，否则坐标轴会被挤掉不出显示（参考 `pages/Timeline/index.tsx` 的 `axisCommon()`）。
11. **本机启动优先用 `start-local.bat`**：它会依次拉起 MySQL → 后端 → 前端并自动开浏览器；换机器只需改脚本顶部三个路径变量（Python / Node / MySQL）。脚本已针对 `npm.cmd` 路径含空格、项目根路径含中文两处做了兼容性修复（`start /d` 避免引号嵌套、Vite 加 `host: '0.0.0.0'` 同时监听 IPv4/IPv6）。
12. **会诊接口走 `/command-loop/events` 而非 `/multi-agent/consult`**：前端工厂原位诊断面板（`features/factory/panels/DiagnosisPanel.tsx`）先 `createEvent` 建事件，再由后端 command_loop 内部调 consult 并推进状态机；直接调 `/multi-agent/consult` 只跑会诊不走状态机。

---

## 10. 快速自查清单

- [ ] 后端能启动，`http://localhost:8000/health` 返回 `{"status":"ok"}`
- [ ] 前端能打开并用 `admin/admin123` 登录
- [ ] 大屏有设备数据（种子设备 + 图表）
- [ ] 「AI 诊断」能发起一次会诊并出报告（Mock 或真实 Key 均可）
- [ ] 会诊报告的「确认执行 / 修改建议 / 拒绝」三个按钮都能走通，状态机能推进到「观察期」并回显指令编号
- [ ] 「事件时间线」传感器曲线横轴刻度可见，通道下拉可切换，三张卡的「说明」能点开
- [ ] 关于研究目录与真实数据图表正常渲染
- [ ] 工厂中心场景、原位诊断/事件/报告与 Pico 连续形变正常
- [ ] （如需实时）MQTT broker 与模拟器已启动

---

*本 README 内容全部核对自项目源码（`backend/app/main.py`、`config.py`、`docker-compose.yml`、`frontend/src/App.tsx`、`services/api.ts`、各页面与组件）与运行配置，力求与代码一致。如与运行环境不符，以实际代码为准。*

**文档最后更新：2026-10-20**（V2.2 四域工作空间、Pico 连续交互与登录 A/B 动效已落地；目录结构与实际代码对齐）。

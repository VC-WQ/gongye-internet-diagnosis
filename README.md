# 工业设备智能诊断平台

面向泵、电机和空压机的设备监测、诊断、事件记录与研究展示平台。前端使用 React、TypeScript、Ant Design、ECharts 和 Three.js；后端使用 FastAPI、SQLAlchemy、MQTT 与已有模型推理模块。Pico 通过受约束的只读工具和页面动作使用平台上下文，不直接控制工业设备。

当前交付分支为 `frontend-agent`。`main` 保留原有协作状态；已有 HarmonyOS 开放 PR 的独有后端工作仍在其原分支，未混入本分支。

## 页面与能力

- **工厂 `/dashboard`**：设备目录、状态筛选、传感器窗口、当前设备和最近事件。SVG 2.5D 工厂布局叠加独立 Three.js 设备模型；这是设备三维示意，不是整厂三维数字孪生。选择、镜头聚焦和模型生长共享视觉进度，支持取消、反向、快速切换、旋转、缩放和减少动画。
- **设备 `/manage/devices/:deviceId`**：共享设备详情，包括实时、历史、特征、声学、PHM、事件和阈值等现有标签。**记录 `/manage/records`** 支持设备筛选，`/manage/records/:eventId` 查看落库事件。
- **工具 `/tools`**：诊断、事件与报告、仿真、视觉检测、Pico、系统评估和界面偏好。设备诊断准备使用 `/tools/diagnosis?device=...`，不自动提交。
- **管理 `/admin`**：设备、账户及记录的既有授权流程。普通用户可读共享详情，管理员才可使用受保护的维护入口。
- **研究 `/research`**：固定舞台与完整详情。既有主题、研究点、旧路由和 URL 场景身份保留；图表来自后端登记的研究 JSON/API，缺失数据明确显示，不补造指标。

设备名称、图标和涂层偏好只影响本机展示，按已验证账户与设备隔离；不改写设备 DTO、状态色或目录数据。Pico 对话、角色、语音和上下文共享同一 Provider。

## 本地启动

要求：Node.js 20.19+、Python 3.10/3.11、npm。完整后端依赖包含 PyTorch，首次安装需要较多时间和磁盘空间。MQTT 仅在采集或仿真上报时需要；没有 Broker 时平台仍可启动，并明确显示没有采样。

在仓库根目录创建独立虚拟环境：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

编辑本地 `backend/.env`，为新数据库配置自己的 `BOOTSTRAP_ADMIN_PASSWORD`。开发模式空库仍兼容既有演示初始化，生产模式不创建隐式演示管理员。初始化设置不重置已有账户；已有数据库请使用原账户和正常账户管理流程。

启动后端，工作目录必须是 `backend/`：

```sh
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开终端启动前端：

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

访问 `http://127.0.0.1:5173`；后端状态为 `http://127.0.0.1:8000/health`，接口文档为 `/docs`。前端默认代理到 `http://localhost:8000`，如需其他本地端口，可在启动命令前设置 `VITE_API_PROXY=http://127.0.0.1:<port>`。前端环境变量中不得放 API Key、JWT 密钥或其他秘密。

`npm run build` 生成静态资源，`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` 用于本地预览构建。Preview 不是生产部署服务；正式部署使用下述 Nginx/Compose 配置。

## MQTT 与仿真

`simulators/virtual_device.py` 提供已有异构设备物理仿真；`edge_inference.py` 可连接 MQTT。仿真只在明确启动后运行：

```sh
.venv/bin/python simulators/edge_inference.py --use-mqtt --host 127.0.0.1 --port 1883
```

连接 Broker 前核对 `backend/.env` 中的 MQTT 地址、主题和设备身份。真实设备控制、事件确认、阈值修改等继续使用原有权限与确认流程。不要对生产 Broker 运行演示闭环或故障注入脚本。

## Pico Agent 契约

Pico 支持当前设备/事件问答、目录排序、设备和事件比较、落库健康评分历史、排名设备的最近事件、报告摘要与研究证据检索。历史趋势只使用现存诊断记录；目录评分、当前采样、落库诊断和研究实验分开解释，并保留时间、来源与缺失状态。

每次请求最多 **5 个只读工具调用**，不接受任意 SQL、Shell、文件路径、JavaScript 或 URL。前端最多执行 **3 个白名单动作**，整组预校验后严格顺序执行；每步重新验证账户、实体和上下文。外部导航、设备切换、退出或取消会终止旧序列，已完成、失败和未执行步骤分别反馈。

可执行的页面动作包括站内导航、真实设备/事件/报告/研究入口、现有详情标签、记录设备筛选、诊断准备及深浅主题。管理员表单仅预填明确字段，**不自动保存或提交**。Pico 不执行删除、事件处置、阈值修改或工业控制。

后端复用 `multi_agent/llm_client.py` 的 DeepSeek 兼容客户端。设置后端的 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 即可接入；`DEEPSEEK_MOCK` 只用于测试。缺少凭据、超时、Schema 错误或不可靠回答时走明确降级；Mock/模板回复不代表真实模型验收。在线模型验证取决于部署环境提供有效凭据。

## 生产配置

根目录 `.env.example` 用于 Compose，与 `backend/.env.example` 的开发用途不同：

```sh
cp .env.example .env
```

在本地秘密文件中填入独立生成的高强度 `SECRET_KEY`（至少 32 字符）和初次管理员口令（至少 12 字符）。可以用 `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'` 在自己的终端生成密钥；不要将输出提交、粘贴进报告或放入前端。

```sh
docker compose config --quiet
docker compose up -d --build backend frontend mqtt
```

Compose 默认 `RUNTIME_ENVIRONMENT=production`、`SEED_DEMO_DEVICES=false`。缺少显式强 JWT 密钥时配置/启动失败；未设置初始化管理员口令时不创建管理员。已有数据库中的账户不会被自动更改，部署前需审查原账户。需要模拟器时，再明确启动 `docker compose up -d simulator`；演示目录只应在隔离演示环境显式启用。

开发环境未设置 JWT 密钥时，每个后端进程使用随机密钥，重启需要重新登录；多进程或持久会话必须配置同一个私有密钥。生产环境还需按部署环境配置 HTTPS、访问边界、MQTT 凭据、数据库备份和 CORS。Nginx 为 SPA 提供路由回退，并转发 API/WebSocket；不要把 Vite 开发服务暴露为生产入口。

## 数据、权重与研究来源

- `backend/app/data/`：研究 API 使用的已登记 JSON，包含信号、分类、寿命、物理孪生、跨域与融合实验；来源、单位、负值和缺失状态由业务契约保留。
- `backend/app/modules/vision/comparison.json` 与 `data/neu_det_export/`：已有视觉对照及导出图。它们是研究资产，不是可随意删除的临时日志。
- `backend/data/`：本地运行数据库，默认 SQLite，已排除 Git；数据库可通过 `DATABASE_URL` 切换。
- `datasets/`、`models/`：本地数据集与权重，不随源码提交。模型缺失时保留现有不可用/降级反馈；静态研究指标不等于本机完成了真实模型推理。
- `scripts/`：研究复现、数据整理、诊断与启动脚本。研究脚本可能需要独立数据集、额外训练依赖或外部计算环境，不能把脚本存在当作本机已复现。

研究展示不能证明现场泛化、因果关系或部署适用性；仿真、离线实验和现场数据必须分别标注。

## 测试与维护

```sh
cd frontend
npm test
npm run typecheck
npm run build
```

后端测试依赖为开发工具，不在生产安装清单中：

```sh
.venv/bin/python -m pip install pytest httpx
cd backend
../.venv/bin/python -m pytest -q
```

后端 `tests/conftest.py` 使用独立临时 SQLite 与 Mock 模型配置，避免污染开发数据库；不要绕过该隔离去运行生产控制。

可维护的实现说明位于 `frontend/docs/`：`CONTENT_MOTION.md` 说明单实例交接和冻结展示 DTO；`LOGIN_DEVICE_GROWTH.md` 说明登录、SVG/Three 桥接、聚焦协调与外观偏好；研究舞台和性能边界分别在 `STAGE_MOTION.md`、`VISUAL_CORRECTIONS.md`、`VISUAL_PERFORMANCE_V2_6.md`。

审计、施工快照、录屏、截图、性能原始数据、移动清单和分支归档统一存放在仓库外的 `gongye-internet-diagnosis-artifacts/`。它们不属于运行依赖，不复制进源码。维护时先检查 Git worktree、开放 PR、未提交修改和 `.env`，不要重置或清空他人工作区。

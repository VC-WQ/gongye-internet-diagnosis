# 工业设备智能诊断平台

面向泵、电机和空压机的设备监测、诊断、事件记录与研究展示平台。前端使用 React、TypeScript、Ant Design、ECharts 和 Three.js；后端使用 FastAPI、SQLAlchemy、MQTT 与已有模型推理模块。Pico 通过受约束的只读工具和页面动作使用平台上下文，不直接控制工业设备。

当前交付分支为 `frontend-agent`。`main` 保留原有协作状态；已有 HarmonyOS 开放 PR 的独有后端工作仍在其原分支，未混入本分支。

V2.7 增加精简语义页面快照和有界任务循环：Pico 每次执行一个步骤，取得真实业务结果或页面反馈后再规划。状态筛选统一清理旧设备上下文，三维退出保留到相机复位完成。任务接口、预算、取消、部署边界和复验方法见 [Pico 任务协议](frontend/docs/PICO_TASKS.md)。未配置真实模型时会明确显示 `UNVERIFIED`，并保留有限的原有查询与页面操作能力。

## AI+鸿蒙 端-云-智 三层落地

对应"AI+鸿蒙"多技术融合创新大赛的架构底线，本仓库已贯通完整链路：

- **端（感知与交互）**：React Web 前端（`frontend/`）+ **HarmonyOS ArkTS/ArkUI 应用端**（`harmony/`，运行说明见其内 README），访问同一套后端 API 与数据库。
- **云（业务中枢）**：FastAPI + SQLAlchemy + SQLite 真实数据库持久化设备/事件/诊断/指令记录；MQTT 接入仿真或真实设备上报。
- **智（AI 大脑）**：
  - **真实接入大模型**：`backend/app/modules/multi_agent/llm_client.py` 对接 DeepSeek（OpenAI 兼容），多智能体会诊的物理残差解读/诊断摘要/维护建议由真实模型生成，凭据缺失或超时才降级到模板。
  - **RAG 知识库（高分项）**：`backend/app/modules/multi_agent/rag_store.py` 基于 Chroma 向量检索，`backend/scripts/build_rag_index.py` 离线构建索引，为诊断提供业务知识增强。
  - **AI Agent 指令闭环（高分项）**：维护指令经 MQTT 下发到设备（`device/{device_id}/command`），仿真器执行并回执，后端 `mqtt_pipeline` 写回指令状态并留痕事件时间线，形成"故障→会诊→确认→指令→执行回执→恢复观察"闭环；端到端演示脚本见 `scripts/demo_agent_loop.py`。

## 页面与能力

- **工厂 `/dashboard`**：设备目录、状态筛选、传感器窗口、当前设备和最近事件。SVG 2.5D 工厂布局叠加独立 Three.js 设备模型；这是设备三维示意，不是整厂三维数字孪生。选择、镜头聚焦和模型生长共享视觉进度，支持取消、反向、快速切换、旋转、缩放和减少动画。
- **设备 `/manage/devices/:deviceId`**：共享设备详情，包括实时、历史、特征、声学、PHM、事件和阈值等现有标签。**记录 `/manage/records`** 支持设备筛选，`/manage/records/:eventId` 查看落库事件。
- **工具 `/tools`**：诊断、事件与报告、仿真、视觉检测、Pico、系统评估和界面偏好。设备诊断准备使用 `/tools/diagnosis?device=...`，不自动提交。
- **管理 `/admin`**：设备、账户及记录的既有授权流程。普通用户可读共享详情，管理员才可使用受保护的维护入口。
- **研究 `/research`**：固定舞台与完整详情。既有主题、研究点、旧路由和 URL 场景身份保留；图表来自后端登记的研究 JSON/API，缺失数据明确显示，不补造指标。

设备名称、图标和涂层偏好只影响本机展示，按已验证账户与设备隔离；不改写设备 DTO、状态色或目录数据。Pico 对话、角色、语音和上下文共享同一 Provider。

## 本地启动

要求：Node.js 20.19+、Python 3.10/3.11、npm。完整后端依赖包含 PyTorch，首次安装需要较多时间和磁盘空间。MQTT 仅在采集或仿真上报时需要；没有 Broker 时平台仍可启动，并明确显示没有采样。

> 获取代码：本仓库默认分支为 `main`，当前交付分支为 `frontend-agent`。
>
> ```sh
> git clone https://github.com/VC-WQ/gongye-internet-diagnosis.git
> cd gongye-internet-diagnosis
> git checkout frontend-agent
> ```

**Windows 一键安装 / 启动**（在仓库根目录，用 PowerShell 执行；需要本地已装 Python 3.10/3.11 与 Node.js 20.19+）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_windows.ps1
# 编辑 backend/.env，填入你自己的 DEEPSEEK_API_KEY 与 BOOTSTRAP_ADMIN_PASSWORD
powershell -ExecutionPolicy Bypass -File scripts/start_windows.ps1
```

`setup_windows.ps1` 会创建 `.venv`、安装后端依赖（默认阿里云镜像）、`npm ci` 安装前端依赖、校验 CNN 权重、必要时重建 RAG 索引、按 template 生成 `backend/.env`（不覆盖已存在配置）。手动安装则按以下步骤：

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
- `datasets/`：本地训练数据（`processed.npz`、`CWRU12Ingested.npz` 等），**不随源码提交**；正式推理不依赖它们。`models/cnn_bearing.pt`（已训练权重）与 `data/chroma/`（RAG 索引）已随源码提交，克隆即得。
- `scripts/`：研究复现、数据整理、诊断与启动脚本。研究脚本可能需要独立数据集、额外训练依赖或外部计算环境，不能把脚本存在当作本机已复现。

研究展示不能证明现场泛化、因果关系或部署适用性；仿真、离线实验和现场数据必须分别标注。

### 模型权重、RAG 索引与数据复现（交付/干净环境）

- **1D-CNN 权重** `models/cnn_bearing.pt`：正式推理入口 `backend/app/modules/anomaly_detect/cnn_classifier.py` 的 `FaultClassifier.ensure_weights()` 从该路径懒加载权重执行 4 类故障分类。该权重由 `backend/app/modules/anomaly_detect/train_cnn.py` 在真实 CWRU 数据上训练生成（输入窗口 `(1, 2048)`），**已随源码提交（`.gitignore` 中 `models/*.pt` 已对 `models/cnn_bearing.pt` 白名单放行）**，普通 `git clone` 即可获得。权重缺失时 `classify()` 明确返回 `cnn_source=model_unavailable`（模型不可用降级），不会伪造诊断结果。
- **RAG 向量索引** `data/chroma/`：**已随源码提交**（持久化路径 `PERSIST_DIR` 由源码运行时按仓库相对位置计算，不含开发机绝对路径，克隆即用）。也可随时用 `cd backend && python scripts/build_rag_index.py` 从 `backend/app/modules/multi_agent/knowledge_base/cwru_fault_modes.md` 重新生成。注意：chromadb 默认使用内置 ONNX embedding（`all-MiniLM-L6-v2`），**首次检索时会从网络下载模型到 `~/.cache/chroma/`**，目标环境需联网或提前缓存；如需中文语义增强，安装 `sentence-transformers` 并设置 `KB_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`。索引缺失时 `RagUnavailableError` 会触发关键词检索降级，前端显示降级状态而非伪装成功。
- **CWRU 数据** `datasets/CWRU/`：`processed.npz`（`X(11754,1,2048)`、`Y`、`file_ids`，训练/评估直接使用，按物理文件分层切分防止数据泄漏）与 `CWRU12Ingested.npz`（切片前打包）。原始 `.mat` 需从 CWRU 官方轴承数据中心手动下载 12kHz 驱动端(DE)数据。`scripts/download_cwru.py`、`scripts/prepare_cwru.py` 依赖非公开的外部 `cwru` 包（download/ingest/load）与原始数据，**仅是数据复现脚本，不是首次安装步骤**；缺少该包时会打印明确说明并退出，交付包已直接提供 `processed.npz`。
- **视觉检测**：`backend/app/modules/vision/` 提供 YOLOv8s / RT-DETR 推理代码、NEU-DET 训练指标 `comparison.json` 与样例图，但**权重文件 `vision/weights/*_best.pt` 未随包提供**，因此在线目标检测暂不可用；前端会如实显示「当前没有可用的检测模型」，样例图与对照指标为离线训练产物，不代表设备部件现场检测精度。

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

`scripts/ch2_verify.py` 和 `scripts/ch3_routes.py` 将生成报告写入仓库外的 `gongye-internet-diagnosis-artifacts/generated-research-reports/`，可用 `ICT_ARTIFACT_DIR` 指定其他目录。离线会诊辅助脚本 `tools/dev-scripts/e2e_acceptance.py` 接受 `--dataset` 和 `--output`；重新统计使用 `tools/dev-scripts/recompute_stats.py --input <外部记录路径>`。历史验收 JSON 和训练日志已归档，不再隐式读取某个开发者的 Windows 绝对路径。研究脚本的运行仍需要相应数据与权重。

审计、施工快照、录屏、截图、性能原始数据、移动清单和分支归档统一存放在仓库外的 `gongye-internet-diagnosis-artifacts/`。它们不属于运行依赖，不复制进源码。维护时先检查 Git worktree、开放 PR、未提交修改和 `.env`，不要重置或清空他人工作区。

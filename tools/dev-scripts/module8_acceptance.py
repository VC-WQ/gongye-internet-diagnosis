"""模块8 报告中心端到端验收。

覆盖：
  1. POST /reports/flash 返回快报文本（全设备 + 单设备两种）
  2. POST /reports/event/{id} 返回完整 10 部分 Markdown 报告
  3. 报告各部分数据均能从 Event 相关字段取到（含 agent_results / timeline / command / feedback）
  4. GET /reports/self-eval 复用模块7（/self-eval/metrics）

用 OR#234 告警样本跑一遍闭环后生成报告。

运行：cd backend && ..\\.venv\\Scripts\\python.exe ..\\tmp\\module8_acceptance.py
"""
import sys
from pathlib import Path

ROOT = Path(r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统')
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.models import Base, SessionLocal, engine
from app.modules.command_loop.feedback_loop import feedback_loop_service
from app.modules.command_loop.service import command_loop_service

NPZ = str(ROOT / 'datasets' / 'CWRU' / 'processed.npz')

# 报告 10 部分的标题（用于校验）
SECTION_HEADERS = [
    "## 1. 设备基本信息",
    "## 2. 异常事件概述",
    "## 3. 信号变化描述",
    "## 4. PINN 物理残差说明",
    "## 5. 模型判断结果与置信度",
    "## 6. 多Agent会诊结论",
    "## 7. 人工确认记录",
    "## 8. 控制指令与执行结果",
    "## 9. 反馈评估结果",
    "## 10. AI 维护建议",
]


def alarm_window(index: int = 234) -> list[dict]:
    """取 CWRU OR#234 告警样本构造传感器窗口。"""
    data = np.load(NPZ)
    x = data['X'][index].flatten().tolist()
    return [{"vibration": float(v)} for v in x]


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("#" * 80)
    print("流程1：创建 OR#234 事件并走完闭环（会诊->确认->执行->观察->恢复）")
    print("#" * 80)
    win = alarm_window(234)
    e = command_loop_service.create_event(db, "dev-OR-234", win, "system")
    eid = e['id']
    print(f"  创建事件 #{eid}，初始状态={e['status_state']}，故障={e['fault_type']}，置信={e['confidence']}")
    command_loop_service.confirm(db, eid, "张工")
    command_loop_service.execute(db, eid, "张工")
    r = feedback_loop_service.observe_and_evaluate(db, eid, [30, 45, 60, 75, 85], "张工")
    print(f"  观察评估 -> 状态={r['status_state']}，判定={r['feedback_result']['verdict']}，"
          f"偏差={r['feedback_result']['deviation_pct']}%")

    print("\n" + "#" * 80)
    print("流程2：POST /reports/flash（全设备 + 单设备）")
    print("#" * 80)
    client = TestClient(app)
    r_full = client.post("/api/v1/reports/flash", json={})
    r_one = client.post("/api/v1/reports/flash", json={"device_id": "dev-OR-234"})
    print(f"  全设备快报 -> {r_full.status_code}")
    print(f"    {r_full.json()['report']}")
    print(f"  单设备快报 -> {r_one.status_code}")
    print(f"    {r_one.json()['report']}")

    print("\n" + "#" * 80)
    print("流程3：POST /reports/event/{id} 生成完整 Markdown 报告")
    print("#" * 80)
    r_ev = client.post(f"/api/v1/reports/event/{eid}")
    print(f"  -> {r_ev.status_code}")
    markdown = r_ev.json()['report']
    print(markdown)

    print("\n" + "#" * 80)
    print("流程4：校验报告包含全部 10 部分")
    print("#" * 80)
    missing = [h for h in SECTION_HEADERS if h not in markdown]
    if missing:
        print(f"  [错误] 缺少章节：{missing}")
    else:
        print("  [通过] 10 个章节齐全")

    print("\n" + "#" * 80)
    print("流程5：GET /reports/self-eval 复用模块7")
    print("#" * 80)
    r_se = client.get("/api/v1/reports/self-eval")
    print(f"  -> {r_se.status_code}")
    for k, v in r_se.json().items():
        print(f"    {k}: {v}")

    db.close()
    print("\n验收完成。")


if __name__ == '__main__':
    main()
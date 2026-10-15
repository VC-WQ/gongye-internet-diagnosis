"""端到端演示脚本：走完整诊断闭环（会诊 → 确认 → 执行 → 报告 → 自评）。

前置：后端已启动（http://localhost:8000）。
运行（项目根目录）：
    .venv\\Scripts\\python.exe scripts\\demo_e2e.py
"""
from __future__ import annotations

import math
import random
import time

import requests

BASE = "http://localhost:8000/api/v1"


def log(step: str, msg: str, ok: bool = True) -> None:
    marker = "OK" if ok else "FAIL"
    print(f"[{time.strftime('%H:%M:%S')}] [{marker}] {step}: {msg}")


def demo_window(n: int = 64) -> list[dict]:
    """构造一段退化的振动窗口（幅值递增 + 噪声），触发异常会诊。"""
    return [
        {
            "vibration": round(
                0.3 + 0.2 * math.sin(i / 5) + (i / n) * 0.4 + random.random() * 0.1, 4
            )
        }
        for i in range(n)
    ]


def main() -> None:
    device_id = "pump-002"
    operator = "demo"

    # 1. 触发多智能体会诊（创建诊断事件）
    r = requests.post(
        f"{BASE}/command-loop/events",
        json={"device_id": device_id, "window": demo_window(), "operator": operator},
        timeout=120,
    )
    r.raise_for_status()
    event = r.json()
    event_id = event["id"]
    log(
        "多Agent会诊",
        f"事件 #{event_id} 故障={event.get('fault_type')} "
        f"置信度={event.get('confidence')} 健康分={event.get('health_score')}",
    )

    # 2. 打印各 Agent 结论
    agents = (event.get("agent_diagnosis") or {}).get("agent_results") or []
    for a in agents:
        log(f"  · {a.get('agent_name')}", str(a.get('conclusion'))[:60])

    # 3. 人工确认执行
    r = requests.post(
        f"{BASE}/command-loop/events/{event_id}/confirm",
        json={"operator": operator},
        timeout=30,
    )
    r.raise_for_status()
    log("人工确认", r.json().get("status_state", ""))

    # 4. 执行指令
    r = requests.post(
        f"{BASE}/command-loop/events/{event_id}/execute",
        json={"operator": operator},
        timeout=30,
    )
    r.raise_for_status()
    log("执行指令", r.json().get("event", {}).get("status_state", ""))

    # 5. 生成事件报告
    r = requests.post(f"{BASE}/reports/event/{event_id}", timeout=30)
    r.raise_for_status()
    markdown = r.json().get("report", "")
    log("生成报告", f"报告 {len(markdown)} 字符")

    # 6. 系统自评指标
    r = requests.get(f"{BASE}/self-eval/metrics", timeout=30)
    r.raise_for_status()
    m = r.json()
    log(
        "系统自评",
        f"准确率 {m.get('accuracy', 0)} 误报率 {m.get('false_alarm_rate', 0)} "
        f"漏报率 {m.get('miss_rate', 0)} 平均延迟 {m.get('avg_latency_seconds', 0)}s",
    )

    print("\n端到端演示完成 ✅  事件报告：")
    print(markdown[:1500])


if __name__ == "__main__":
    main()
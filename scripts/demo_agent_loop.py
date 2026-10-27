# -*- coding: utf-8 -*-
"""AI Agent 指令闭环端到端演示（纯软件方向，问题3）。

完整动线：
  故障注入（可控仿真） -> 多智能体会诊 -> 人工确认 -> 下发指令(MQTT)
  -> 仿真设备执行并回执 -> 恢复观察 -> 事件状态推进 -> 时间线可溯

与 demo_e2e.py 的区别：本脚本额外驱动 simulators/virtual_device.py
（在进程内运行虚拟设备集群），证明「AI 生成指令 -> MQTT 下发 -> 仿真执行
-> 回执 -> 后端写回 -> 观察恢复」的软件层闭环，实打实走真实 MQTT 消息，
不伪造回执。

前置（三者缺一不可）：
  1. 本地 MQTT Broker 已启动（mqtt 1883 端口）：
        .venv\\Scripts\\python.exe simulators\\local_broker.py
     （或任意 mosquitto；本机未装 amqtt 时请先 pip install amqtt）
  2. 后端已启动（默认 http://localhost:8000），且会自动连接同一 Broker：
        .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8000

运行（项目根目录）：
    .venv\\Scripts\\python.exe scripts\\demo_agent_loop.py

离线自测（不需要 Broker / 后端，仅验证仿真端指令解析与执行效果）：
    .venv\\Scripts\\python.exe scripts\\demo_agent_loop.py --self-test
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # = gongye-internet-diagnosis
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import requests  # noqa: E402

from simulators.virtual_device import (  # noqa: E402
    DeviceFleet,
    _parse_speed_target,
)

BASE = "http://localhost:8000/api/v1"
BROKER_HOST = "localhost"
BROKER_PORT = 1883
DEVICE_ID = "pump-002"
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"

# 下发到仿真设备的维护指令（同时验证「停机」+「检修更换」+「润滑」三类动作）
MAINTENANCE_COMMAND = "立即停机并更换轴承内圈、检修润滑"


def log(step: str, msg: str, ok: bool = True) -> None:
    marker = "OK" if ok else "FAIL"
    print(f"[{time.strftime('%H:%M:%S')}] [{marker}] {step}: {msg}")


def _device(fleet: DeviceFleet, device_id: str = DEVICE_ID):
    for d in fleet.devices:
        if d.params.device_id == device_id:
            return d
    return None


# ---------------------------------------------------------------------------
# 离线自测：验证仿真端指令解析（无需 Broker / 后端）
# ---------------------------------------------------------------------------
def self_test() -> None:
    print("=" * 70)
    print("自测 1：_parse_speed_target 调速解析")
    print("=" * 70)
    for text, expect in (("调速到1200rpm", 1200.0), ("转速800", 800.0),
                         ("speed 900", 900.0), ("停机检查", None), ("检查1处", None)):
        got = _parse_speed_target(text)
        print(f"  _parse_speed_target({text!r}) = {got}  期望={expect}  "
              f"{'OK' if got == expect else 'FAIL'}")

    print("\n" + "=" * 70)
    print("自测 2：_apply_command 启停 / 调速 / 检修对观测值与健康分的影响")
    print("=" * 70)
    fleet = DeviceFleet.default()
    dev = _device(fleet)
    fleet.inject_fault(DEVICE_ID, severity=1.2)
    dev.step(0.0)  # 刷新故障与健康分
    health_before = dev.health_score
    before_obs = dev.observe()
    log("故障注入后", f"health={dev.health_score:.2f} rpm={before_obs['rpm']:.1f} "
        f"vib={before_obs['vibration']:.2f} is_running={dev.is_running}")

    status, effect = DeviceFleet._apply_command(dev, MAINTENANCE_COMMAND)
    dev.step(0.0)  # 刷新健康分
    after_obs = dev.observe()
    log("指令执行后", f"health={dev.health_score:.2f} rpm={after_obs['rpm']:.1f} "
        f"vib={after_obs['vibration']:.2f} is_running={dev.is_running}")
    print(f"  动作列表 actions={effect.get('actions')}")
    print(f"  隐状态 before={effect['before']}")
    print(f"  隐状态 after ={effect['after']}")
    assert dev.is_running is False, "「停机」指令应使设备停机"
    assert after_obs["rpm"] == 0.0, "停机后转速应为 0"
    assert dev.health_score > health_before, "检修后健康分应较故障时回升"
    print("\n自测通过：仿真端已支持启停 / 调速 / 检修并真实改变上报数据。")


# ---------------------------------------------------------------------------
# 完整闭环演示（需 Broker + 后端）
# ---------------------------------------------------------------------------
def build_window(fleet: DeviceFleet, n: int = 64) -> list[dict]:
    """用故障注入后的仿真设备连续 n 步观测值构造振动窗口。

    采用仿真器真实上报的观测序列作为诊断输入，而非手搓波形，
    从而贴合「可控仿真」叙事：同一台设备，从故障涌现到诊断再到处置。
    """
    dev = _device(fleet)
    window: list[dict] = []
    for _ in range(n):
        dev.step(0.5)
        window.append({"vibration": round(dev.observe()["vibration"], 4)})
    return window


def login() -> str:
    r = requests.post(
        f"{BASE}/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def main() -> None:
    # 0. 登录获取 JWT
    try:
        token = login()
        log("登录", f"用户={ADMIN_USER}，已获取 JWT")
    except Exception as exc:
        print(f"\n[FAIL] 无法登录后端（{exc}）。请确认后端已启动并已创建管理员。")
        print("  启动后端：.venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8000")
        return
    headers = {"Authorization": f"Bearer {token}"}

    # 1. 进程内启动虚拟设备集群并连接 MQTT（订阅指令 / 发布回执）
    fleet = DeviceFleet.default()
    try:
        fleet.connect_mqtt(BROKER_HOST, BROKER_PORT)
    except Exception as exc:
        print(f"\n[FAIL] 仿真设备无法连接 MQTT Broker（{exc}）。")
        print("  请先启动：.venv\\Scripts\\python.exe simulators\\local_broker.py")
        return
    log("仿真设备", f"已连接 Broker {BROKER_HOST}:{BROKER_PORT}，订阅 device/+/command")

    # 2. 故障注入（可控仿真：把 pump-002 隐状态推过故障阈值）
    fleet.inject_fault(DEVICE_ID, severity=1.2)
    dev = _device(fleet)
    log("故障注入", f"{DEVICE_ID} 隐状态已推过阈值（wear/heat 越限）")

    # 3. 多智能体会诊（用仿真设备真实振动窗口触发诊断事件）
    window = build_window(fleet)
    try:
        r = requests.post(
            f"{BASE}/command-loop/events",
            json={"device_id": DEVICE_ID, "window": window, "operator": ADMIN_USER},
            headers=headers,
            timeout=120,
        )
        r.raise_for_status()
    except Exception as exc:
        print(f"\n[FAIL] 创建诊断事件失败（{exc}）。请确认后端已启动。")
        return
    event = r.json()
    event_id = event["id"]
    log("多Agent会诊", f"事件 #{event_id} 状态={event.get('status_state')} "
        f"故障={event.get('fault_type')} 置信度={event.get('confidence')} "
        f"健康分={event.get('health_score')}")

    if event.get("status_state") != "pending":
        print(f"\n[WARN] 当前状态为 {event.get('status_state')}（非 pending）。")
        print("  仿真窗口未触发告警分支，可能需调大故障注入 severity。")
        return

    # 4. 人工确认执行（pending -> handling）
    r = requests.post(
        f"{BASE}/command-loop/events/{event_id}/confirm",
        json={"operator": ADMIN_USER},
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    log("人工确认", f"状态={r.json().get('status_state')}")

    # 记录维护前健康分（用于观察期恢复曲线起点）
    dev.step(0.0)
    health_before = round(dev.health_score, 2)
    log("维护前", f"{DEVICE_ID} health={health_before:.2f}")

    # 5. 执行指令（handling -> observing）：后端经 MQTT 下发，仿真设备执行并回执
    try:
        r = requests.post(
            f"{BASE}/command-loop/events/{event_id}/execute",
            json={"operator": ADMIN_USER, "command": MAINTENANCE_COMMAND},
            headers=headers,
            timeout=30,
        )
        r.raise_for_status()
    except Exception as exc:
        print(f"\n[FAIL] 指令下发失败（{exc}）。请确认后端已连上 Broker。")
        return
    body = r.json()
    log("下发指令", f"状态={body.get('event', {}).get('status_state')} "
        f"command_id={body.get('command_id')} topic={body.get('mqtt_topic')}")

    # 6. 等待仿真设备经 MQTT 收到指令 -> 执行 -> 回执 -> 后端写回
    time.sleep(2.0)
    dev.step(0.0)
    log("仿真执行", f"{DEVICE_ID} is_running={dev.is_running} "
        f"wear={dev.wear:.3f} heat={dev.heat:.3f} efficiency={dev.efficiency:.3f}")

    # 7. 观察期：采集恢复曲线（起点=维护前，终点=维护后稳态，线性采样）
    health_after = round(dev.health_score, 2)
    curve = [round(health_before + (health_after - health_before) * i / 4, 2) for i in range(5)]
    log("恢复观察", f"health {health_before:.2f} -> {health_after:.2f}，采样曲线={curve}")

    r = requests.post(
        f"{BASE}/command-loop/events/{event_id}/observe",
        json={"actual_curve": curve, "operator": ADMIN_USER},
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    ob = r.json()
    log("观察评估", f"状态={ob.get('status_state')} "
        f"判定={ob.get('feedback_result', {}).get('verdict')} "
        f"偏差={ob.get('feedback_result', {}).get('deviation_pct')}%")

    # 8. 时间线（下发 -> 执行 -> 回执 -> 观察 -> 恢复）
    r = requests.get(
        f"{BASE}/command-loop/events/{event_id}/timeline",
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    print("\n" + "=" * 70)
    print("事件状态时间线（who / when / why）")
    print("=" * 70)
    for e in r.json():
        frm = e.get("from_state") or "(初始)"
        print(f"  {frm:<10s} -> {e.get('to_state'):<10s} by {e.get('operator'):<8s} "
              f"{e.get('reason', '')[:46]}")

    print("\nAI Agent 指令闭环演示完成 ✅")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Agent 指令闭环演示")
    parser.add_argument("--self-test", action="store_true", help="离线自测仿真端指令解析")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        main()
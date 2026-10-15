# -*- coding: utf-8 -*-
"""第八章端到端功能验证：用 FastAPI TestClient 走完整诊断闭环（不依赖外部服务）。

覆盖：会诊建事件 -> 人工确认 -> 指令执行 -> 报告生成 -> 时间线留痕 -> 自评指标。
数据库临时用 SQLite，大模型走 MOCK，MQTT 不启动。

用法： .venv\\Scripts\\python.exe scripts\\ch8_e2e.py
输出： scripts/_ch8_e2e.txt
"""
from __future__ import annotations

import io
import json
import math
import os
import random
import sys  # noqa: F401
import tempfile
import time
from pathlib import Path

import numpy as np

ROOT = Path(r"D:\企业云系统\工业互联网系统")
for _p in (str(ROOT), str(ROOT / "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# --- 隔离环境：临时 SQLite + 大模型 Mock ---
_tmpdb = Path(tempfile.gettempdir()) / "ch8_e2e_test.db"
if _tmpdb.exists():
    try:
        _tmpdb.unlink()
    except Exception:
        pass
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdb.as_posix()}"
os.environ["DEEPSEEK_MOCK"] = "true"
os.environ["MQTT_ENABLED"] = "false"

out: list[str] = []
w = out.append


def sec(title: str) -> None:
    w(f"\n{'=' * 66}\n{title}\n{'=' * 66}")


w("=== 第 8 章 端到端功能验证 ===")
w(f"临时数据库: {_tmpdb}")
w(f"DEEPSEEK_MOCK = {os.environ['DEEPSEEK_MOCK']}")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

BASE = "/api/v1"

random.seed(7)

# --- 取一段真实的 CWRU 内圈故障样本（测试划分内），驱动状态机走到告警分支 ---
from backend.app.modules.anomaly_detect import data_loader as dl  # noqa: E402

_X, _Ystr, _FID = dl.load_npz()
_Yint = dl.map_labels(_Ystr)
(_, _, _test_d), (_, _, _test_idx) = dl.stratified_file_split(_X, _Yint, _FID, seed=42)
w(f"\nCWRU 测试集样本数 = {len(_test_idx)}")
_sel = int(np.where(_test_d[1] == 1)[0][0])  # 1 = inner_race
_real = np.asarray(_test_d[0][_sel]).reshape(-1)
w(f"选用测试集第 {_sel} 号样本（标签 IR），长度 {len(_real)}，RMS={float(np.sqrt((_real**2).mean())):.4f}")


def window() -> list[dict]:
    """把真实 IR 振动窗口包装成后端接口要求的 list[dict] 格式。"""
    return [{"vibration": round(float(v), 6)} for v in _real]


results: list[tuple[str, str, float, str]] = []


def call(method: str, path: str, **kw) -> dict:
    t0 = time.perf_counter()
    r = getattr(client, method)(f"{BASE}{path}", **kw)
    dt = (time.perf_counter() - t0) * 1000.0
    ok = 200 <= r.status_code < 300
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:200]}
    return {"ok": ok, "status": r.status_code, "ms": dt, "body": body}


with TestClient(app) as client:
    sec("T1  系统健康检查")
    t0 = time.perf_counter()
    r = client.get("/health")
    dt = (time.perf_counter() - t0) * 1000.0
    w(f"GET /health -> {r.status_code} {r.json()}  ({dt:.1f} ms)")

    sec("T2  设备目录（种子数据）")
    r = call("get", "/devices/")
    devs = r["body"] if isinstance(r["body"], list) else []
    w(f"GET /devices -> {r['status']}，共 {len(devs)} 台")
    for d in devs[:8]:
        w(f"  {d.get('id'):<16s} {d.get('name'):<10s} type={d.get('type')} "
          f"health={d.get('health_score')} status={d.get('status')}")

    sec("T3  多智能体会诊（创建诊断事件）")
    payload = {"device_id": "pump-002", "window": window(), "operator": "tester"}
    r = call("post", "/command-loop/events", json=payload)
    w(f"POST /command-loop/events -> {r['status']}  ({r['ms']:.1f} ms)")
    ev = r["body"] if isinstance(r["body"], dict) else {}
    event_id = ev.get("id")
    w(f"  event_id={event_id}  state={ev.get('status_state')}  "
      f"fault={ev.get('fault_type')}  conf={ev.get('confidence')}  "
      f"health={ev.get('health_score')}")
    agents = (ev.get("agent_diagnosis") or {}).get("agent_results") or []
    w(f"  参与会诊 Agent 数 = {len(agents)}")
    for a in agents:
        w(f"    - {str(a.get('agent_name')):<20s} {str(a.get('conclusion'))[:70]}")
    ds_info = (ev.get("agent_diagnosis") or {}).get("ds_fusion")
    if ds_info:
        w(f"  D-S 融合: {json.dumps(ds_info, ensure_ascii=False)[:220]}")
    results.append(("T3 会诊建事件", "通过" if r["ok"] and event_id else "失败", r["ms"], ""))

    sec("T4  人工确认（pending -> handling）")
    r = call("post", f"/command-loop/events/{event_id}/confirm", json={"operator": "tester"})
    w(f"POST .../confirm -> {r['status']}  state={r['body'].get('status_state')}  ({r['ms']:.1f} ms)")
    results.append(("T4 人工确认", "通过" if r["body"].get("status_state") == "handling" else "失败",
                    r["ms"], str(r["body"].get("status_state"))))

    sec("T5  指令执行（handling -> observing）")
    r = call("post", f"/command-loop/events/{event_id}/execute", json={"operator": "tester"})
    body = r["body"]
    st = (body.get("event") or {}).get("status_state") or body.get("status_state")
    w(f"POST .../execute -> {r['status']}  state={st}  ({r['ms']:.1f} ms)")
    w(f"  下发指令编号 command_id = {body.get('command_id')}")
    results.append(("T5 指令执行", "通过" if st == "observing" else "失败", r["ms"], str(st)))

    sec("T6  事件报告生成")
    r = call("post", f"/reports/event/{event_id}")
    rep = r["body"].get("report", "") if isinstance(r["body"], dict) else ""
    w(f"POST /reports/event/{event_id} -> {r['status']}  报告 {len(rep)} 字符  ({r['ms']:.1f} ms)")
    w("  报告前 300 字：")
    w("  " + rep[:300].replace("\n", "\n  "))
    results.append(("T6 报告生成", "通过" if len(rep) > 50 else "失败", r["ms"], f"{len(rep)}字"))

    sec("T7  事件时间线留痕（who/when/why）")
    r = call("get", f"/command-loop/events/{event_id}/timeline")
    tl = r["body"] if isinstance(r["body"], list) else []
    w(f"GET .../timeline -> {r['status']}  共 {len(tl)} 条  ({r['ms']:.1f} ms)")
    for e in tl:
        w(f"  {str(e.get('from_state')):<12s} -> {str(e.get('to_state')):<12s} "
          f"by {str(e.get('operator')):<10s} {str(e.get('reason'))[:40]}")
    results.append(("T7 时间线留痕", "通过" if len(tl) >= 2 else "失败", r["ms"], f"{len(tl)}条"))

    sec("T8  人工修订（不推进状态机）")
    r = call("post", f"/command-loop/events/{event_id}/revise",
             json={"operator": "tester", "fault_label": "outer_race",
                   "recommendation": "停机检查轴承外圈", "note": "回归测试"})
    b = r["body"]
    st2 = (b.get("event") or {}).get("status_state") or b.get("status_state")
    w(f"POST .../revise -> {r['status']}  修订后状态={st2}（应保持 observing）  ({r['ms']:.1f} ms)")
    results.append(("T8 人工修订不改状态", "通过" if st2 == "observing" else "失败", r["ms"], str(st2)))

    sec("T9  系统自评指标")
    r = call("get", "/self-eval/metrics")
    m = r["body"] if isinstance(r["body"], dict) else {}
    w(f"GET /self-eval/metrics -> {r['status']}  ({r['ms']:.1f} ms)")
    for k in ("accuracy", "false_alarm_rate", "miss_rate", "avg_latency_seconds", "total"):
        w(f"  {k:<22s} {m.get(k)}")
    results.append(("T9 自评指标", "通过" if r["ok"] else "失败", r["ms"], ""))

    sec("T10 双闭环环路概览")
    r = call("get", "/self-eval/loops")
    lp = r["body"] if isinstance(r["body"], dict) else {}
    w(f"GET /self-eval/loops -> {r['status']}  ({r['ms']:.1f} ms)")
    w(f"  {json.dumps(lp, ensure_ascii=False)[:600]}")
    results.append(("T10 双闭环概览", "通过" if r["ok"] else "失败", r["ms"], ""))

    sec("T13 内闭环：观察期反馈评估（处置后是否真的恢复）")
    from app.models import SessionLocal  # noqa: E402
    from app.modules.command_loop.service import command_loop_service  # noqa: E402

    db = SessionLocal()
    try:
        fb = command_loop_service.evaluate_feedback(db, event_id, 92.0, "tester")
        w(f"  evaluate_feedback(health=92) -> {json.dumps(fb, ensure_ascii=False)[:300]}")
        st_fb = (fb.get("event") or {}).get("status_state") or fb.get("status_state")
        results.append(("T13 观察期反馈(恢复)", "通过" if st_fb == "recovered" else "失败",
                        0.0, str(st_fb)))
    except Exception as e:  # pragma: no cover
        w(f"  反馈评估异常: {type(e).__name__}: {e}")
        results.append(("T13 观察期反馈(恢复)", "失败", 0.0, str(e)[:40]))
    finally:
        db.close()

    r = call("get", f"/command-loop/events/{event_id}/timeline")
    tl = r["body"] if isinstance(r["body"], list) else []
    w(f"  反馈评估后时间线共 {len(tl)} 条：")
    for e in tl:
        w(f"    {str(e.get('from_state')):<12s} -> {str(e.get('to_state')):<12s} "
          f"by {str(e.get('operator')):<10s} {str(e.get('reason'))[:36]}")

    sec("T11 视觉检测接口（模型清单/样例）")
    r = call("get", "/vision/models")
    w(f"GET /vision/models -> {r['status']}  ({r['ms']:.1f} ms)")
    w(f"  {json.dumps(r['body'], ensure_ascii=False)[:300]}")

    sec("T12 可视化数据出口（第 4~7 章成果落库）")
    for ep in ("fp-cnn-compare", "rul-sde-pf", "domain-adapt", "cwru-signal"):
        r = call("get", f"/viz/{ep}")
        n = len(json.dumps(r["body"], ensure_ascii=False))
        w(f"  GET /viz/{ep:<16s} -> {r['status']}  响应 {n} 字符  ({r['ms']:.1f} ms)")
        results.append((f"T12 viz/{ep}", "通过" if r["ok"] else "失败", r["ms"], f"{n}字符"))

sec("测试用例汇总")
w(f"{'用例':<26s}{'结果':>8s}{'耗时(ms)':>12s}   备注")
w("-" * 66)
for name, res, ms, note in results:
    w(f"{name:<26s}{res:>8s}{ms:>12.1f}   {note}")
npass = sum(1 for x in results if x[1] == "通过")
w(f"\n通过 {npass}/{len(results)}")

io.open(ROOT / "scripts" / "_ch8_e2e.txt", "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out))

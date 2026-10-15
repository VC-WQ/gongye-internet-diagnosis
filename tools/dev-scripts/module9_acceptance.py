"""模块9 事件时间线端到端验收。

覆盖：
  1. GET /timeline/event/{id}        返回 sensor / latent / annotations 三块
  2. max_points 参数：默认256 -> 256点；2048 -> 不降采样
  3. simulate_latent=true：确定性生成隐状态（重复请求结果一致）
  4. GET /timeline/device/{id}       返回该设备近期事件摘要

用 OR#234 告警样本跑一遍闭环后生成时间线。

运行：cd backend && ..\\.venv\\Scripts\\python.exe ..\\tmp\\module9_acceptance.py
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


def alarm_window(index: int = 234) -> list[dict]:
    data = np.load(NPZ)
    x = data['X'][index].flatten().tolist()
    return [{"vibration": float(v)} for v in x]


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("#" * 80)
    print("流程1：创建 OR#234 事件并走完闭环")
    print("#" * 80)
    win = alarm_window(234)
    e = command_loop_service.create_event(db, "dev-OR-234", win, "system")
    eid = e['id']
    command_loop_service.confirm(db, eid, "张工")
    command_loop_service.execute(db, eid, "张工")
    r = feedback_loop_service.observe_and_evaluate(db, eid, [30, 45, 60, 75, 85], "张工")
    print(f"  创建事件 #{eid}，状态={r['status_state']}，判定={r['feedback_result']['verdict']}")

    client = TestClient(app)

    print("\n" + "#" * 80)
    print("流程2：GET /timeline/event/{id}（默认 max_points=256）")
    print("#" * 80)
    resp = client.get(f"/api/v1/timeline/event/{eid}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    print(f"  -> 200 | fault_type={data['fault_type']} | health_score={data['health_score']} | state={data['status_state']}")
    print(f"  sensor: channels={data['sensor']['channels']} points={data['sensor']['points']} "
          f"downsampled={data['sensor']['downsampled']} stride={data['sensor']['stride']}")
    print(f"  latent: available={data['latent']['available']} simulated={data['latent']['simulated']} "
          f"wear点数={len(data['latent']['series']['latent_wear'])}")
    print(f"  annotations: {len(data['annotations'])} 条")
    for a in data['annotations']:
        print(f"    [{a['type']:8s}] {a['label']} @ {a['time']}")

    print("\n" + "#" * 80)
    print("流程3：max_points=2048 不降采样")
    print("#" * 80)
    resp_full = client.get(f"/api/v1/timeline/event/{eid}", params={"max_points": 2048})
    data_full = resp_full.json()
    print(f"  -> 200 | points={data_full['sensor']['points']} downsampled={data_full['sensor']['downsampled']}")
    assert data_full['sensor']['points'] == 2048 and data_full['sensor']['downsampled'] is False

    print("\n" + "#" * 80)
    print("流程4：simulate_latent=true 确定性校验")
    print("#" * 80)
    r1 = client.get(f"/api/v1/timeline/event/{eid}", params={"simulate_latent": "true"}).json()
    r2 = client.get(f"/api/v1/timeline/event/{eid}", params={"simulate_latent": "true"}).json()
    w1 = r1['latent']['series']['latent_wear']
    w2 = r2['latent']['series']['latent_wear']
    print(f"  simulate=true -> available={r1['latent']['available']} simulated={r1['latent']['simulated']}")
    print(f"  wear[0]={w1[0]}, wear[-1]={w1[-1]}, 点数={len(w1)}")
    print(f"  两次请求曲线一致: {w1 == w2}")
    assert r1['latent']['simulated'] is True
    assert w1 == w2 and len(w1) == 256
    # 物理叙事校验：OR 故障 wear 指数上升
    assert w1[-1] > w1[0], "OR 故障 wear 应上升"

    print("\n" + "#" * 80)
    print("流程5：GET /timeline/device/{id}")
    print("#" * 80)
    rd = client.get("/api/v1/timeline/device/dev-OR-234").json()
    print(f"  -> device={rd['device_id']} count={rd['count']}")
    for ev in rd['events'][:5]:
        print(f"    event#{ev['event_id']} {ev['fault_type']} health={ev['health_score']} state={ev['status_state']}")
    assert rd['count'] >= 1

    db.close()
    print("\n验收完成。")


if __name__ == '__main__':
    main()
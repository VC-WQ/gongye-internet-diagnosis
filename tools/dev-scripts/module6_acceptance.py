"""模块6 指令闭环端到端验收。

覆盖：
  1. 完整成功流程：告警 -> 会诊 -> 待确认 -> 确认 -> 执行 -> 观察 -> 恢复
  2. 观察期反馈失败 -> 复发 -> 再诊断 -> 待确认
  3. 非法状态转换被拒绝（正常直跳观察被拦截）
  4. 决策2/决策4：故障类+高置信才告警；normal->alarm 允许骤降

运行：cd backend && ..\\.venv\\Scripts\\python.exe ..\\tmp\\module6_acceptance.py
"""
import sys
from pathlib import Path

ROOT = Path(r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统')
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

import numpy as np

from app.models import Base, SessionLocal, engine
from app.modules.command_loop.models import EventState
from app.modules.command_loop.service import EventNotFoundError, command_loop_service
from app.modules.command_loop.state_machine import (
    StateTransitionError,
    can_transition,
    classify_state,
)

NPZ = str(ROOT / 'datasets' / 'CWRU' / 'processed.npz')


def _window(cls_label: str, k: int) -> tuple[int, list[dict]]:
    """取指定类别第 k 条样本 -> (样本序号, 传感器窗口)。"""
    data = np.load(NPZ)
    idxs = np.where(data['Y'] == cls_label)[0]
    i = int(idxs[k])
    x = data['X'][i].flatten().tolist()
    return i, [{"vibration": float(v)} for v in x]


def pick_alarm_window() -> tuple[str, int, list[dict]]:
    """遍历故障样本，找到首个诊断为「故障类 + 置信度>0.7」的窗口。"""
    from app.modules.multi_agent.service import multi_agent_service

    for cls in ('OR', 'IR', 'Ball'):
        for k in range(15):
            i, window = _window(cls, k)
            res = multi_agent_service.consult(f"probe-{cls}-{i}", window)
            if res['fault_type'] != 'normal' and res['confidence'] > 0.7:
                return cls, i, window
    raise RuntimeError('未找到能触发告警的故障样本')


def print_timeline(db, event_id: int, title: str) -> None:
    print(f"\n----- 时间线：{title} (event_id={event_id}) -----")
    for row in command_loop_service.get_timeline(db, event_id):
        frm = row['from_state'] or '(初始)'
        print(
            f"  [{row['created_at'][:19]}] {frm} -> {row['to_state']:9s} "
            f"| 操作人={row['operator']} | 原因={row['reason']}"
        )


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("#" * 80)
    print("决策2/决策4 单元校验")
    print("#" * 80)
    print("  abnormal+故障+置信0.99 ->", classify_state('abnormal', 'inner_race', 0.99).value)
    print("  abnormal+正常+置信0.99 ->", classify_state('abnormal', 'normal', 0.99).value)
    print("  healthy 正常           ->", classify_state('healthy', 'normal', 0.99).value)
    print("  warning 预警           ->", classify_state('warning', 'normal', 0.5).value)
    print("  abnormal+故障+低置信0.5 ->", classify_state('abnormal', 'inner_race', 0.5).value)
    print("  can_transition(normal->observing) =", can_transition('normal', 'observing'))
    print("  can_transition(normal->alarm)     =", can_transition('normal', 'alarm'))

    # 找告警窗口
    cls, idx, alarm_window = pick_alarm_window()
    print(f"\n选用告警样本：{cls} #{idx}")

    # ================= 流程1：成功恢复 =================
    print("\n" + "#" * 80)
    print("流程1：告警 -> 会诊 -> 待确认 -> 确认 -> 执行 -> 观察 -> 恢复")
    print("#" * 80)
    e1 = command_loop_service.create_event(db, f"dev-{cls}-{idx}", alarm_window, "system")
    eid1 = e1['id']
    print(f"  创建事件 #{eid1}，初始状态={e1['status_state']}，故障={e1['fault_type']}，置信={e1['confidence']}")
    command_loop_service.confirm(db, eid1, "张工")
    print(f"  人工确认 -> {command_loop_service.get_event(db, eid1)['status_state']}")
    exe1 = command_loop_service.execute(db, eid1, "张工")
    print(f"  执行指令 -> {exe1['event']['status_state']}，command_id={exe1['command_id']}")
    fb1 = command_loop_service.evaluate_feedback(db, eid1, health_score=95.0, operator="张工")
    print(f"  反馈评估(健康分95) -> {fb1['status_state']}")
    print_timeline(db, eid1, "成功恢复")

    # ================= 流程2：反馈失败 -> 复发再诊断 =================
    print("\n" + "#" * 80)
    print("流程2：观察期反馈失败 -> 复发 -> 再诊断 -> 待确认")
    print("#" * 80)
    e2 = command_loop_service.create_event(db, f"dev2-{cls}-{idx}", alarm_window, "system")
    eid2 = e2['id']
    command_loop_service.confirm(db, eid2, "李工")
    command_loop_service.execute(db, eid2, "李工")
    fb2 = command_loop_service.evaluate_feedback(db, eid2, health_score=55.0, operator="李工")
    print(f"  反馈评估(健康分55) -> {fb2['status_state']}（复发后应回到待确认）")
    print_timeline(db, eid2, "复发再诊断")

    # ================= 流程3：非法转换拒绝 =================
    print("\n" + "#" * 80)
    print("流程3：非法状态转换被拒绝")
    print("#" * 80)
    nidx, normal_window = _window('Normal', 0)
    e3 = command_loop_service.create_event(db, f"dev-Normal-{nidx}", normal_window, "system")
    eid3 = e3['id']
    print(f"  正常样本事件 #{eid3}，当前状态={e3['status_state']}")
    try:
        command_loop_service.confirm(db, eid3, "测试员")  # pending->handling 从 normal 出发非法
        print("  [错误] 未拦截非法转换！")
    except StateTransitionError as exc:
        print(f"  [通过] 非法转换被拦截：{exc}")

    # 显式演示 normal->observing 被拒
    try:
        command_loop_service.execute(db, eid3, "测试员")
        print("  [错误] execute 未拦截非法转换！")
    except StateTransitionError as exc:
        print(f"  [通过] 正常状态执行指令被拦截：{exc}")

    print_timeline(db, eid3, "正常事件（仅初始态）")

    db.close()
    print("\n验收完成。")


if __name__ == '__main__':
    main()
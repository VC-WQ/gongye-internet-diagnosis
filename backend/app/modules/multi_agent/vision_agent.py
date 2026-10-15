"""部件表面损伤视觉检测 Agent（第五路证据）+ 振动↔视觉交叉验证规则。

定位
----
振动诊断看的是设备的**动态响应**，视觉检测看的是部件的**表面形貌**，
二者判的是同一类失效的两种表现：

    · 轴承点蚀（视觉可见的表面损伤）正是内/外圈故障（振动可测的动态响应）的物理成因
    · 齿轮点蚀、叶轮裂纹同理

因此视觉检测不是独立玩具模块，而是主线诊断的**第五路证据**，
与信号/物理/CNN/知识四路证据一起进入 D-S 证据融合。

交叉验证的四类情形
------------------
| 振动结论 | 视觉结论 | 融合判断 |
|---------|---------|---------|
| 故障     | 检出损伤 | 强互证：故障定位更确凿 |
| 正常     | 检出损伤 | 早期窗口期：表面已损伤但尚未引起振动异常 |
| 故障     | 无损伤   | 提示转向：可能为润滑/装配问题，非表面损伤型 |
| 正常     | 无损伤   | 一致性确认：双模态共同支持健康结论 |

其中「早期窗口期」是单靠振动无法捕捉的场景，也是多模态融合的核心价值。
"""
from __future__ import annotations

from .base import AgentContext, BaseAgent
from .schemas import FAULT_TYPE_LABELS_ZH, AgentResult

# NEU-DET 缺陷类名 -> 中文标签（与 vision 模块 CLASS_LABEL 保持一致）
DAMAGE_LABELS_ZH = {
    "crazing": "裂纹",
    "inclusion": "夹杂",
    "patches": "斑块",
    "pitted_surface": "点蚀",
    "rolled-in_scale": "氧化铁皮",
    "scratches": "划痕",
}

# 交叉验证结论类型 -> 展示文案
CROSS_CHECK_TEXT = {
    "strong_corroboration": "振动与视觉双模态互相印证，故障定位确凿",
    "early_warning": "早期窗口期：表面已出现损伤，但尚未引起显著振动异常",
    "redirect_hint": "振动异常但表面未见损伤，提示可能为润滑不良/装配问题",
    "consistent_normal": "振动与视觉均未发现异常，双模态一致性确认健康",
    "vision_only_damage": "仅视觉检出损伤（未提供有效振动证据）",
    "vibration_only_fault": "仅振动判定故障（未提供部件表面图像）",
    "no_evidence": "振动与视觉证据均不足",
}


class VisionInspectionAgent(BaseAgent):
    """视觉检测 Agent：部件表面损伤识别，作为第五路证据参与会诊。"""

    role = "vision_inspection"
    name = "视觉检测 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        vision = ctx.anomaly.get("vision") or {}
        available = bool(vision.get("available"))
        damage_type = vision.get("damage_type")
        confidence = float(vision.get("confidence", 0.0) or 0.0)
        count = int(vision.get("count", 0) or 0)

        if not available:
            return AgentResult(
                agent_role=self.role,
                agent_name=self.name,
                conclusion="未提供部件表面图像，视觉证据缺失",
                fault_type="normal",
                confidence=0.0,
                evidence="未上传解体检修/内窥镜图像，本路证据不参与融合",
                details={"vision_available": False},
            )

        if not damage_type:
            return AgentResult(
                agent_role=self.role,
                agent_name=self.name,
                conclusion="部件表面未见明显损伤",
                fault_type="normal",
                confidence=round(confidence, 4),
                evidence="视觉检测未检出表面损伤（点蚀/划痕/裂纹等）",
                details={"vision_available": True, "damage_type": None, "count": 0},
            )

        label = DAMAGE_LABELS_ZH.get(damage_type, damage_type)
        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=f"检出部件表面损伤：{label}（置信度 {confidence:.2f}）",
            fault_type="normal",  # 视觉不直接判定轴承故障部位，交由融合层处理
            confidence=round(confidence, 4),
            evidence=f"表面损伤类型 {label}，共检出 {count} 处",
            details={
                "vision_available": True,
                "damage_type": damage_type,
                "damage_label": label,
                "confidence": round(confidence, 4),
                "count": count,
            },
        )


def cross_check(vibration_fault: str, vision_damage: str | None, vision_available: bool) -> dict:
    """振动结论与视觉结论的交叉验证，返回互证类型与说明文案。

    Parameters
    ----------
    vibration_fault : 融合后的振动侧故障类型（normal 表示无故障）
    vision_damage   : 视觉检出的损伤类型（None 表示未检出）
    vision_available: 是否提供了有效的部件表面图像
    """
    vib_abnormal = vibration_fault != "normal"
    vis_abnormal = bool(vision_damage)

    if vib_abnormal and vis_abnormal:
        kind = "strong_corroboration"
    elif (not vib_abnormal) and vis_abnormal:
        kind = "early_warning"
    elif vib_abnormal and (not vis_abnormal) and vision_available:
        kind = "redirect_hint"
    elif (not vib_abnormal) and (not vis_abnormal) and vision_available:
        kind = "consistent_normal"
    elif vis_abnormal:
        kind = "vision_only_damage"
    elif vib_abnormal:
        kind = "vibration_only_fault"
    else:
        kind = "no_evidence"

    return {
        "kind": kind,
        "text": CROSS_CHECK_TEXT[kind],
        "vibration_fault": vibration_fault,
        "vibration_fault_label": FAULT_TYPE_LABELS_ZH.get(vibration_fault, vibration_fault),
        "vision_damage": vision_damage,
        "vision_damage_label": DAMAGE_LABELS_ZH.get(vision_damage, vision_damage) if vision_damage else None,
        "is_early_warning": kind == "early_warning",
    }


__all__ = ["VisionInspectionAgent", "cross_check", "DAMAGE_LABELS_ZH"]

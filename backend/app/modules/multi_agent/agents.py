"""模块5 多智能体会诊 Agent 池（物理残差 / 故障分类 / 决策）。

信号分析 Agent 已独立到 signal_agent.py；AgentContext 与 BaseAgent 抽离到
base.py。本文件维护其余 Agent 与 Agent 池组装。
"""
from __future__ import annotations

import logging

from .base import AgentContext, BaseAgent
from .chairman import Chairman
from .ds_fusion import fuse_evidence
from .knowledge_agent import KnowledgeAgent
from .llm_client import llm_client
from .schemas import FAULT_TYPE_LABELS_ZH, AgentResult, FaultType, _round
from .signal_agent import DOMINANT_TO_FAULT, SignalAnalysisAgent
from .vision_agent import cross_check

logger = logging.getLogger(__name__)


def _find(agent_results: list[AgentResult], role: str) -> AgentResult | None:
    """从 Agent 结论列表中按 role 查找。"""
    for r in agent_results:
        if r.agent_role == role:
            return r
    return None


# ---------------------------------------------------------------------------
# 物理残差 Agent（透传模块4 PINN 残差）
# ---------------------------------------------------------------------------
class PhysicalResidualAgent(BaseAgent):
    """物理残差 Agent：依据 PINN 物理残差判断信号是否偏离物理规律。"""

    role = "physical_residual"
    name = "物理残差 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        pinn = ctx.anomaly.get("pinn") or {}
        residual = float(pinn.get("residual", 0.0))
        pinn_source = pinn.get("pinn_source", "heuristic")

        # 严重度分级：normal <0.05 / mild 0.05~0.2 / severe >0.2
        if residual < 0.05:
            severity = "normal"
        elif residual <= 0.2:
            severity = "mild"
        else:
            severity = "severe"

        # 相对 Normal 基线的倍数（基线按模块4 PINN 标定结果 0.019）
        normal_baseline = 0.019
        ratio = residual / normal_baseline if normal_baseline else 0.0

        if severity == "normal":
            conclusion = "PINN 物理残差处于正常基线范围内"
            evidence = f"PINN残差{residual:.4f}，接近Normal基线{normal_baseline:.3f}"
        else:
            conclusion = f"PINN 物理残差 {severity} 级偏离，存在物理异常信号"
            evidence = f"PINN残差{residual:.4f}，是Normal基线的{ratio:.1f}倍，提示显著异常"

        # LLM 解读 PINN 残差的物理含义（失败降级为模板）
        if severity != "normal":
            llm_text = llm_client.chat(
                "你是设备物理建模专家，只负责解读 PINN 物理残差的含义，"
                "不要计算、不要编造数据。",
                f"PINN 物理残差 {residual:.4f}，是正常基线（{normal_baseline:.3f}）的"
                f"{ratio:.1f} 倍，严重度 {severity}。请用 2-3 句通俗语言解释其物理含义。",
            )
            if llm_text:
                conclusion = llm_text

        # 物理残差不指向具体故障类型，具体分类交由 CNN / 信号证据
        confidence = {"normal": 0.6, "mild": 0.7, "severe": 0.9}.get(severity, 0.6)

        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=conclusion,
            fault_type=FaultType.NORMAL.value,
            confidence=_round(confidence),
            evidence=evidence,
            details={
                "residual": _round(residual),
                "pinn_source": pinn_source,
                "residual_severity": severity,
                "residual_ratio": _round(ratio, 1),
            },
        )


# ---------------------------------------------------------------------------
# 故障分类 Agent（透传模块4 CNN 分类结果）
# ---------------------------------------------------------------------------
class FaultDiagnosisAgent(BaseAgent):
    """故障分类 Agent：依据 1D-CNN 分类结果判定具体故障类型。"""

    role = "fault_diagnosis"
    name = "故障分类 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        cnn = ctx.anomaly.get("cnn") or {}
        fault_type = str(cnn.get("fault_type", "normal"))
        confidence = float(cnn.get("confidence", 0.0))
        cnn_source = cnn.get("cnn_source", "heuristic")
        probs = cnn.get("probabilities") or {}

        # 仅认可当前可用的 4 类；后 2 类（lubrication/overheating）当前不可达
        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)
        conclusion = f"故障分类结论：{label}（置信度 {confidence:.4f}）"
        if fault_type == "normal":
            evidence = "CNN 判定为正常工况"
        else:
            evidence = f"CNN 识别到 {label}，各类置信度：{probs}"

        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=conclusion,
            fault_type=fault_type,
            confidence=_round(confidence),
            evidence=evidence,
            details={"cnn_source": cnn_source, "probabilities": probs},
        )


# ---------------------------------------------------------------------------
# 决策 Agent（汇总各 Agent 结论，prompt 预留多通道判断）
# ---------------------------------------------------------------------------
class DecisionAgent(BaseAgent):
    """决策 Agent：汇总各诊断 Agent 结论，产出 8 部分诊断报告。

    决策逻辑：
    - CNN 为主判断，信号/物理/知识交叉验证。
    - 信号证据与 CNN 一致 -> 置信度 = CNN + 0.02；冲突 -> 保持 CNN 原值。
    - 信号可靠性 low -> 信号证据标记 insufficient。
    """

    role = "decision"
    name = "决策 Agent"

    # 预留 prompt：未来接入 LLM 时渲染。当前分支不激活多通道判断。
    DECISION_PROMPT_TEMPLATE = (
        "你是一名工业设备诊断专家，请基于以下各诊断 Agent 的结论进行综合决策。"
        "若有温度/电流等多通道信息，请综合判断润滑或过热倾向。"
        "各 Agent 结论：{agent_conclusions}\n"
        "健康评分：{health}\n"
        "请给出最终故障类型、置信度与维护建议。"
    )

    # 各故障类型的维护建议（6 类，后 2 类预留），作为知识库无匹配时的回退
    RECOMMENDATIONS: dict[str, str] = {
        FaultType.NORMAL: "设备运行正常，持续监测并保持定期润滑即可。",
        FaultType.INNER_RACE: "建议停机检查轴承内圈，重点关注 BPFI 特征频率及其转频边带。",
        FaultType.OUTER_RACE: "建议停机检查轴承外圈，重点关注 BPFO 特征频率及谐波间隔。",
        FaultType.BALL: "建议检查滚动体磨损，重点关注 BSF/2×BSF 谐波族与保持架 FTF 调制。",
        FaultType.LUBRICATION: "建议检查润滑状态，确认润滑脂量与污染程度。（预留）",
        FaultType.OVERHEATING: "建议检查散热与负载，排查过热诱因。（预留）",
    }

    # 各故障类型的追问问题（用于报告第 8 部分）
    FOLLOW_UPS: dict[str, list[str]] = {
        FaultType.NORMAL: [
            "近期是否出现异常振动、异响或温升？",
            "润滑周期是否按计划执行？",
        ],
        FaultType.INNER_RACE: [
            "是否观察到 BPFI 转频边带随转速变化？",
            "是否需要拆解确认内圈滚道剥落/点蚀的缺陷尺寸？",
        ],
        FaultType.OUTER_RACE: [
            "外圈故障点是否位于负载区（影响劣化速度）？",
            "是否需要停机检查外圈滚道剥落情况？",
        ],
        FaultType.BALL: [
            "滚动体是否存在磨损、划痕或剥落？",
            "是否需要同步检查保持架状态？",
        ],
        FaultType.LUBRICATION: [
            "润滑脂是否乳化、污染或流失？（预留）",
        ],
        FaultType.OVERHEATING: [
            "冷却系统与负载工况是否异常？（预留）",
        ],
    }

    def decide(
        self,
        ctx: AgentContext,
        agent_results: list[AgentResult],
        chairman_result: dict | None = None,
    ) -> AgentResult:
        """基于各 Agent 结论做最终决策，产出 8 部分诊断报告。

        chairman_result 由编排层（chairman 节点）传入；未传入时自算，
        保持本方法可独立调用。
        """
        cnn = ctx.anomaly.get("cnn") or {}
        health = ctx.anomaly.get("health") or {}
        fault_type = str(cnn.get("fault_type", "normal"))
        cnn_conf = float(cnn.get("confidence", 0.0))
        health_score = float(health.get("health_score", 100.0))
        health_level = str(health.get("health_level", "healthy"))
        level_label = str(health.get("level_label", "正常"))

        signal = _find(agent_results, "signal_analyst")
        physics = _find(agent_results, "physical_residual")
        knowledge = _find(agent_results, "knowledge_retrieval")

        # 信号证据
        sig_ev = (signal.details.get("signal_evidence") or {}) if signal else {}
        dominant = sig_ev.get("dominant_peak", "none")
        signal_reliability = sig_ev.get("signal_reliability", "low")
        signal_fault = DOMINANT_TO_FAULT.get(dominant, "normal")
        signal_text = signal.evidence if signal else "无振动信号"

        # 物理证据
        severity = physics.details.get("residual_severity", "normal") if physics else "normal"
        physical_text = physics.evidence if physics else ""

        # 知识引用
        knowledge_basis = knowledge.evidence if knowledge else ""
        kb_recommendation = (knowledge.details.get("recommendation") or "") if knowledge else ""

        # 会诊主席冲突检测（编排层可传入，未传入时自算）
        chairman_result = chairman_result or Chairman().detect(ctx, agent_results)
        conflict_detected = bool(chairman_result["conflict_detected"])
        conflicts = chairman_result["conflicts"]

        # 信号与 CNN 一致性判定
        signal_cnn_conflict = (
            signal_reliability != "low" and dominant != "none" and signal_fault != fault_type
        )

        details: dict = {
            "conflict_detected": conflict_detected,
            "conflicts": conflicts,
            "resolution": chairman_result["resolution"],
        }

        # ---- 技术增量：Dempster-Shafer 证据融合 ----
        # 替代原「信号与 CNN 一致 +0.02 / 冲突保持原值」的经验规则：
        # 各证据源（CNN / 信号 / 物理残差 / 视觉）先按可靠性做 Shafer 折扣转为 BPA，
        # 再用 Dempster 合成规则组合；冲突系数 K 量化证据矛盾程度，作为可解释输出。
        vision = ctx.anomaly.get("vision") or {}
        fusion = fuse_evidence(
            cnn_probabilities=cnn.get("probabilities") or {},
            cnn_trained=(cnn.get("cnn_source") == "trained_model"),
            dominant_peak=dominant,
            signal_reliability=signal_reliability,
            physics_severity=severity,
            vision_damage_type=vision.get("damage_type"),
            vision_confidence=float(vision.get("confidence", 0.0) or 0.0),
        )
        fault_type = fusion["fault_type"]
        confidence = fusion["confidence"]
        details["ds_fusion"] = {
            "distribution": fusion["distribution"],
            "conflict_k": fusion["conflict_k"],
            "bpas": fusion["bpas"],
            "cnn_confidence": round(cnn_conf, 4),
        }

        if signal_reliability == "low":
            signal_text = "信号证据不足（无显著特征频率峰）"
            details["signal_evidence"] = "insufficient"
        elif signal_cnn_conflict:
            details["signal_cnn_conflict"] = True

        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)

        # ---- 振动 ↔ 视觉 交叉验证（多模态协同诊断）----
        vision_cross = cross_check(
            vibration_fault=fault_type,
            vision_damage=vision.get("damage_type") if vision.get("available") else None,
            vision_available=bool(vision.get("available")),
        )
        details["vision_cross_check"] = vision_cross

        # 诊断推理文本
        reasoning_parts = [
            f"以 D-S 证据融合判定：{label}"
            f"（CNN {cnn_conf:.4f} → 融合后 {confidence:.4f}，"
            f"证据冲突系数 K={fusion['conflict_k']:.4f}）"
        ]
        if vision_cross["kind"] != "no_evidence":
            reasoning_parts.append(f"振动-视觉交叉验证：{vision_cross['text']}")
        if signal_reliability != "low" and dominant != "none":
            reasoning_parts.append(
                f"信号分析主导峰 {dominant} 指向 {signal_fault}，"
                f"与 CNN {'一致' if not signal_cnn_conflict else '不一致'}"
            )
        else:
            reasoning_parts.append("信号分析未提供充分主导峰证据")
        reasoning_parts.append(f"物理残差严重度 {severity}，健康分等级 {health_level}")
        reasoning = "；".join(reasoning_parts) + "。"

        # 第 1 部分：summary（发生了什么）
        if conflict_detected:
            summary = (
                f"设备判定为「{label}」，但各证据存在 {len(conflicts)} 处冲突，"
                f"以 CNN 为主判断（置信度 {confidence:.4f}）。"
            )
        else:
            summary = (
                f"设备判定为「{label}」，信号/物理/知识证据交叉验证一致"
                f"（置信度 {confidence:.4f}）。"
            )

        # 早期窗口期是单靠振动无法捕捉的场景，需在摘要中显式提示
        if vision_cross.get("is_early_warning"):
            summary += (
                "【多模态提示】振动尚未表现异常，但部件表面已检出损伤，"
                "属早期窗口期，建议纳入检修计划重点跟踪。"
            )

        # LLM 生成诊断摘要（失败降级为模板）
        agent_lines = "\n".join(f"- {r.agent_name}：{r.conclusion}" for r in agent_results)
        llm_summary = llm_client.chat(
            "你是工业设备诊断会诊主席，只负责综合各方结论生成摘要，"
            "不要计算、不要编造数据。",
            f"各诊断 Agent 结论：\n{agent_lines}\n"
            f"CNN 判定：{label}（置信度 {cnn_conf:.4f}），"
            f"健康分 {health_score:.2f}（{level_label}）。请用 2-3 句给出诊断摘要。",
        )
        if llm_summary:
            summary = llm_summary

        # 第 6 部分：impact
        impact = self._impact(fault_type, health_score, health_level, level_label)

        # 第 7 部分：recommendation（优先知识库引用，回退规则库）
        recommendation = kb_recommendation or self.RECOMMENDATIONS.get(
            fault_type, self.RECOMMENDATIONS[FaultType.NORMAL]
        )

        # LLM 润色维护建议（失败降级为规则库建议）
        llm_rec = llm_client.chat(
            "你是工业设备维护专家，只负责给出维护建议，不要计算、不要编造数据。",
            f"设备诊断为「{label}」（置信度 {confidence:.4f}），健康分 {health_score:.2f}。"
            f"规则建议：「{recommendation}」。请润色为更具体、可执行的维护建议（2-3 句）。",
        )
        if llm_rec:
            recommendation = llm_rec

        # 第 8 部分：follow_up_questions
        follow_up_questions = self.FOLLOW_UPS.get(fault_type, self.FOLLOW_UPS[FaultType.NORMAL])

        # 第 5.5 部分：表面损伤证据（视觉模态，多模态协同诊断的可解释输出）
        vision_text = ""
        if vision_cross["vision_damage_label"]:
            vision_text = (
                f"部件表面检出「{vision_cross['vision_damage_label']}」"
                f"（{vision.get('count', 0)} 处，置信度 {float(vision.get('confidence', 0.0)):.2f}）；"
                f"{vision_cross['text']}"
            )
        elif vision.get("available"):
            vision_text = f"部件表面未见明显损伤；{vision_cross['text']}"
        else:
            vision_text = "未提供部件表面图像（解体检修/内窥镜），视觉证据未参与本次会诊"

        report = {
            "summary": summary,
            "physical_evidence": physical_text,
            "signal_evidence": signal_text,
            "vision_evidence": vision_text,
            "knowledge_basis": knowledge_basis,
            "diagnosis": {
                "fault_type": fault_type,
                "confidence": _round(confidence),
                "reasoning": reasoning,
            },
            "impact": impact,
            "recommendation": recommendation,
            "follow_up_questions": follow_up_questions,
        }

        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=summary,
            fault_type=fault_type,
            confidence=_round(confidence),
            evidence=f"健康分={health_score:.2f}，参与 Agent={[r.agent_role for r in agent_results]}",
            details={"report": report, **details},
        )

    @staticmethod
    def _impact(fault_type: str, health_score: float, health_level: str, level_label: str) -> str:
        """按健康等级生成影响评估文本。"""
        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)
        if health_level == "healthy":
            return f"当前设备运行参数正常（健康分 {health_score:.2f}），未发现明显异常迹象。"
        if health_level == "warning":
            return (
                f"设备处于预警状态（健康分 {health_score:.2f}），「{label}」有持续恶化风险，"
                f"需加强监测。"
            )
        return (
            f"设备已进入异常状态（健康分 {health_score:.2f}），「{label}」可能导致停机或损坏，"
            f"建议尽快处置。"
        )

    def analyze(self, ctx: AgentContext) -> AgentResult:
        """兼容基类接口：需要外部传入 agent_results 时改用 decide()。"""
        return self.decide(ctx, [])


# ---------------------------------------------------------------------------
# Agent 池
# ---------------------------------------------------------------------------
def build_agent_pool() -> list[BaseAgent]:
    """构建会诊 Agent 池（信号分析 / 物理残差 / 故障分类 / 知识检索）。"""
    return [
        SignalAnalysisAgent(),
        PhysicalResidualAgent(),
        FaultDiagnosisAgent(),
        KnowledgeAgent(),
    ]


__all__ = [
    "PhysicalResidualAgent",
    "FaultDiagnosisAgent",
    "DecisionAgent",
    "build_agent_pool",
]
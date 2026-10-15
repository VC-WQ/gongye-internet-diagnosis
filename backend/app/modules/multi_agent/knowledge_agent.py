"""知识检索 Agent：基于故障假设检索知识库，输出引用与维护建议。

输入：故障假设（当前取自 CNN 分类结果 fault_type）。
输出：知识库引用条目 + 对应维护建议，作为决策 Agent 的 knowledge_basis。
"""
from __future__ import annotations

from .base import AgentContext, BaseAgent
from .knowledge_tools import format_citation, load_knowledge_base, retrieve
from .llm_client import llm_client
from .schemas import FAULT_TYPE_LABELS_ZH, AgentResult


class KnowledgeAgent(BaseAgent):
    """知识检索 Agent：按故障假设检索 CWRU 故障模式知识库。"""

    role = "knowledge_retrieval"
    name = "知识检索 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        # 故障假设：以 CNN 分类结果为主假设
        cnn = ctx.anomaly.get("cnn") or {}
        fault_type = str(cnn.get("fault_type", "normal"))

        kb = load_knowledge_base()
        hit = retrieve(fault_type, kb)
        citation = format_citation(hit)
        entry = hit["entry"]
        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)

        recommendation = entry.get("维护建议", "")

        if hit["matched"]:
            conclusion = f"知识库检索到「{label}」故障模式，提供频谱特征与维护依据"
            confidence = 1.0
        else:
            conclusion = f"知识库未检索到「{label}」的故障模式条目"
            confidence = 0.3

        # LLM 综合知识库生成维护建议（失败降级为规则建议）
        if hit["matched"]:
            llm_text = llm_client.chat(
                "你是工业维护知识库专家，只负责基于知识库条目给出维护建议，"
                "不要计算、不要编造数据。",
                f"知识库检索到「{label}」故障模式，条目内容：{citation}。"
                f"请基于此给出 2-3 句具体的维护建议。",
            )
            if llm_text:
                recommendation = llm_text

        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=conclusion,
            fault_type=fault_type,
            confidence=confidence,
            evidence=citation,
            details={
                "kb_entry": entry,
                "matched": hit["matched"],
                "citation": citation,
                "recommendation": recommendation,
            },
        )


__all__ = ["KnowledgeAgent"]
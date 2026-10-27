"""知识检索 Agent：基于故障假设检索知识库，输出引用与维护建议。

输入：故障假设（当前取自 CNN 分类结果 fault_type）。
输出：知识库引用条目 + 对应维护建议，作为决策 Agent 的 knowledge_basis。

检索策略：
1. 优先走向量语义检索（chromadb，见 rag_store），可命中近义/中文表述；
2. chromadb 不可用或索引为空时，降级到 knowledge_tools 的关键词匹配；
3. LLM 综合知识库条目生成维护建议（失败降级为规则建议）。
"""
from __future__ import annotations

from .base import AgentContext, BaseAgent
from .knowledge_tools import format_citation, retrieve
from .llm_client import llm_client
from .rag_store import RagUnavailableError, get_rag_store
from .schemas import FAULT_TYPE_LABELS_ZH, AgentResult


class KnowledgeAgent(BaseAgent):
    """知识检索 Agent：按故障假设检索 CWRU 故障模式知识库（向量优先）。"""

    role = "knowledge_retrieval"
    name = "知识检索 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        # 故障假设：以 CNN 分类结果为主假设
        cnn = ctx.anomaly.get("cnn") or {}
        fault_type = str(cnn.get("fault_type", "normal"))
        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)

        hit, rag_hits, retrieval_mode = self._retrieve(fault_type, label)
        citation = format_citation(hit)
        entry = hit["entry"]
        recommendation = entry.get("维护建议", "")

        if hit["matched"]:
            conclusion = f"知识库{retrieval_mode}命中「{label}」故障模式，提供频谱特征与维护依据"
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
                "retrieval_mode": retrieval_mode,
                "rag_matches": [
                    {
                        "fault_type": r["fault_type"],
                        "score": round(r["score"], 4),
                    }
                    for r in rag_hits[:3]
                ],
            },
        )

    def _retrieve(self, fault_type: str, label: str) -> tuple[dict, list[dict], str]:
        """优先向量语义检索，失败降级关键词匹配。

        Returns:
            (hit, rag_hits, retrieval_mode)
            - hit: 与 knowledge_tools.retrieve 同构的命中结果
            - rag_hits: 向量检索的 top-k 列表（降级时为空）
            - retrieval_mode: "语义检索" / "关键词检索"
        """
        try:
            rs = get_rag_store()
            rag_hits = rs.retrieve(f"{fault_type} {label}", top_k=3)
            if rag_hits:
                best = rag_hits[0]
                return {
                    "fault_type": best["fault_type"],
                    "entry": best["entry"],
                    "matched": True,
                }, rag_hits, "语义检索"
        except RagUnavailableError:
            pass

        hit = retrieve(fault_type)
        return hit, [], "关键词检索"


__all__ = ["KnowledgeAgent"]
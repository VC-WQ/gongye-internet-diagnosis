"""模块5 知识库 RAG 存储：向量化 + 语义检索（chromadb）。

将知识库 Markdown 解析为故障模式条目，切块向量化后写入本地 Chroma，
提供基于向量相似度的语义检索（近似/近义仍能命中），替代原先的纯关键词匹配。

依赖关系与降级：
- chromadb 未安装：抛出 RagUnavailableError，由调用方降级到 knowledge_tools.retrieve。
- 可选中文 embedding：设置环境变量 KB_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
  （需安装 sentence-transformers 并能下载该模型），否则使用 chromadb 内置的
  ONNX 默认 embedding（all-MiniLM-L6-v2，英文，够用但中文语义一般）。
- 下载模型时可设 HF_ENDPOINT=https://hf-mirror.com 加速。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

from .schemas import FAULT_TYPE_LABELS_ZH

logger = logging.getLogger(__name__)

# 知识库文件与向量库持久化目录
KB_FILE = Path(__file__).resolve().parent / "knowledge_base" / "cwru_fault_modes.md"
# backend = parents[3]；data 目录与 DATABASE_URL 同层：<repo>/data/
PERSIST_DIR = Path(__file__).resolve().parents[4] / "data" / "chroma"

COLLECTION_NAME = "fault_knowledge"
FIELDS = ("特征频率公式", "典型频谱特征", "维护建议", "严重度分级")


class RagUnavailableError(Exception):
    """chromadb / embedding 不可用，需降级到关键词检索时抛出。"""


def _load_entries() -> list[dict]:
    """解析知识库，返回 [{fault_type, entry}]（剔除附录类目）。"""
    from .knowledge_tools import load_knowledge_base

    kb = load_knowledge_base()
    entries: list[dict] = []
    for ft, fields in kb.items():
        if not ft or ft.startswith("附"):
            continue
        entries.append({"fault_type": ft, "entry": fields})
    return entries


def _entry_to_text(ft: str, entry: dict) -> str:
    """将结构化条目拼接为可向量化的中文/英文文本。"""
    label = FAULT_TYPE_LABELS_ZH.get(ft, ft)
    parts = [f"{label}（{ft}）故障模式"]
    for field in FIELDS:
        if field in entry:
            parts.append(f"{field}: {entry[field]}")
    return "；".join(parts)


def _load_embedding_function():
    """返回 chromadb 用的 embedding function（可用则中文增强，否则默认 ONNX）。"""
    model_name = os.environ.get("KB_EMBEDDING_MODEL", "").strip()
    if model_name:
        try:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(model_name)

            class _SentenceEF:
                def name(self) -> str:
                    return model_name

                def __call__(self, input: list[str]) -> list[list[float]]:
                    return model.encode(input, normalize_embeddings=True).tolist()

            return _SentenceEF()
        except Exception as e:  # noqa: BLE001
            logger.warning("中文 embedding 加载失败，回退 chromadb 默认 embedding: %s", e)

    from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

    return DefaultEmbeddingFunction()


class RAGStore:
    """知识库向量存储：建索引与语义检索。"""

    def __init__(self) -> None:
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings
        except ImportError as e:  # noqa: BLE001
            raise RagUnavailableError("chromadb 未安装，无法使用向量检索") from e

        self._client = chromadb.PersistentClient(
            path=str(PERSIST_DIR),
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self._collection = self._client.get_or_create_collection(
            name=COLLECTION_NAME, embedding_function=_load_embedding_function()
        )

    # ------------------------------------------------------------------
    # 建索引
    # ------------------------------------------------------------------
    def build_index(self) -> int:
        """解析知识库并重建向量索引，返回入库条目数。"""
        entries = _load_entries()
        if not entries:
            return 0

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []
        for item in entries:
            ft = item["fault_type"]
            entry = item["entry"]
            ids.append(ft)
            documents.append(_entry_to_text(ft, entry))
            metadatas.append({
                "fault_type": ft,
                "entry_json": json.dumps(entry, ensure_ascii=False),
            })

        # 重建：先清空再写入，保证 embedding_function 变更后仍一致
        existing = self._collection.get()
        if existing and existing.get("ids"):
            self._collection.delete(ids=existing["ids"])
        if ids:
            self._collection.add(ids=ids, documents=documents, metadatas=metadatas)
        return len(ids)

    def ensure_index(self) -> None:
        """若索引为空则自动建库。"""
        if self._collection.count() == 0:
            self.build_index()

    # ------------------------------------------------------------------
    # 语义检索
    # ------------------------------------------------------------------
    def retrieve(self, query: str, top_k: int = 3) -> list[dict]:
        """按查询文本做向量相似度检索，返回命中条目列表。

        Returns:
            [{fault_type, entry, score, matched: True}]，按相似度从高到低。
        """
        self.ensure_index()
        if self._collection.count() == 0:
            return []

        result = self._collection.query(query_texts=[query], n_results=top_k)

        hits: list[dict] = []
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        for i, doc_id in enumerate(ids):
            meta = metadatas[i] if i < len(metadatas) else {}
            entry: dict = {}
            try:
                entry = json.loads(meta.get("entry_json", "{}"))
            except (json.JSONDecodeError, TypeError):
                entry = {}
            # chromadb 返回距离（越小越相似），转为 0~1 相似度
            dist = distances[i] if i < len(distances) else 0.0
            score = max(0.0, 1.0 - float(dist))
            hits.append({
                "fault_type": meta.get("fault_type", doc_id),
                "entry": entry,
                "document": documents[i] if i < len(documents) else "",
                "score": score,
                "matched": True,
            })
        return hits


# 模块级惰性单例
_rag_store: Optional[RAGStore] = None


def get_rag_store() -> RAGStore:
    """获取（惰性初始化）RAG 存储单例；不可用时抛 RagUnavailableError。"""
    global _rag_store
    if _rag_store is None:
        _rag_store = RAGStore()
    return _rag_store


__all__ = [
    "RAGStore",
    "RagUnavailableError",
    "get_rag_store",
    "PERSIST_DIR",
    "COLLECTION_NAME",
]
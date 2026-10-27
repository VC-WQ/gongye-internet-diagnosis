"""RAG 索引构建脚本。

用法（在 backend 目录下执行）：
    python scripts/build_rag_index.py

功能：解析知识库 Markdown，向量化后写入本地 Chroma（data/chroma/），
并附带一次检索自测，方便部署/评审前确认向量检索可用。
"""
from __future__ import annotations

import sys
from pathlib import Path

# 将 backend 目录加入 sys.path，以便 import app 包
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.multi_agent.rag_store import RagUnavailableError, get_rag_store  # noqa: E402


def main() -> int:
    try:
        store = get_rag_store()
    except RagUnavailableError as e:
        print(f"[跳过] {e}")
        print("提示：pip install chromadb 后重试；或由后端在运行时降级到关键词检索。")
        return 1

    n = store.build_index()
    print(f"RAG 索引构建完成，共 {n} 条知识条目。")

    print("\n检索自测（query='内圈故障 inner_race'）：")
    hits = store.retrieve("内圈故障 inner_race", top_k=3)
    for h in hits:
        print(f"  - {h['fault_type']:>12}  score={h['score']:.4f}")
    if not hits:
        print("  （无命中，请检查 embedding 模型与索引）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
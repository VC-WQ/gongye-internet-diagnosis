"""知识检索工具：基于关键词匹配的知识库检索（不做向量库）。

知识库为 Markdown 文件，每个故障类型以 `## fault_type` 标题分隔，
字段用 `字段名: 值` 形式书写，本模块按标题与字段名解析。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

# 知识库文件路径（相对本模块所在目录）
KB_FILE = Path(__file__).resolve().parent / "knowledge_base" / "cwru_fault_modes.md"


def _parse_kb(text: str) -> dict[str, dict[str, str]]:
    """解析 Markdown 知识库，返回 {fault_type: {字段: 值}}。"""
    entries: dict[str, dict[str, str]] = {}
    current: Optional[str] = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            current = stripped[3:].strip()
            entries[current] = {}
        elif current is not None and ":" in stripped and not stripped.startswith(("#", "-", ">")):
            # 兼容 "- 字段: 值" 与 "字段: 值" 两种写法
            body = stripped[2:].strip() if stripped.startswith("- ") else stripped
            if ":" in body:
                key, value = body.split(":", 1)
                entries[current][key.strip()] = value.strip()
    return entries


def load_knowledge_base(path: Optional[Path] = None) -> dict[str, dict[str, str]]:
    """加载并解析知识库文件。"""
    p = Path(path) if path is not None else KB_FILE
    if not p.exists():
        return {}
    return _parse_kb(p.read_text(encoding="utf-8"))


def retrieve(
    fault_type: str,
    kb: Optional[dict[str, dict[str, str]]] = None,
) -> dict:
    """按故障类型检索知识条目（精确匹配 -> 关键词模糊匹配）。

    Returns:
        {"fault_type": str, "entry": {...}, "matched": bool}
    """
    if kb is None:
        kb = load_knowledge_base()

    # 精确匹配
    if fault_type in kb:
        return {"fault_type": fault_type, "entry": kb[fault_type], "matched": True}

    # 关键词模糊匹配（子串包含）
    for key in kb:
        if key in fault_type or fault_type in key:
            return {"fault_type": key, "entry": kb[key], "matched": True}

    return {"fault_type": fault_type, "entry": {}, "matched": False}


def format_citation(hit: dict) -> str:
    """将检索结果格式化为引用文本。"""
    if not hit.get("matched"):
        return f"知识库未检索到 {hit.get('fault_type')} 的故障模式条目。"
    entry = hit["entry"]
    parts = [f"故障类型「{hit['fault_type']}」知识库引用："]
    for field in ("特征频率公式", "典型频谱特征", "维护建议", "严重度分级"):
        if field in entry:
            parts.append(f"  - {field}: {entry[field]}")
    return "\n".join(parts)


__all__ = ["load_knowledge_base", "retrieve", "format_citation", "KB_FILE"]
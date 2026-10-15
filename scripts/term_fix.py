"""全文术语统一修正（大纲附录 D）+ 图表规范说明注入。"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(r"D:\企业云系统\工业互联网系统\docs\论文正文")
files = sorted(DOCS.glob("第*.md")) + [DOCS / "结论与展望.md"]
out: list[str] = []
w = out.append

REPL = [
    # (原, 新, 否定前缀, 说明)
    ("冲突度量", "冲突系数量化", "", "冲突度量 -> 冲突系数量化"),
    ("冲突度", "冲突系数 $K$", "冲突度量", "冲突度 -> 冲突系数 $K$"),
    ("物理先验", "物理频率先验", "", "物理先验 -> 物理频率先验"),
    ("剩余使用寿命预测", "剩余寿命预测", "", "剩余使用寿命预测 -> 剩余寿命预测"),
    ("寿命预测", "剩余寿命预测", "剩余", "寿命预测 -> 剩余寿命预测"),
    ("AI 诊断工作台", "智能会诊工作台", "", "AI 诊断工作台 -> 智能会诊工作台"),
]

w("=== 术语修正明细 ===")
grand = 0
for f in files:
    t = f.read_text(encoding="utf-8")
    orig = t
    detail = []
    for old, new, prefix, desc in REPL:
        pat = r"(?<!" + re.escape(prefix) + r")" + re.escape(old) if prefix else re.escape(old)
        n = len(re.findall(pat, t))
        if n:
            t = re.sub(pat, new, t)
            detail.append(f"{desc} x{n}")
            grand += n
    if t != orig:
        f.write_text(t, encoding="utf-8")
    w(f"  {'OK' if detail else '--'} {f.name}")
    for d in detail:
        w(f"       {d}")
w(f"  合计修正 {grand} 处")
w("")

# ---- 术语复核 ----
w("=== 复核（应全部 OK）===")
BANNED = [
    ("会诊系统", ""), ("诊断面板", ""), ("AI 诊断", ""), ("AI诊断", ""),
    ("多Agent", ""), ("多 Agent", ""), ("多代理", ""), ("多agent", ""),
    ("剩余使用时间", ""), ("寿命预测", "剩余"), ("平均准确率", "宏"),
    ("平均精度", ""), ("冲突度", "冲突度量"), ("冲突值", ""),
    ("物理先验", ""), ("频率先验", "物理"),
]
bad_total = 0
for f in files:
    t = f.read_text(encoding="utf-8")
    hits = []
    for bad, prefix in BANNED:
        pat = r"(?<!" + re.escape(prefix) + r")" + re.escape(bad) if prefix else re.escape(bad)
        n = len(re.findall(pat, t))
        if n:
            hits.append(f"{bad} x{n}")
    bad_total += len(hits)
    w(f"  {'!! ' + str(hits) if hits else 'OK  ' + f.name}")
w(f"  复核剩余违规 {bad_total} 处")
w("")

# ---- 注入图表制作规范 ----
NOTE = (
    "\n> **图表制作规范（全文统一）**：表题置于表格上方，图题置于图片下方，均采用"
    "“表 N-M　内容”/“图 N-M　内容”的格式并居中；表格一律使用三线表（顶线、栏目线、"
    "底线，无竖线）；系统截图须清晰、带边框，并在关键处加箭头或方框标注。"
    "本章各图表的数据来源见上表“来源”列，全部取自 `backend/app/data/` 下的实测结果，"
    "不得另行编造数字。\n"
)
w("=== 图表规范说明注入 ===")
for f in files:
    t = f.read_text(encoding="utf-8")
    if "图表制作规范（全文统一）" in t:
        w(f"  -- {f.name}：已存在")
        continue
    # 找到“本章图表索引”或“图表索引”小节，注入到其末尾
    m = list(re.finditer(r"\n(?:##\s*本章图表索引|##\s*图表索引)\n", t))
    if not m:
        w(f"  !! {f.name}：未找到图表索引小节，跳过")
        continue
    last = m[-1]
    # 注入到文件末尾（该小节通常是最后一节）
    t = t.rstrip("\n") + "\n" + NOTE
    f.write_text(t, encoding="utf-8")
    w(f"  OK {f.name}")

(Path(r"D:\企业云系统\工业互联网系统\scripts") / "_term_fix.txt").write_text(
    "\n".join(out), encoding="utf-8"
)
print("done")

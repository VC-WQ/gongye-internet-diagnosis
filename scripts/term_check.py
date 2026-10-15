"""全文术语统一性检查（大纲附录 D 强制一致）+ 专业硕士要求项核查。"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(r"D:\企业云系统\工业互联网系统\docs\论文正文")
files = sorted(DOCS.glob("第*.md")) + [DOCS / "结论与展望.md"]
out: list[str] = []
w = out.append

BANNED = [
    ("会诊系统", "智能会诊", ""),
    ("诊断面板", "智能会诊", ""),
    ("AI 诊断", "智能会诊", ""),
    ("AI诊断", "智能会诊", ""),
    ("多Agent", "多智能体", ""),
    ("多 Agent", "多智能体", ""),
    ("多代理", "多智能体", ""),
    ("多agent", "多智能体", ""),
    ("剩余使用时间", "剩余寿命（RUL）", ""),
    ("寿命预测", "剩余寿命（RUL）预测", "剩余"),
    ("平均准确率", "目标域宏平均准确率", "宏"),
    ("平均精度", "目标域宏平均准确率", ""),
    ("冲突度", "冲突系数 K", ""),
    ("冲突值", "冲突系数 K", ""),
    ("物理先验", "物理频率先验", ""),
    ("频率先验", "物理频率先验", "物理"),
]

w("=== 1. 术语统一性（大纲附录 D，已排除子串误报）===")
total_hits = 0
for f in files:
    t = f.read_text(encoding="utf-8")
    hits = []
    for bad, good, prefix in BANNED:
        # 否定式环视：bad 前不得紧跟 prefix（否则是合法词的一部分）
        pat = r"(?<!" + re.escape(prefix) + r")" + re.escape(bad) if prefix else re.escape(bad)
        n = len(re.findall(pat, t))
        if n:
            hits.append(f"{bad!r} x{n}（应为：{good}）")
    total_hits += len(hits)
    w(f"  {'!!' if hits else 'OK'} {f.name}")
    for h in hits:
        w(f"       {h}")
w(f"  合计违规 {total_hits} 处")
w("")

w("=== 2. 图表规范性要求项（大纲附录 C 第 4 条）===")
for f in files:
    t = f.read_text(encoding="utf-8")
    # 图题在图片下方、表题在表格上方：本工程为 md 源稿，检查是否已在索引/正文给出明确规范说明
    has_note = ("图题在图片下方" in t) or ("表题在表格上方" in t) or ("三线表" in t)
    w(f"  {'OK ' if has_note else '--'} {f.name}：{'已含图表规范说明' if has_note else '未含'}")
w("")

w("=== 3. 专业硕士要求项（大纲附录 C 第 1~3 条）===")
concl = (DOCS / "结论与展望.md").read_text(encoding="utf-8")
w(f"  [C3] 结论含'应用价值与社会经济效益'表述：{'是' if ('应用价值' in concl or '经济效益' in concl) else '否'}")
ch8 = (DOCS / "第8章-系统实现与功能验证.md").read_text(encoding="utf-8")
w(f"  [C1] 第8章系统实现分量：{len(ch8)} 字符，{'充足' if len(ch8) > 20000 else '偏薄'}")
ch2 = (DOCS / "第2章-相关理论与技术基础.md").read_text(encoding="utf-8")
thm = len(re.findall(r"定理|引理|推论", ch2))
w(f"  [C2] 第2章定理/引理/推论数量：{thm}（专业硕士应为 0~少量，不追求数学完备性）")
w("")

w("=== 4. 篇幅汇总 ===")
for f in files:
    t = f.read_text(encoding="utf-8")
    cn = len(re.findall(r"[一-鿿]", t))
    w(f"  {f.name}: {cn} 汉字 / {t.count(chr(10)) + 1} 行")

(DOCS.parent.parent / "scripts" / "_term_check.txt").write_text("\n".join(out), encoding="utf-8")
print("done")

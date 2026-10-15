"""第 1 章正文终检：篇幅、待补引文统计、与第 4~8 章关键数字的一致性。"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(r"D:\企业云系统\工业互联网系统")
DOCS = ROOT / "docs" / "论文正文"
P = DOCS / "第1章-绪论.md"
t = P.read_text(encoding="utf-8")
lines = t.split("\n")
out: list[str] = []
w = out.append

# ---- 1. 篇幅 ----
cn = len(re.findall(r"[一-鿿]", t))
w("=== 1. 篇幅 ===")
w(f"  行数 {len(lines)}  汉字 {cn}  非空字符 {len(re.sub(chr(92) + 's', '', t))}")
w("")

# ---- 2. 结构 ----
w("=== 2. 章节结构 ===")
for k, line in enumerate(lines, 1):
    if re.match(r"^#{2,3} ", line):
        w(f"  L{k}  {line.strip()}")
w("")

# ---- 3. 待补引文 ----
cites = re.findall(r"【待补引文：(.+?)】", t)
w("=== 3. 待补引文清单 ===")
w(f"  共 {len(cites)} 处")
for i, c in enumerate(cites, 1):
    w(f"   {i:>2}. {c}")
w("")

# ---- 4. 关键数字跨章一致性 ----
# (描述, 出现在第1章的字符串, 该数字应出现的章节文件)
KEYS = [
    ("第4章 噪声提升 4.41pp", ["4.41 个百分点"], ["第4章"]),
    ("第4章 频带偏差 0.57~2.74", ["0.57~2.74 个频点"], ["第4章"]),
    ("第4章 FTF 漂移 11.93→81.40", ["11.93 Hz", "81.40 Hz"], ["第4章"]),
    ("第4章 天花板 1.0000", ["1.0000"], ["第4章"]),
    ("第5章 R2 -1.1966 → +0.1063", ["−1.1966", "0.1063"], ["第5章"]),
    ("第5章 RMSE/MAE 降幅", ["36.21", "37.38"], ["第5章"]),
    ("第5章 同构 KF -0.3295", ["−0.3295"], ["第5章"]),
    ("第5章 8/15", ["8 根优于基线"], ["第5章"]),
    ("第5章 PICP 49.26", ["49.26"], ["第5章"]),
    ("第6章 降级 0.2515→0.6194", ["0.2515", "0.6194", "36.79"], ["第6章"]),
    ("第6章 5dB 0.3796→0.4960", ["0.3796", "0.4960"], ["第6章"]),
    ("第6章 K 序列", ["0.0035", "0.0490", "0.1264"], ["第6章"]),
    ("第7章 V0 0.2695", ["0.2695"], ["第7章"]),
    ("第7章 CORAL 0.6322", ["0.6322", "0.8219"], ["第7章"]),
    ("第7章 DANN 0.6361", ["0.6361", "0.7501"], ["第7章"]),
    ("第7章 增益损失比", ["2.04", "1.47"], ["第7章"]),
    ("第7章 V3 +1.56pp", ["1.56 个百分点", "5.16 个百分点"], ["第7章"]),
    ("第8章 模块/接口", ["16 个功能模块", "73 个接口"], ["第8章"]),
    ("第8章 时延", ["4.601 ms", "145.0 ms"], ["第8章"]),
    ("第8章 用例数", ["13 个用例"], ["第8章"]),
]

w("=== 4. 关键数字跨章一致性 ===")
allfiles = {p.name: p.read_text(encoding="utf-8") for p in DOCS.glob("第*.md")}
for desc, needles, chapters in KEYS:
    in_ch1 = all(n in t for n in needles)
    src = []
    for ch in chapters:
        f = next((v for k, v in allfiles.items() if k.startswith(ch)), None)
        if f is None:
            src.append(f"{ch}:文件缺失")
            continue
        miss = [n for n in needles if n not in f]
        src.append(f"{ch}:{'全部命中' if not miss else '缺' + str(miss)}")
    flag = "OK " if in_ch1 and all("缺" not in s for s in src) else "!! "
    w(f"  {flag}{desc}")
    w(f"      第1章命中={in_ch1}  {' | '.join(src)}")
w("")

# ---- 5. 表图 ----
w("=== 5. 表图 ===")
p_def = r"\*\*表\s*(1-\d+)"
p_ref = r"表\s*(1-\d+)"
p_fig = r"图\s*(1-\d+)"
w(f"  表定义: {sorted(set(re.findall(p_def, t)))}")
w(f"  表引用: {sorted(set(re.findall(p_ref, t)))}")
w(f"  图引用: {sorted(set(re.findall(p_fig, t)))}")

(ROOT / "scripts" / "_ch1_check.txt").write_text("\n".join(out), encoding="utf-8")
print("done")

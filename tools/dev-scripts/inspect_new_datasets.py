# -*- coding: utf-8 -*-
"""检查新下载的5个数据集实际结构，判断可用性"""
import os
import csv

BASE = r"d:\企业云系统\工业互联网系统\datasets"

targets = [
    ("机器故障数据集", "机器故障数据集/data.csv", None),
    ("电弧炉运行数据", "电弧炉运行数据/data.csv", None),
    ("工业制造缺陷预测", "工业制造缺陷预测数据集/manufacturing_defect_dataset.csv", None),
    ("工业安全与健康(基础)", "工业安全与健康分析数据/IHMStefanini_industrial_safety_and_health_database.csv", None),
    ("工业安全与健康(含事故描述)", "工业安全与健康分析数据/IHMStefanini_industrial_safety_and_health_database_with_accidents_description.csv", None),
]

for name, rel, _ in targets:
    path = os.path.join(BASE, rel)
    print("\n" + "=" * 70)
    print(f"### {name}")
    print(f"路径: {rel}")
    size = os.path.getsize(path)
    print(f"大小: {size:,} 字节 ({size/1024:.1f} KB)")
    # 检测分隔符
    with open(path, encoding="utf-8", errors="replace") as f:
        first_line = f.readline().rstrip("\n")
    delim = "," if first_line.count(",") > first_line.count(";") else ";"
    if "\t" in first_line and first_line.count("\t") >= 2:
        delim = "\t"
    with open(path, encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f, delimiter=delim)
        header = next(reader)
        rows = 0
        sample = None
        # 收集类别列取值（最后1-2列若是小类别）
        from collections import Counter
        last_col_counter = Counter()
        for row in reader:
            rows += 1
            if sample is None:
                sample = row
            last_col_counter[row[-1]] += 1
    print(f"分隔符: {delim!r}")
    print(f"数据行数: {rows:,}")
    print(f"列数: {len(header)}")
    print(f"列名: {header}")
    if sample:
        print(f"首行样例: {sample}")
    # 打印类别分布（若取值种类少）
    if len(last_col_counter) <= 10:
        print(f"末列取值分布: {dict(last_col_counter)}")
    else:
        print(f"末列取值种类: {len(last_col_counter)}（连续/多值，非简单类别）")
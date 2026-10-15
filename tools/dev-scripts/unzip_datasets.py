# -*- coding: utf-8 -*-
"""解压并校验新下载的两个 Kaggle 数据集"""
import zipfile
import os

BASE = r"d:\企业云系统\工业互联网系统\datasets"

jobs = [
    ("DigitalTwin", "digital_twin_bundle.zip"),
    ("SmartFactory", "smart_factory_bundle.zip"),
]

for folder, zip_name in jobs:
    folder_path = os.path.join(BASE, folder)
    zip_path = os.path.join(folder_path, zip_name)
    print(f"\n===== {folder} =====")
    print(f"zip 大小: {os.path.getsize(zip_path)/1024/1024:.2f} MB")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        print(f"压缩包内文件数: {len(names)}")
        for n in names[:30]:
            info = zf.getinfo(n)
            print(f"  {info.file_size:>12,}  {n}")
        if len(names) > 30:
            print(f"  ... 其余 {len(names)-30} 个文件省略")
        zf.extractall(folder_path)
        print("解压完成")

    # 找 csv 预览表头与行数
    import csv
    for n in names:
        if n.lower().endswith(".csv"):
            csv_path = os.path.join(folder_path, n)
            with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = 0
                sample = None
                for row in reader:
                    rows += 1
                    if sample is None:
                        sample = row
            print(f"\nCSV: {n}")
            print(f"  数据行数: {rows:,}")
            print(f"  列数: {len(header)}")
            print(f"  列名: {header}")
            if sample:
                print(f"  首行样例: {sample}")
            break

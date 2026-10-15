# -*- coding: utf-8 -*-
"""解压并校验 NEU-DET 数据集"""
import zipfile
import os

BASE = r"d:\企业云系统\工业互联网系统\datasets\NEU-DET"
zip_path = os.path.join(BASE, "neu_det_bundle.zip")

print(f"zip 大小: {os.path.getsize(zip_path)/1024/1024:.2f} MB")
with zipfile.ZipFile(zip_path) as zf:
    names = zf.namelist()
    print(f"压缩包内文件数: {len(names)}")
    print("前 12 个条目:")
    for n in names[:12]:
        print("  ", n)
    # 统计目录
    top_dirs = set()
    for n in names:
        parts = n.split("/")
        if len(parts) > 1:
            top_dirs.add(parts[0])
    print(f"顶层目录: {top_dirs}")
    zf.extractall(BASE)
    print("解压完成")

# 列一级子目录内容
for d in os.listdir(BASE):
    p = os.path.join(BASE, d)
    if os.path.isdir(p):
        files = os.listdir(p)
        print(f"\n目录 {d}: {len(files)} 个条目, 样例: {files[:3]}")
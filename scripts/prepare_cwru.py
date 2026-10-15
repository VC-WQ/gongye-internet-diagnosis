# scripts/prepare_cwru.py
"""
CWRU 数据已下载并打包完成，本脚本只做：
  加载 .npz → 切滑窗 → 保存处理好的 processed.npz

用法: python scripts/prepare_cwru.py
"""

import sys
from pathlib import Path

import numpy as np
import cwru


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR  = PROJECT_ROOT / "datasets" / "CWRU"
NPZ_FILE     = DATASET_DIR / "CWRU12Ingested.npz"
PROCESSED    = DATASET_DIR / "processed.npz"

if not NPZ_FILE.exists():
    print(f"❌ 找不到 {NPZ_FILE}，请先跑 download_cwru.py 完成下载和打包。")
    sys.exit(1)

print("=" * 65)
print(f"加载: {NPZ_FILE}")
print(f"大小: {NPZ_FILE.stat().st_size / 1e6:.1f} MB")
print("=" * 65)


# ============== 关键修正：返回 3+3，不是 2+4 ==============
print("\n切滑窗（window=2048, step=512, 单通道 DE）...")
(X, Y, file_ids), (severity, horsepower, location) = cwru.load(
    npz_path=str(NPZ_FILE),
    window_size=2048,         # 每窗 2048 点（约 0.17s @12kHz）
    step_size=512,            # 25% 重叠
    sensors=["DE"],           # 驱动端加速度（唯一在 4 类上都齐全的通道）
    strategy="standard",      # 只用 normal + DE 故障（不含 FE）
    fault_category="only types",  # 粗分类：Normal / IR / OR / Ball
)

print(f"\n✅ X         : {X.shape}   dtype={X.dtype}")
print(f"✅ Y         : {Y.shape}   dtype={Y.dtype}")
print(f"✅ file_ids  : {file_ids.shape}")

print("\n类别分布：")
unique, counts = np.unique(Y, return_counts=True)
for u, c in sorted(zip(unique, counts), key=lambda x: -x[1]):
    print(f"  {str(u):>8s} : {c:>6d}  ({c / len(Y) * 100:.1f}%)")


# ============== 保存 ==============
np.savez_compressed(
    PROCESSED,
    X=X, Y=Y, file_ids=file_ids,
    severity=severity, horsepower=horsepower, location=location,
)

print(f"\n✅ 已保存处理好的训练数据: {PROCESSED}")
print(f"   TRAE 的 data_loader.py 可直接:")
print(f"   data = np.load('{PROCESSED}')")
print(f"   X = data['X']   # (N, 1, 2048)")
print(f"   Y = data['Y']   # (N,)")

print("\n" + "=" * 65)
print("下一步：告诉 TRAE 数据已就位，让它写训练脚本。")
print("=" * 65)
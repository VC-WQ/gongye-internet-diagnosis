# scripts/download_cwru.py
"""
CWRU 数据集下载 → 打包 → 切片 完整流水线。

用法（在项目根目录）:
    python scripts/download_cwru.py
"""

import sys
from pathlib import Path

import numpy as np

# 前置依赖说明：本脚本是「数据集下载与打包」的研究/复现脚本，需要外部 `cwru`
# Python 包提供的 download/ingest/load 接口。该包不是公开 PyPI 包，也未列入
# backend/requirements.txt，仅存在于原始参考环境。正式训练与推理链路
# （backend/app/modules/anomaly_detect/train_cnn.py + data_loader.py）只依赖
# 交付包内已生成的 datasets/CWRU/processed.npz，不依赖本脚本。
try:
    import cwru
except ImportError:
    print(
        "缺少外部依赖：`cwru` 包（提供 download/ingest/load）。\n"
        "本脚本仅用于从 CWRU 官方原始 .mat 文件重新构建数据集，不是首次安装步骤。\n"
        "若需要复现数据准备，请先在官方轴承数据中心（Case Western Bearing Data Center）\n"
        "手动下载 12kHz 驱动端(DE)原始 .mat 文件，并将其放入 datasets/CWRU/RawFiles/，\n"
        "再在安装了兼容 cwru 包的环境中运行本脚本。当前交付包已直接提供 processed.npz，\n"
        "无需执行本脚本。",
        file=sys.stderr,
    )
    sys.exit(1)


# ==================== 路径规划 ====================
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR  = PROJECT_ROOT / "datasets" / "CWRU"
RAW_DIR      = DATASET_DIR / "RawFiles"                 # 原始 .mat
NPZ_BASE     = DATASET_DIR / "CWRU12Ingested"           # ingest 输出（不带后缀）
NPZ_FILE     = NPZ_BASE.with_suffix(".npz")             # 实际会生成的 .npz

DATASET_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)

print("=" * 65)
print(f"项目根目录 : {PROJECT_ROOT}")
print(f"数据目录   : {DATASET_DIR}")
print(f"原始 .mat  : {RAW_DIR}")
print(f"打包 .npz  : {NPZ_FILE}")
print("=" * 65)


# ==================== Step 1: 下载原始 .mat ====================
print("\n[Step 1/3] 下载 CWRU 原始 .mat 文件（12kHz）...")
ok = cwru.download(
    CWRUfs=12,                       # 采样率：12kHz（推荐）
    download_path=str(RAW_DIR),      # 下载到项目 datasets/CWRU/RawFiles
    max_retries=10,
    retry_delay=3,
    replace_files=False,             # 已存在的文件跳过
    max_workers=8,                   # 8 线程并发下载
)
if not ok:
    print("❌ 下载失败，请检查网络或重试。")
    sys.exit(1)

mat_files = sorted(RAW_DIR.glob("*.mat"))
print(f"✅ 下载完成：共 {len(mat_files)} 个 .mat 文件")
for f in mat_files[:8]:
    print(f"   - {f.name}")
if len(mat_files) > 8:
    print(f"   ... 还有 {len(mat_files) - 8} 个")


# ==================== Step 2: 打包为 .npz ====================
print("\n[Step 2/3] 打包为统一 .npz 数据库（并行解析 + 结构化元数据）...")
ok = cwru.ingest(
    base_path=str(RAW_DIR),          # 输入：原始 .mat 目录
    output_file_path=str(NPZ_BASE),  # 输出：不带 .npz 后缀（会自动加）
    max_workers=8,
    replace_file=True,               # 覆盖旧的
    dtype=np.float32,                # 省内存，精度足够
)
if not ok:
    print("❌ 打包失败。")
    sys.exit(1)

size_mb = NPZ_FILE.stat().st_size / 1e6
print(f"✅ 打包完成：{NPZ_FILE.name}  ({size_mb:.1f} MB)")


# ==================== Step 3: 加载 + 切片验证 ====================
print("\n[Step 3/3] 加载并切滑窗，验证数据可用性...")
(X, Y), (sev, hp, loc, _) = cwru.load(
    npz_path=str(NPZ_FILE),
    window_size=2048,                # 每窗 2048 点 ≈ 0.17s @12kHz
    step_size=512,                   # 25% 重叠
    sensors=["DE"],                  # 驱动端加速度（CWRU 最常用的通道）
    strategy="standard",             # 只含 normal + DE 故障
    fault_category="only types",     # 粗分类：Normal / IR / OR / Ball
)

print(f"✅ X shape : {X.shape}   # (样本数, 通道数, 窗口长度)")
print(f"✅ Y shape : {Y.shape}")

print("\n类别分布：")
unique, counts = np.unique(Y, return_counts=True)
for u, c in sorted(zip(unique, counts), key=lambda x: -x[1]):
    print(f"   {str(u):>10s} : {c:>6d} 个窗口")

# 顺便保存一份处理好的 X, Y，方便 TRAE 的 data_loader 直接用
PROCESSED = DATASET_DIR / "processed.npz"
np.savez_compressed(PROCESSED, X=X, Y=Y)
print(f"\n✅ 已保存处理好的训练数据: {PROCESSED}")
print(f"   TRAE 的 data_loader.py 可直接: np.load('{PROCESSED}')")

print("\n" + "=" * 65)
print("全部完成。下一步：告诉 TRAE 数据已就位，让它写训练脚本。")
print("=" * 65)
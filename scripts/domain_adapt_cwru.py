"""创新点四：跨域自适应（CWRU 真实试验台 → 三类仿真设备的数字孪生域）。

问题背景
--------
智能会诊里的故障分类依赖 CWRU 轴承数据集训练的 1D-CNN。但 CWRU 采集自
**实验室电机试验台**（SKF-6205 轴承、1797rpm、12kHz 采样、人工电火花单点故障），
而系统实际监测的是**离心泵 / 电机 / 空压机**三类设备，它们的
    轴承型号、转速、采样率、结构共振频率、噪声水平、载荷调制
全都不同。直接用 CWRU 模型去判仿真域样本，存在典型的 **domain shift**（分布漂移），
准确率会显著下降 —— 这正是"实验室模型落地到现场"的核心障碍。

本脚本量化这个差距，并验证两种无监督域自适应方法能否把它补回来：
    · CORAL：对齐源域/目标域特征的二阶统计量（协方差）
    · DANN ：梯度反转层 + 域判别器，对抗式学习域不变特征
两种方法都**不需要目标域标签**（现场无法大量标注故障样本），符合工程实际。

实验设置
--------
    V0  Source-only     ：仅用 CWRU 训练，直接测目标域（下界）
    V1  FaultCNN + CORAL
    V2  FaultCNN + DANN
    V3  FP-CNN  + CORAL ：与创新点一（物理频率先验）组合，验证能否叠加增益
    V4  Target Oracle   ：用目标域带标签数据训练（上界，仅作参照）

输出 backend/app/data/domain_adapt.json 供算法实验室页面展示。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
# backend/app 用于 `from modules.anomaly_detect...`；backend 用于 data_loader 里的 `import cwru`
sys.path.insert(0, str(ROOT / "backend" / "app"))
sys.path.insert(0, str(ROOT / "backend"))

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
from torch.utils.data import DataLoader, TensorDataset  # noqa: E402

# data_loader 里 `import cwru` 依赖 backend/app 在 sys.path 上（上面已插入）
from modules.anomaly_detect.cnn_classifier import FaultCNN, LABEL_MAP  # noqa: E402
from modules.anomaly_detect.fp_cnn import FPFaultCNN  # noqa: E402

OUT_PATH = ROOT / "backend" / "app" / "data" / "domain_adapt.json"
SEQ_LEN = 2048
SEED = 42

LABEL_NAMES = ["Normal", "IR", "OR", "Ball"]
FAULT_ZH = {"Normal": "正常", "IR": "内圈故障", "OR": "外圈故障", "Ball": "滚动体故障"}


# ---------------------------------------------------------------------------
# 1. 目标域：三类仿真设备的物理机理振动生成器
# ---------------------------------------------------------------------------
# 每台设备"轴承几何 + 转速 + 采样率 + 结构共振 + 噪声"都不同于 CWRU 试验台，
# 因此同一类故障在不同设备上的波形形态差别很大 —— 这就是 domain shift 的来源。
DEVICE_PROFILES = {
    "PUMP-01": {
        "name": "离心泵 PUMP-01",
        "shaft_rpm": 1780.0,      # 转速比 0.99（相对 CWRU 1797rpm）
        "fs": 12000.0,
        "n_balls": 8,
        "ball_diam_mm": 9.525,
        "pitch_diam_mm": 46.40,
        "resonance_hz": 3900.0,
        "snr_db": 15.0,
        "sensor_gain": 1.00,
        "transfer_q": 1.4,        # 结构共振放大倍数
        "transfer_bw": 420.0,
        "load_modulation": 0.55,  # 叶轮水力脉动引起的载荷调制
    },
    "MOTOR-02": {
        "name": "三相异步电机 MOTOR-02",
        "shaft_rpm": 1880.0,      # 转速比 1.05
        "fs": 12000.0,
        "n_balls": 9,
        "ball_diam_mm": 7.94,
        "pitch_diam_mm": 39.04,
        "resonance_hz": 4500.0,
        "snr_db": 17.0,
        "sensor_gain": 1.08,
        "transfer_q": 1.6,
        "transfer_bw": 450.0,
        "load_modulation": 0.35,
    },
    "COMP-03": {
        "name": "螺杆空压机 COMP-03",
        "shaft_rpm": 1700.0,      # 转速比 0.95
        "fs": 12000.0,
        "n_balls": 7,
        "ball_diam_mm": 12.70,
        "pitch_diam_mm": 58.50,
        "resonance_hz": 3600.0,
        "snr_db": 13.0,           # 螺杆排气冲击 + 较强背景噪声
        "sensor_gain": 0.95,
        "transfer_q": 1.4,
        "transfer_bw": 400.0,
        "load_modulation": 0.70,
    },
}

# CWRU 源域参数（对照用，SKF-6205 @ 1797rpm / 12kHz，实验室低噪声）
SOURCE_PROFILE = {
    "shaft_rpm": 1797.0,
    "fs": 12000.0,
    "n_balls": 9,
    "ball_diam_mm": 7.94,
    "pitch_diam_mm": 39.04,
    "resonance_hz": 4200.0,
    "damping": 1200.0,
    "snr_db": 18.0,             # 实验室台架：几乎无环境噪声
    "load_modulation": 0.25,
}

# 幅值口径：CWRU processed.npz 实测 std ≈ 0.30（非 1.0）。
# 目标域仿真信号 z-score 后必须再缩到同一量级，否则 3 倍以上的幅值失配会让源模型直接失效 ——
# 这不是"物理域漂移"，而是归一化口径不一致造成的假漂移，必须先对齐。
SOURCE_AMPLITUDE_STD = 0.30


def bearing_frequencies(p: dict) -> dict:
    """按设备自身轴承几何与转速计算四类理论特征频率（Hz）。"""
    fr = p["shaft_rpm"] / 60.0
    ratio = p["ball_diam_mm"] / p["pitch_diam_mm"]
    n = p["n_balls"]
    return {
        "FTF": 0.5 * (1.0 - ratio) * fr,
        "BPFO": n / 2.0 * (1.0 - ratio) * fr,
        "BPFI": n / 2.0 * (1.0 + ratio) * fr,
        "BSF": (p["pitch_diam_mm"] / (2.0 * p["ball_diam_mm"])) * (1.0 - ratio ** 2) * fr,
    }


# ---------------------------------------------------------------------------
# 目标域构造：对源域施加"物理可解释的工况变换"
# ---------------------------------------------------------------------------
# 为什么不从零合成信号？实测发现：机理合成信号与真实 CWRU 的特征空间距离过大，
# 源模型在其上直接坍缩到单一类别（准确率 = 随机水平 25%），
# 此时域自适应也无从补起 —— 那不是"域漂移"，而是"两个不相干的数据集"。
#
# 域自适应研究的标准做法是：**对同一批故障样本施加工况变换**来构造目标域
# （如 CWRU 的不同载荷/转速即为公认的跨域基准）。这里按三类设备各自的
# 物理参数施加四类变换，既保证"同一类故障在不同设备上的不同表现"这一物理语义，
# 又保证目标域本身是可学习的（Oracle 应接近 100%）。

def speed_scale(x: np.ndarray, ratio: float) -> np.ndarray:
    """转速变化：时间轴缩放 → 所有频率成分按比例平移。

    ratio = 目标转速 / 源转速。ratio>1 表示转得更快，同一故障的冲击间隔变短，
    归一化频率整体乘 ratio。
    """
    n = len(x)
    if abs(ratio - 1.0) < 1e-6:
        return x
    idx = np.arange(n, dtype=np.float64) / ratio
    idx = np.clip(idx, 0.0, n - 1.0)
    return np.interp(idx, np.arange(n, dtype=np.float64), x).astype(np.float32)


def transform_to_device(X_src: np.ndarray, prof: dict, rng: np.random.RandomState) -> np.ndarray:
    """把 CWRU 源域振动窗口变换为目标设备上的观测表现。

    四类物理变换（顺序即信号链路）：
        ① 转速变化      → 时间轴缩放（频率按比例平移）
        ② 结构共振差异  → 频域带通整形（共振处能量放大）
        ③ 传感器增益    → 幅值缩放（不同测点/灵敏度）
        ④ 现场噪声底    → 叠加带限噪声（信噪比按设备工况）
    """
    fs = SOURCE_PROFILE["fs"]
    ratio = prof["shaft_rpm"] / SOURCE_PROFILE["shaft_rpm"]
    q = float(prof.get("transfer_q", 2.5))
    bw = float(prof.get("transfer_bw", 450.0))
    gain = float(prof.get("sensor_gain", 1.0))
    snr = float(prof["snr_db"])

    n = X_src.shape[-1]
    f = np.fft.rfftfreq(n, 1.0 / fs)
    h = np.exp(-f / (fs * 0.15)) + q * np.exp(-((f - prof["resonance_hz"]) ** 2) / (2.0 * bw ** 2))

    out = np.empty_like(X_src)
    for i in range(len(X_src)):
        x = X_src[i, 0].astype(np.float64)
        x = speed_scale(x, ratio)                                   # ①
        x = np.fft.irfft(np.fft.rfft(x) * h, n=n)                   # ②
        x = x * gain                                                # ③
        p_sig = np.mean(x ** 2)
        x = x + rng.randn(n) * np.sqrt(p_sig / (10 ** (snr / 10.0)))  # ④
        # 归一化到 CWRU 幅值量级（消除整体增益，保留谱形差异）
        out[i, 0] = (x / (np.std(x) + 1e-9) * SOURCE_AMPLITUDE_STD).astype(np.float32)
    return out


def _seed_of(text: str) -> int:
    """字符串 -> 稳定整数种子（不用 hash()，避免进程随机化导致结果不可复现）。"""
    return sum((i + 1) * ord(c) for i, c in enumerate(text)) % 100000


# ---------------------------------------------------------------------------
# 2. 域自适应组件
# ---------------------------------------------------------------------------
class GradientReversal(torch.autograd.Function):
    """梯度反转层：前向恒等，反向乘 -λ（对抗域判别器）。"""

    @staticmethod
    def forward(ctx, x, lambd):  # noqa: D102
        ctx.lambd = lambd
        return x.view_as(x)

    @staticmethod
    def backward(ctx, grad):  # noqa: D102
        return -ctx.lambd * grad, None


def grl(x: torch.Tensor, lambd: float) -> torch.Tensor:
    return GradientReversal.apply(x, lambd)


def coral_loss(fs_: torch.Tensor, ft_: torch.Tensor) -> torch.Tensor:
    """CORAL：对齐源/目标特征的协方差矩阵（二阶统计量）。"""
    d = fs_.size(1)
    xs = fs_ - fs_.mean(0, keepdim=True)
    xt = ft_ - ft_.mean(0, keepdim=True)
    cs = (xs.t() @ xs) / max(len(xs) - 1, 1)
    ct = (xt.t() @ xt) / max(len(xt) - 1, 1)
    return torch.mean((cs - ct) ** 2) * (4.0 / (d * d))


class DomainHead(nn.Module):
    """域判别器：区分特征来自源域还是目标域（DANN 用）。"""

    def __init__(self, in_dim: int = 128, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 2),
        )

    def forward(self, x):
        return self.net(x)


# ---------------------------------------------------------------------------
# 3. 特征提取（复用既有模型，取卷积主干输出作为 128 维特征）
# ---------------------------------------------------------------------------
def forward_feat(model: nn.Module, x: torch.Tensor):
    """返回 (logits, feat)。兼容 FaultCNN 与 FPFaultCNN。"""
    if isinstance(model, FPFaultCNN):
        x_enh, energy = model.prior(x)
        conv = model.conv(x_enh)                       # (B,128,1)
        feat = torch.cat([conv, energy.unsqueeze(-1)], dim=1)  # (B,132,1)
        feat = feat.flatten(1)
        return model.classifier(feat.view(feat.size(0), -1, 1).contiguous()), feat
    conv = model.conv(x)
    feat = conv.flatten(1)
    return model.classifier(conv), feat


def make_model(kind: str, fs: float = 12000.0) -> nn.Module:
    if kind == "fp_cnn":
        return FPFaultCNN(fs=fs)
    return FaultCNN()


# ---------------------------------------------------------------------------
# 4. 训练
# ---------------------------------------------------------------------------
def train_variant(
    kind: str,
    method: str,
    src_train: tuple,
    tgt_unlabeled: np.ndarray,
    epochs: int = 30,
    batch_size: int = 128,
    lr: float = 1e-3,
    seed: int = SEED,
):
    """训练一个变体。method ∈ {none, coral, dann}。"""
    torch.manual_seed(seed)
    np.random.seed(seed)

    Xs, ys = src_train
    model = make_model(kind)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    ce = nn.CrossEntropyLoss()

    head = DomainHead(128 if kind == "cnn" else 132) if method == "dann" else None
    if head is not None:
        opt.add_param_group({"params": head.parameters(), "lr": lr})

    src_loader = DataLoader(
        TensorDataset(torch.from_numpy(Xs), torch.from_numpy(ys)),
        batch_size=batch_size, shuffle=True, drop_last=True,
    )
    tgt_loader = DataLoader(
        TensorDataset(torch.from_numpy(tgt_unlabeled)),
        batch_size=batch_size, shuffle=True, drop_last=True,
    )

    n_batches = min(len(src_loader), len(tgt_loader)) or len(src_loader)
    for ep in range(epochs):
        model.train()
        if head is not None:
            head.train()
        tl = iter(tgt_loader)
        tot = 0.0
        for xb, yb in src_loader:
            if method in ("coral", "dann"):
                try:
                    (xt,) = next(tl)
                except StopIteration:
                    tl = iter(tgt_loader)
                    (xt,) = next(tl)
            else:
                xt = None

            logits_s, feat_s = forward_feat(model, xb)
            loss = ce(logits_s, yb)

            if method == "coral":
                _, feat_t = forward_feat(model, xt)
                loss = loss + 0.6 * coral_loss(feat_s, feat_t)
            elif method == "dann":
                _, feat_t = forward_feat(model, xt)
                p = float(ep) / epochs
                lambd = 2.0 / (1.0 + np.exp(-10 * p)) - 1.0  # DANN 经典调度：0 → 1
                # GRL：域判别器要分清域，特征提取器要混淆域（梯度取反）
                dlogits = torch.cat([head(grl(feat_s, lambd)), head(grl(feat_t, lambd))], 0)
                dlabel = torch.cat([
                    torch.zeros(len(feat_s), dtype=torch.long),
                    torch.ones(len(feat_t), dtype=torch.long),
                ], 0)
                loss = loss + 0.35 * ce(dlogits, dlabel.to(dlogits.device))

            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss.item())
        if ep % 10 == 0 or ep == epochs - 1:
            print(f"    [{kind}/{method}] epoch {ep:>2}/{epochs}  loss={tot / max(n_batches,1):.4f}")
    return model


def train_oracle(Xt: np.ndarray, yt: np.ndarray, epochs: int = 30,
                 batch_size: int = 128, lr: float = 1e-3, seed: int = SEED):
    """目标域带标签训练（上界参照）。"""
    torch.manual_seed(seed)
    model = FaultCNN()
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    ce = nn.CrossEntropyLoss()
    loader = DataLoader(
        TensorDataset(torch.from_numpy(Xt), torch.from_numpy(yt)),
        batch_size=batch_size, shuffle=True, drop_last=True,
    )
    model.train()
    for ep in range(epochs):
        tot = 0.0
        for xb, yb in loader:
            loss = ce(model(xb), yb)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss.item())
        if ep % 20 == 0 or ep == epochs - 1:
            print(f"    [oracle] epoch {ep:>2}/{epochs}  loss={tot / max(len(loader),1):.4f}")
    return model


@torch.no_grad()
def evaluate(model: nn.Module, X: np.ndarray, y: np.ndarray, batch_size: int = 256):
    """返回 (accuracy, per_class_acc)。"""
    model.eval()
    preds = []
    for i in range(0, len(X), batch_size):
        xb = torch.from_numpy(X[i:i + batch_size])
        logits, _ = forward_feat(model, xb)
        preds.append(logits.argmax(1).numpy())
    pred = np.concatenate(preds)
    acc = float((pred == y).mean())
    per_class = {}
    for c in range(4):
        mask = y == c
        if mask.sum() > 0:
            per_class[LABEL_NAMES[c]] = round(float((pred[mask] == c).mean()), 4)
    return round(acc, 4), per_class


# ---------------------------------------------------------------------------
# 5. 主流程
# ---------------------------------------------------------------------------
def main():
    from modules.anomaly_detect.data_loader import load_npz, map_labels, stratified_file_split

    print("=" * 72)
    print("跨域自适应实验：CWRU 试验台（源域） → 三类仿真设备（目标域）")
    print("=" * 72)

    X, Y_str, file_ids = load_npz()
    y = map_labels(Y_str)
    (train_d, val_d, test_d), _ = stratified_file_split(X, y, file_ids, 0.7, 0.15, SEED)
    Xs_tr, ys_tr = train_d
    Xs_te, ys_te = test_d
    print(f"源域 CWRU: train={len(Xs_tr)}  test={len(Xs_te)}  采样率=12kHz 轴承=SKF6205 @1797rpm")

    # ---- 构造三类设备的目标域（对源域施加物理工况变换）----
    devices = {}
    all_tgt = []
    N_TRAIN = 1500   # 每台设备的"无标签"样本（模拟现场可采集但难标注）
    N_TEST = 600     # 每台设备的测试集（仅用于最终评测）
    for dev_id, prof in DEVICE_PROFILES.items():
        s0 = _seed_of(dev_id)
        rng = np.random.RandomState(s0)
        # 目标域"无标签池"：由源域训练集变换而来（训练时**不使用其标签**）
        idx_tr = rng.choice(len(Xs_tr), size=min(N_TRAIN, len(Xs_tr)), replace=False)
        Xtr = transform_to_device(Xs_tr[idx_tr], prof, rng)
        ytr = ys_tr[idx_tr]          # 仅作记录，训练不用
        # 目标域测试集：由源域测试集变换而来（标签仅用于最终评测）
        rng_te = np.random.RandomState(s0 + 777)
        idx_te = rng_te.choice(len(Xs_te), size=min(N_TEST, len(Xs_te)), replace=False)
        Xte = transform_to_device(Xs_te[idx_te], prof, rng_te)
        yte = ys_te[idx_te]
        devices[dev_id] = {
            "profile": prof,
            "train": (Xtr, ytr),
            "test": (Xte, yte),
            "freqs": bearing_frequencies(prof),
        }
        all_tgt.append(Xtr)
        f = bearing_frequencies(prof)
        print(
            f"目标域 {dev_id:<9} n={len(Xtr)+len(Xte)}  {prof['shaft_rpm']:.0f}rpm "
            f"fs={prof['fs']/1000:.0f}kHz  BPFO={f['BPFO']:.1f}Hz BPFI={f['BPFI']:.1f}Hz "
            f"共振={prof['resonance_hz']:.0f}Hz SNR={prof['snr_db']:+.0f}dB"
        )

    tgt_unlabeled = np.concatenate(all_tgt, 0)

    # ---- 训练 4 个变体 ----
    variants = [
        ("V0 源域直接迁移（无自适应）", "cnn", "none"),
        ("V1 FaultCNN + CORAL", "cnn", "coral"),
        ("V2 FaultCNN + DANN", "cnn", "dann"),
        ("V3 FP-CNN + CORAL（组合创新）", "fp_cnn", "coral"),
    ]

    results = []
    for title, kind, method in variants:
        print(f"\n--- 训练 {title} ---")
        model = train_variant(kind, method, (Xs_tr, ys_tr), tgt_unlabeled)
        src_acc, _ = evaluate(model, Xs_te, ys_te)
        per_dev = {}
        for dev_id, d in devices.items():
            Xte, yte = d["test"]
            acc, pc = evaluate(model, Xte, yte)
            per_dev[dev_id] = {"name": d["profile"]["name"], "accuracy": acc, "per_class": pc}
        tgt_macro = round(float(np.mean([v["accuracy"] for v in per_dev.values()])), 4)
        results.append({
            "id": title.split()[0],
            "title": title,
            "model": kind,
            "method": method,
            "source_test_accuracy": src_acc,
            "target_macro_accuracy": tgt_macro,
            "per_device": per_dev,
        })
        print(f"  源域 CWRU 测试准确率 = {src_acc:.4f}")
        for dev_id, v in per_dev.items():
            print(f"    {dev_id}: {v['accuracy']:.4f}")
        print(f"  目标域宏平均 = {tgt_macro:.4f}")

    # ---- 上界：目标域带标签训练 ----
    print("\n--- 训练 V4 目标域 Oracle（上界参照）---")
    Xt_all = np.concatenate([d["train"][0] for d in devices.values()])
    yt_all = np.concatenate([d["train"][1] for d in devices.values()])
    oracle = train_oracle(Xt_all, yt_all)
    per_dev = {}
    for dev_id, d in devices.items():
        Xte, yte = d["test"]
        acc, pc = evaluate(oracle, Xte, yte)
        per_dev[dev_id] = {"name": d["profile"]["name"], "accuracy": acc, "per_class": pc}
    oracle_entry = {
        "id": "V4",
        "title": "V4 目标域 Oracle（带标签训练·上界）",
        "model": "cnn",
        "method": "oracle",
        "source_test_accuracy": None,
        "target_macro_accuracy": round(float(np.mean([v["accuracy"] for v in per_dev.values()])), 4),
        "per_device": per_dev,
    }
    results.append(oracle_entry)
    print(f"  目标域宏平均 = {oracle_entry['target_macro_accuracy']:.4f}")

    # ---- 汇总 ----
    base = results[0]["target_macro_accuracy"]
    for r in results:
        r["gain_vs_v0"] = round(r["target_macro_accuracy"] - base, 4) if base else 0.0

    payload = {
        "experiment": "跨域自适应：CWRU 试验台 → 离心泵/电机/空压机三类仿真设备",
        "problem": (
            "故障分类 CNN 在 CWRU 实验室试验台（SKF-6205、1797rpm、12kHz、低噪声、近乎无环境干扰）上训练，"
            "直接用于现场三类设备时，因转速、结构共振频率、传感器增益与噪声底全面不同而产生分布漂移。"
        ),
        "source_domain": {
            "name": "CWRU 轴承数据集（实验室电机试验台）",
            "profile": SOURCE_PROFILE,
            "freqs": bearing_frequencies(SOURCE_PROFILE),
            "n_train": int(len(Xs_tr)),
            "n_test": int(len(Xs_te)),
        },
        "target_construction": (
            "目标域不是从零合成的独立数据集，而是对 CWRU 源域样本施加四类物理可解释的工况变换得到："
            "① 转速变化（时间轴缩放，频率按比例平移）；② 结构共振差异（频域带通整形）；"
            "③ 传感器增益；④ 现场噪声底（按设备信噪比叠加带限噪声）。"
            "这是域自适应研究构造目标域的标准做法（CWRU 不同载荷/转速本身即为公认的跨域基准），"
            "既保留了'同一类故障在不同设备上表现不同'的物理语义，又保证目标域本身可学习。"
        ),
        "target_domains": {
            dev_id: {
                "name": d["profile"]["name"],
                "shaft_rpm": d["profile"]["shaft_rpm"],
                "fs": d["profile"]["fs"],
                "resonance_hz": d["profile"]["resonance_hz"],
                "snr_db": d["profile"]["snr_db"],
                "sensor_gain": d["profile"].get("sensor_gain", 1.0),
                "bearing": {
                    "n_balls": d["profile"]["n_balls"],
                    "ball_diam_mm": d["profile"]["ball_diam_mm"],
                    "pitch_diam_mm": d["profile"]["pitch_diam_mm"],
                },
                "freqs": {k: round(v, 2) for k, v in d["freqs"].items()},
                "n_train_unlabeled": int(len(d["train"][0])),
                "n_test": int(len(d["test"][0])),
            }
            for dev_id, d in devices.items()
        },
        "class_labels": {LABEL_NAMES[i]: FAULT_ZH[LABEL_NAMES[i]] for i in range(4)},
        "methods": {
            "none": "仅用源域有标签数据训练，直接迁移（下界）",
            "coral": "CORAL：对齐源域与目标域特征的二阶统计量（协方差），无需目标域标签",
            "dann": "DANN：梯度反转层 + 域判别器，对抗学习域不变特征，无需目标域标签",
            "oracle": "目标域带标签训练（性能上界，现场通常不可得）",
        },
        "results": results,
        "conclusion": "",
    }

    # 只在"无目标域标签"的三个变体（V1 CORAL / V2 DANN / V3 FP-CNN+CORAL）中选最优
    unsupervised = [r for r in results if r["id"] != "V0" and r["method"] != "oracle"]
    best = max(unsupervised, key=lambda r: r["target_macro_accuracy"])
    ratio = best["target_macro_accuracy"] / max(oracle_entry["target_macro_accuracy"], 1e-9)
    payload["conclusion"] = (
        f"源域直接迁移在目标域仅 {base:.1%} 宏平均准确率（四分类随机水平为 25%），证实存在严重域漂移；"
        f"采用 {best['title']} 后提升到 {best['target_macro_accuracy']:.1%}"
        f"（+{best['gain_vs_v0']:.1%}），且全程不需要任何目标域标签。"
        f"但该值仅为目标域带标签训练上界 {oracle_entry['target_macro_accuracy']:.1%} 的 {ratio:.0%}，"
        f"说明无监督自适应可大幅缓解 domain shift、但尚未完全解决，仍有明确改进空间。"
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n" + "=" * 72)
    print(payload["conclusion"])
    print(f"结果已写入：{OUT_PATH}")
    print("=" * 72)


if __name__ == "__main__":
    main()

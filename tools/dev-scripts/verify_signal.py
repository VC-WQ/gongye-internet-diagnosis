"""临时验证：信号分析 Agent 的 FFT + 包络谱 + 特征频率提取（4 类）。"""
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.modules.multi_agent import signal_tools  # noqa: E402
from app.modules.multi_agent.base import AgentContext  # noqa: E402
from app.modules.multi_agent.schemas import SensorWindow  # noqa: E402
from app.modules.multi_agent.signal_agent import SignalAnalysisAgent  # noqa: E402

d = np.load(str(PROJECT_ROOT / "datasets" / "CWRU" / "processed.npz"))
X = d["X"]
Y = d["Y"]
HP = d["horsepower"]

fs = signal_tools.SAMPLE_RATE
agent = SignalAnalysisAgent()

for label in ["Normal", "IR", "OR", "Ball"]:
    idxs = np.where(Y == label)[0]
    idx = int(idxs[len(idxs) // 2])
    arr = X[idx][0].astype(float)
    hp_val = int(HP[idx])

    window = SensorWindow(vibration=arr.tolist(), horsepower=hp_val)
    rpm = signal_tools.resolve_rpm(window)
    ctx = AgentContext(device_id=f"verify-{label}", sensor_window=window, anomaly={})
    res = agent.analyze(ctx)

    spectrum = signal_tools.compute_spectrum(arr, fs)
    envelope = signal_tools.compute_envelope_spectrum(arr, fs)
    cpeaks = signal_tools.find_characteristic_peaks(arr, fs, rpm)
    verdict = signal_tools.classify_from_peaks(cpeaks)

    print("=" * 82)
    print(f"[{label}]  hp={hp_val}  rpm={rpm}")
    print(f"  主峰前3  : {spectrum['peaks'][:3]}")
    print(f"  包络谱前5: {envelope['peaks'][:5]}")
    print("  特征频率 :")
    for k in ("bpfo", "bpfi", "bsf", "bsf2x"):
        p = cpeaks[k]
        print(f"    {k:7s} 理论{p['theoretical']:7.2f}Hz 实测{p['measured']:7.2f}Hz "
              f"幅值{p['amplitude']:.5f} 偏差{p['deviation_pct']:.2f}%")
    print(f"    球故障匹配: {cpeaks['bsf_harmonic']} 幅值{cpeaks['bsf_effective']['amplitude']:.5f}")
    print(f"  噪声地板 : {cpeaks['noise_floor']:.6f}")
    print(f"  判断     : type={verdict['fault_type']} conf={verdict['confidence']} "
          f"dominant={verdict['dominant']} snr={verdict['snr']}")
    print(f"  Agent结论: {res.conclusion}")
    print(f"  Agent证据: {res.evidence}")

print("=" * 82)
import sys
sys.path.insert(0, r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统\backend')

import numpy as np
from app.modules.multi_agent import run_consultation

NPZ = r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统\datasets\CWRU\processed.npz'
data = np.load(NPZ)
X = data['X']
Y = data['Y']

for cls in ['Normal', 'OR', 'IR', 'Ball']:
    idx = np.where(Y == cls)[0][0]
    x = X[idx].flatten().tolist()
    window = [{"vibration": float(v)} for v in x]
    res = run_consultation(f"smoke-{cls}", window)
    r = res['report']
    print('=' * 70)
    print(f"[{cls}] 判定={res['fault_type']} 置信度={res['confidence']:.4f} 健康={res['health_score']:.2f}({res['health_level']}) 冲突={res['conflict_detected']}")
    print('  诊断:', r['diagnosis'])
    print('  signal:', r['signal_evidence'][:80])
    print('  phys:', r['physical_evidence'][:80])
    print('  summary:', r['summary'])
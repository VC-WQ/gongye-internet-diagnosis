"""模块5 端到端验收：4 类各 5 条（共 20 条）。

输出：
1. 每条完整会诊记录（8 部分诊断报告）
2. 5 项统计数字
"""
import json
import sys
import os
import argparse
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
parser = argparse.ArgumentParser(description='离线会诊验收；需要已有数据集与权重，不下发设备控制。')
parser.add_argument('--dataset', type=Path, default=ROOT / 'datasets/CWRU/processed.npz')
parser.add_argument('--output', type=Path, default=Path(os.environ.get('ICT_ARTIFACT_DIR', ROOT.parent / 'gongye-internet-diagnosis-artifacts' / 'generated-research-reports')) / 'e2e_results.json')
arguments = parser.parse_args()

import numpy as np

from app.modules.multi_agent import run_consultation

NPZ = arguments.dataset
OUT_JSON = arguments.output

# CWRU 字符串标签 -> 内部 fault_type / 序号
CLASSES = ['Normal', 'OR', 'IR', 'Ball']
LABEL_INTERNAL = {'Normal': 'normal', 'OR': 'outer_race', 'IR': 'inner_race', 'Ball': 'ball'}
DOMINANT_TO_FAULT = {
    'BPFO': 'outer_race', 'BPFI': 'inner_race', 'BSF': 'ball', '2xBSF': 'ball', 'none': 'normal',
}


def main() -> None:
    data = np.load(NPZ)
    X, Y = data['X'], data['Y']
    rng = np.random.default_rng(42)

    # 每类随机抽 5 条（固定 seed 可复现）
    chosen: list[tuple[str, int]] = []
    for cls in CLASSES:
        idxs = np.where(Y == cls)[0]
        picks = rng.choice(idxs, size=5, replace=False)
        for i in picks:
            chosen.append((cls, int(i)))

    records = []
    for cls, i in chosen:
        x = X[i].flatten().tolist()
        window = [{"vibration": float(v)} for v in x]
        res = run_consultation(f"e2e-{cls}-{i}", window)
        records.append({"class": cls, "index": i, "result": res})

    # ---- 逐条打印 8 部分诊断报告 ----
    for rec in records:
        cls, i, res = rec["class"], rec["index"], rec["result"]
        r = res["report"]
        diag = r["diagnosis"]
        print("=" * 78)
        print(f"[{cls} #{i}] 判定={res['fault_type']} 置信度={diag['confidence']:.4f} "
              f"健康={res['health_score']:.2f}({res['health_level']}) 冲突={res['conflict_detected']}")
        print(f"  1 summary            : {r['summary']}")
        print(f"  2 physical_evidence  : {r['physical_evidence']}")
        print(f"  3 signal_evidence    : {r['signal_evidence']}")
        kb = r['knowledge_basis'].replace('\n', ' / ')
        print(f"  4 knowledge_basis    : {kb}")
        print(f"  5 diagnosis          : 类型={diag['fault_type']} 置信度={diag['confidence']}")
        print(f"                          推理={diag['reasoning']}")
        print(f"  6 impact             : {r['impact']}")
        print(f"  7 recommendation     : {r['recommendation']}")
        fu = '；'.join(r['follow_up_questions'])
        print(f"  8 follow_up_questions: {fu}")

    # ---- 5 项统计 ----
    print("\n" + "#" * 78)
    print("统计汇总")
    print("#" * 78)

    # 1) dominant_peak 分布
    def dominant_of(res):
        return res['agent_results'][0]['details']['signal_evidence']['dominant_peak']

    print("\n[1] dominant_peak 分布（各取 5 条）")
    dist = {cls: Counter() for cls in CLASSES}
    for rec in records:
        dist[rec['class']][dominant_of(rec['result'])] += 1

    or_total = sum(dist['OR'].values())
    ir_total = sum(dist['IR'].values())
    ball_total = sum(dist['Ball'].values())
    normal_total = sum(dist['Normal'].values())
    print(f"  OR     BPFO 占比  : {dist['OR']['BPFO']}/{or_total} = {dist['OR']['BPFO']/or_total:.0%}  (分布={dict(dist['OR'])})")
    print(f"  IR     BPFI 占比  : {dist['IR']['BPFI']}/{ir_total} = {dist['IR']['BPFI']/ir_total:.0%}  (分布={dict(dist['IR'])})")
    ball_bsf = dist['Ball']['BSF'] + dist['Ball']['2xBSF']
    print(f"  Ball   BSF 占比   : {ball_bsf}/{ball_total} = {ball_bsf/ball_total:.0%}  (分布={dict(dist['Ball'])})")
    print(f"  Normal none 占比  : {dist['Normal']['none']}/{normal_total} = {dist['Normal']['none']/normal_total:.0%}  (分布={dict(dist['Normal'])})")

    # 2) 冲突检测触发次数
    conflict_count = sum(1 for rec in records if rec['result']['conflict_detected'])
    conflict_types = Counter()
    for rec in records:
        for c in rec['result']['conflicts']:
            # 粗略归类
            if '信号主导峰' in c:
                conflict_types['signal_vs_cnn'] += 1
            elif '物理残差' in c:
                conflict_types['physics_vs_health'] += 1
            else:
                conflict_types['other'] += 1
    print(f"\n[2] 冲突检测触发次数 : {conflict_count}/20")
    print(f"    冲突类型分布      : {dict(conflict_types)}")

    # 3) 信号证据与 CNN 结论一致率
    agree = disagree = insufficient = 0
    for rec in records:
        res = rec['result']
        dominant = dominant_of(res)
        signal_fault = DOMINANT_TO_FAULT.get(dominant, 'normal')
        cnn_fault = res['fault_type']  # 决策主判断 == CNN
        rel = res['agent_results'][0]['details']['signal_evidence']['signal_reliability']
        if rel == 'low' and dominant == 'none':
            insufficient += 1
        elif signal_fault == cnn_fault:
            agree += 1
        else:
            disagree += 1
    total = agree + disagree + insufficient
    print(f"\n[3] 信号证据与 CNN 结论")
    print(f"    一致={agree}  冲突={disagree}  证据不足={insufficient}")
    print(f"    一致率(一致/总)  : {agree}/{total} = {agree/total:.0%}")

    # 4) 整体准确率
    correct = sum(1 for rec in records if rec['result']['fault_type'] == LABEL_INTERNAL[rec['class']])
    print(f"\n[4] 整体准确率 : {correct}/20 = {correct/20:.0%}")
    # 分类型准确率
    per_cls = {cls: {'correct': 0, 'total': 0} for cls in CLASSES}
    for rec in records:
        per_cls[rec['class']]['total'] += 1
        if rec['result']['fault_type'] == LABEL_INTERNAL[rec['class']]:
            per_cls[rec['class']]['correct'] += 1
    print("    分类型：")
    for cls in CLASSES:
        s = per_cls[cls]
        print(f"      {cls:<6}: {s['correct']}/{s['total']}")

    # 保存完整 JSON 供后续查阅
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print(f"\n完整会诊记录已保存：{OUT_JSON}")


if __name__ == '__main__':
    main()

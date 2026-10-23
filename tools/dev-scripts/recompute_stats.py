"""从已保存的验收 JSON 重新计算统计（修正信号一致率的证据不足口径）。"""
import json
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description='从显式指定的会诊验收记录重新计算统计，不读取运行数据库。')
parser.add_argument('--input', required=True, type=Path, help='外部归档中的 e2e_results.json')
OUT_JSON = parser.parse_args().input
DOMINANT_TO_FAULT = {
    'BPFO': 'outer_race', 'BPFI': 'inner_race', 'BSF': 'ball', '2xBSF': 'ball', 'none': 'normal',
}

records = json.load(open(OUT_JSON, encoding='utf-8'))

# 校验 agent_results 顺序
roles = [r['agent_role'] for r in records[0]['result']['agent_results']]
print('agent_results 顺序:', roles)

agree = disagree = insufficient = 0
details = []
for rec in records:
    res = rec['result']
    sig = res['agent_results'][0]['details']['signal_evidence']
    dominant = sig['dominant_peak']
    rel = sig['signal_reliability']
    signal_fault = DOMINANT_TO_FAULT.get(dominant, 'normal')
    cnn_fault = res['fault_type']
    if rel == 'low':
        insufficient += 1
        bucket = 'insufficient'
    elif signal_fault == cnn_fault:
        agree += 1
        bucket = 'agree'
    else:
        disagree += 1
        bucket = 'disagree'
    details.append((rec['class'], dominant, rel, signal_fault, cnn_fault, bucket))

print('\n逐条信号证据判定：')
for d in details:
    print(f"  {d[0]:<6} dominant={d[1]:<6} rel={d[2]:<7} signal={d[3]:<11} cnn={d[4]:<11} -> {d[5]}")

total = agree + disagree + insufficient
print('\n[信号证据与 CNN 结论]')
print(f"  可用且一致  : {agree}")
print(f"  可用且冲突  : {disagree}")
print(f"  证据不足    : {insufficient}  (reliability=low)")
print(f"  可用样本内一致率 : {agree}/{agree+disagree} = {agree/(agree+disagree):.0%}" if (agree+disagree) else "  无可用信号样本")
print(f"  全体一致率(含不足): {agree}/{total} = {agree/total:.0%}")

# 冲突类型
from collections import Counter
ct = Counter()
for rec in records:
    for c in rec['result']['conflicts']:
        if '信号主导峰' in c:
            ct['signal_vs_cnn'] += 1
        elif '物理残差' in c:
            ct['physics_vs_health'] += 1
        else:
            ct['other'] += 1
print(f"\n[冲突] 触发 {sum(1 for r in records if r['result']['conflict_detected'])}/20，类型={dict(ct)}")
print('触发冲突的样本:', [(r['class'], r['result']['conflicts']) for r in records if r['result']['conflict_detected']])

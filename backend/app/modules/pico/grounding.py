"""Small fail-closed check for unsupported numbers/entities in model prose.

This is not an independent fact checker. Tool facts and references remain the source;
uncertain or malformed model prose falls back to the deterministic answer.
"""
from __future__ import annotations

import math
import re

NUMBER = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?%?")
DEVICE = re.compile(r"\b(?:pump|motor|compressor)-[A-Za-z0-9_-]+", re.I)
FAULT = re.compile(r"(?:内圈|外圈|滚动体|轴承|齿轮|转子|密封)(?:故障|损伤|磨损)")
CHINESE = "零〇一二两三四五六七八九十百千万点"


def _chinese_number(token: str) -> float:
    digits = dict(zip("零〇一二两三四五六七八九", [0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
    whole, _, decimal = token.partition("点")
    total = current = 0
    for char in whole:
        if char in digits:
            current = digits[char]
        else:
            unit = {"十": 10, "百": 100, "千": 1000, "万": 10000}[char]
            total += (current or 1) * unit
            current = 0
    return total + current + (float("0." + "".join(str(digits[char]) for char in decimal)) if decimal else 0)


def grounded_prose(text: str, facts: str, fallback: str) -> bool:
    if len(text) > 5000:
        return False
    if re.search(r"(?:已(?:经)?|正在|我(?:会|将|替你|帮你)|立即|自动|直接).{0,12}(?:停机|重启|删除|下发|确认事件|拒绝事件|保存到数据库|修改阈值|提交诊断)", text):
        return False
    source = facts + "\n" + fallback
    if any(token.casefold() not in source.casefold() for token in DEVICE.findall(text)):
        return False
    if any(token not in source for token in FAULT.findall(text)):
        return False
    allowed = set(NUMBER.findall(source))
    values = []
    for token in allowed:
        try:
            value = float(token.rstrip("%"))
            if math.isfinite(value):
                values.append(value / 100 if token.endswith("%") else value)
        except ValueError:
            continue
    for token in NUMBER.findall(text):
        if token in allowed:
            continue
        try:
            value = float(token.rstrip("%"))
            if token.endswith("%"):
                value /= 100
            decimals = len(token.rstrip("%").split(".")[1]) if "." in token else 0
            # Allow ordinary display rounding, not a different measurement.
            tolerance = min(0.0005, 0.5 * 10 ** -decimals / (100 if token.endswith("%") else 1))
            if not any(abs(value - actual) <= tolerance for actual in values):
                return False
        except (ValueError, OverflowError):
            return False
    measurements = re.findall(r"百分之([" + CHINESE + r"]+)|(?:评分|温度|置信度|振动)(?:为|是|达到|[:：])?\s*([" + CHINESE + r"]+)", text)
    for percent, measure in measurements:
        try:
            value = _chinese_number(percent or measure) / (100 if percent else 1)
        except (KeyError, ValueError):
            return False
        if not any(abs(value - actual) <= .0005 for actual in values):
            return False
    return True


def grounded_explanation(text: str, facts: str, fallback: str) -> bool:
    """Only non-measurement commentary may accompany server-rendered facts.

    A shared set of allowed numbers cannot establish which entity owns a value.
    Numerical, status, comparison, provenance and freshness assertions therefore
    stay in deterministic templates; this conservative gate is not a semantic
    fact checker for arbitrary prose.
    """
    if not grounded_prose(text, facts, fallback) or NUMBER.search(text):
        return False
    if re.search(r"百分之|(?:评分|分数|温度|振动|压力|置信度|准确率|剩余寿命).{0,8}[" + CHINESE + r"]", text):
        return False
    factual_claim = r"实时|现场|实测|仿真|模拟|离线|过期|时效|采样|采集|正常|退化|告警|故障|损坏|异常|更高|更低|最高|最低|上升|下降|恶化|好转|优于|劣于"
    return re.search(factual_claim, text) is None

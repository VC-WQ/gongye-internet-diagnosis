"""时间线下采样必须对缺失观测保持诚实，而不是抛错或补造数值。"""
from app.modules.timeline.service import _downsample


def test_missing_and_invalid_observations_are_kept_as_gaps():
    values = [1.0, None, "bad", float("nan"), float("inf"), 2]
    sampled, points, stride, downsampled = _downsample(values, 256)
    assert points == len(values)
    assert stride == 1
    assert downsampled is False
    assert sampled[:6] == [1.0, None, None, None, None, 2.0]


def test_downsampled_observations_keep_gaps_and_never_crash():
    values = [None if index % 3 == 0 else float(index) for index in range(1000)]
    sampled, points, stride, downsampled = _downsample(values, 100)
    assert downsampled is True
    assert stride == 10
    assert points == len(sampled) == 100
    assert sampled[0] is None
    assert sampled[1] == 10.0

"""模块4：PINN + 1D-CNN 异常检测。

子模块：
- pinn_residual : PINN 物理残差生成器
- cnn_classifier: 1D-CNN 故障分类器
- health_scorer : 健康评分引擎
"""
from .service import AnomalyDetectService, anomaly_detect_service  # noqa: F401

__all__ = ["AnomalyDetectService", "anomaly_detect_service"]
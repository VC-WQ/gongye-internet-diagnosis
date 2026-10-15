"""视觉检测智能体服务。

基于 YOLOv8s / RT-DETR（NEU-DET 钢铁表面缺陷数据集训练）的本地推理：
  - 目标检测：定位缺陷位置 + 类别 + 置信度（6 类缺陷）
  - 模型懒加载：首次请求时加载 best.pt，避免拖慢后端启动
  - 本地 CPU 推理（torch cpu），单张 200×200 图约几十毫秒

权重与样例图位于本模块目录下的 weights/ 与 samples/ 子目录。
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading

import numpy as np

# 6 类缺陷顺序（与训练脚本 CLASSES 一致）
CLASSES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]
CLASS_LABEL = {
    "crazing": "裂纹",
    "inclusion": "夹杂",
    "patches": "斑块",
    "pitted_surface": "点蚀",
    "rolled-in_scale": "氧化铁皮",
    "scratches": "划痕",
}

# 模型名 -> 训练时输入尺寸（推理保持一致）
MODEL_IMGSZ = {"yolov8s": 200, "rtdetr": 640}

_BASE = os.path.dirname(os.path.abspath(__file__))
WEIGHT_DIR = os.path.join(_BASE, "weights")
SAMPLE_DIR = os.path.join(_BASE, "samples")
COMPARISON_PATH = os.path.join(_BASE, "comparison.json")


class VisionService:
    """视觉检测智能体：单例懒加载，缓存已加载模型。"""

    def __init__(self) -> None:
        self._models: dict[str, object] = {}

    def available_models(self) -> list[dict]:
        """返回可用模型列表（weights 目录下存在的 *_best.pt）。"""
        out = []
        for name in ("yolov8s", "rtdetr"):
            if os.path.isfile(os.path.join(WEIGHT_DIR, f"{name}_best.pt")):
                out.append({"name": name, "imgsz": MODEL_IMGSZ[name]})
        return out

    def comparison(self) -> dict:
        """返回双模型「精度-速度权衡」对比数据（来自训练产物 comparison.json）。"""
        if not os.path.isfile(COMPARISON_PATH):
            return {"models": []}
        with open(COMPARISON_PATH, encoding="utf-8") as f:
            return json.load(f)

    def prewarm(self, name: str = "yolov8s") -> None:
        """后台线程预加载默认模型，降低首次检测的加载延迟。"""
        def _load() -> None:
            try:
                self._get_model(name)
            except Exception:
                pass

        threading.Thread(target=_load, daemon=True).start()

    def _get_model(self, name: str):
        if name not in self._models:
            from ultralytics import YOLO

            path = os.path.join(WEIGHT_DIR, f"{name}_best.pt")
            if not os.path.isfile(path):
                raise FileNotFoundError(f"模型权重不存在：{path}")
            self._models[name] = YOLO(path)
        return self._models[name]

    def detect(self, img_bytes: bytes, model: str = "yolov8s", conf: float = 0.25) -> dict:
        """对上传图片执行缺陷检测，返回检测框 + 标注图(base64)。"""
        import cv2

        yolo = self._get_model(model)
        imgsz = MODEL_IMGSZ.get(model, 200)

        # PIL 打开字节流 → numpy RGB，交给 ultralytics 推理
        from PIL import Image
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        arr = np.array(img)

        results = yolo.predict(source=arr, conf=conf, imgsz=imgsz, verbose=False)
        r = results[0]

        detections = []
        for box in r.boxes:
            cls_id = int(box.cls.item())
            cls_name = CLASSES[cls_id] if cls_id < len(CLASSES) else "unknown"
            x1, y1, x2, y2 = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            detections.append({
                "class": cls_name,
                "label": CLASS_LABEL.get(cls_name, cls_name),
                "confidence": round(float(box.conf.item()), 4),
                "bbox": [x1, y1, x2, y2],
            })
        detections.sort(key=lambda d: -d["confidence"])

        # 标注图：r.plot() 返回 BGR numpy，编码 JPEG 后转 base64
        annotated = r.plot()  # BGR
        ok, buf = cv2.imencode(".jpg", annotated)
        b64 = base64.b64encode(buf.tobytes()).decode() if ok else ""

        return {
            "model": model,
            "count": len(detections),
            "detections": detections,
            "annotated_image": f"data:image/jpeg;base64,{b64}" if b64 else "",
        }

    def sample_images(self, model: str = "yolov8s") -> list[dict]:
        """返回某模型的检测样例图（base64），按 6 类顺序排列。"""
        model_dir = os.path.join(SAMPLE_DIR, model)
        out = []
        if not os.path.isdir(model_dir):
            return out
        # 按固定类别顺序找样例图（文件名形如 {class}_{idx}.jpg）
        seen = set()
        for cls in CLASSES:
            for fn in sorted(os.listdir(model_dir)):
                if fn.startswith(cls + "_") and fn.lower().endswith((".jpg", ".png")):
                    path = os.path.join(model_dir, fn)
                    with open(path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    out.append({
                        "class": cls,
                        "label": CLASS_LABEL.get(cls, cls),
                        "image": f"data:image/jpeg;base64,{b64}",
                    })
                    seen.add(fn)
                    break
        return out


vision_service = VisionService()
"""视觉检测智能体路由。

对接 NEU-DET 训练的 YOLOv8s / RT-DETR 权重，提供：
  - GET  /vision/models      可用模型列表
  - GET  /vision/samples     检测样例图（6 类）
  - POST /vision/detect      上传图片 → 缺陷定位 + 类别 + 置信度 + 标注图
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .service import vision_service

router = APIRouter(prefix="/vision", tags=["视觉检测智能体"])


@router.get("/models")
def list_models() -> dict:
    """返回可用的检测模型列表；实际模型仅在检测请求时加载。"""
    models = vision_service.available_models()
    return {"models": models}


@router.get("/samples")
def samples(model: str = "yolov8s") -> dict:
    """返回某模型的检测样例图（base64，供前端图墙展示）。"""
    return {"model": model, "samples": vision_service.sample_images(model)}


@router.get("/comparison")
def comparison() -> dict:
    """返回 YOLOv8s vs RT-DETR 的精度-速度对比（mAP / FPS / 参数量）。"""
    return vision_service.comparison()


@router.post("/detect")
async def detect(
    file: UploadFile = File(...),
    model: str = Form("yolov8s"),
    conf: float = Form(0.25),
) -> dict:
    """上传图片执行缺陷检测。"""
    try:
        img_bytes = await file.read()
        if not img_bytes:
            raise HTTPException(status_code=400, detail="上传内容为空")
        return vision_service.detect(img_bytes, model=model, conf=conf)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:  # 推理失败时返回明确错误，避免 500 堆栈
        raise HTTPException(status_code=500, detail=f"检测失败：{e}")
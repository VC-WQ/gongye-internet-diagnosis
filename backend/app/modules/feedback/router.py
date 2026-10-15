"""反馈评估模块路由。"""
from fastapi import APIRouter

from .service import feedback_service

router = APIRouter(prefix="/feedback", tags=["反馈评估"])


@router.post("/{diagnosis_id}")
def collect_feedback(diagnosis_id: int, feedback: dict) -> dict:
    """收集诊断反馈。"""
    feedback_service.collect_feedback(diagnosis_id, feedback)
    return {"status": "collected"}


@router.get("/{diagnosis_id}/evaluate")
def evaluate(diagnosis_id: int) -> dict:
    """评估诊断质量。"""
    return feedback_service.evaluate(diagnosis_id)
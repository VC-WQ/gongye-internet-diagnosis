"""FastAPI 应用入口。"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import Base, Device, SessionLocal, User, engine
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service

# 各功能模块路由
from app.modules.acoustic.router import router as acoustic_router
from app.modules.auth.router import router as auth_router
from app.modules.auth.admin import router as user_admin_router
from app.modules.anomaly_detect.router import router as anomaly_router
from app.modules.command_loop.accuracy_tracker import router as self_eval_router
from app.modules.command_loop.router import router as command_router
from app.modules.command_loop.threshold_adapter import router as threshold_suggestions_router
from app.modules.device_catalog.router import router as device_router
from app.modules.digital_twin.router import router as twin_router
from app.modules.edge_inference.router import router as edge_router
from app.modules.feedback.router import router as feedback_router
from app.modules.mqtt_pipeline.router import router as mqtt_router
from app.modules.multi_agent.router import router as agent_router
from app.modules.report.router import router as report_router
from app.modules.records.router import router as records_router
from app.modules.threshold.router import router as threshold_router
from app.modules.timeline.router import router as timeline_router
from app.modules.vision.router import router as vision_router
from app.modules.viz.router import router as viz_router


def _seed_devices() -> None:
    """首次启动时向设备表写入 6 台虚拟设备目录（幂等）。

    设备目录与 simulators/virtual_device.py 中的默认 6 台异构设备保持一致，
    健康分与状态按设备退化程度差异化，供前端大屏展示不同状态层次。
    """
    db = SessionLocal()
    try:
        if db.query(Device).count() > 0:
            return
        presets = [
            Device(id="pump-001", name="离心泵 A", device_type="pump", status="healthy", health_score=96.0, edge_anomaly_score=0.05),
            Device(id="pump-002", name="离心泵 B", device_type="pump", status="degraded", health_score=68.0, edge_anomaly_score=0.42),
            Device(id="motor-001", name="驱动电机 A", device_type="motor", status="healthy", health_score=97.0, edge_anomaly_score=0.03),
            Device(id="motor-002", name="驱动电机 B", device_type="motor", status="healthy", health_score=83.0, edge_anomaly_score=0.28),
            Device(id="compressor-001", name="空压机 A", device_type="compressor", status="healthy", health_score=95.0, edge_anomaly_score=0.04),
            Device(id="compressor-002", name="空压机 B", device_type="compressor", status="degraded", health_score=75.0, edge_anomaly_score=0.35),
        ]
        db.add_all(presets)
        db.commit()
    finally:
        db.close()


def _seed_admin() -> None:
    """首次启动时写入默认管理员账号（username=admin, password=admin123）。"""
    from app.modules.auth.security import hash_password

    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        db.add(User(username="admin", password_hash=hash_password("admin123"), role="admin"))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    # 启动时创建数据表
    Base.metadata.create_all(bind=engine)
    # 首次启动写入设备目录与默认管理员
    _seed_devices()
    _seed_admin()
    # 注入主事件循环，使 MQTT 线程能够跨线程推送 WebSocket
    mqtt_pipeline_service.attach_event_loop(asyncio.get_running_loop())
    yield
    # 关闭时释放资源（MQTT 客户端、模型进程、数据库连接池）
    mqtt_pipeline_service.stop()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册所有模块路由
for router in (
    auth_router,
    user_admin_router,
    records_router,
    device_router,
    twin_router,
    mqtt_router,
    edge_router,
    anomaly_router,
    agent_router,
    command_router,
    feedback_router,
    report_router,
    timeline_router,
    threshold_router,
    acoustic_router,
    threshold_suggestions_router,
    self_eval_router,
    viz_router,
    vision_router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get("/")
def root() -> dict:
    """根路径健康检查。"""
    return {"app": settings.app_name, "status": "running"}


@app.get("/health")
def health() -> dict:
    """健康检查。"""
    return {"status": "ok"}
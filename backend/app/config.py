"""全局配置管理模块。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。

    优先从环境变量或 .env 文件读取，未提供时使用默认值。
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 应用
    app_name: str = "物理数字孪生驱动的工业设备多智能体诊断系统"
    api_prefix: str = "/api/v1"
    debug: bool = False

    # 数据库
    database_url: str = "sqlite:///./data/industrial_diagnosis.db"

    # MQTT
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_topic_prefix: str = "industrial/device"
    mqtt_client_id: str = "diagnosis-backend"
    mqtt_sensor_topic: str = "device/+/sensor_data"

    # 模型推理
    model_device: str = "cpu"  # cpu / cuda
    edge_model_path: str = "./models/edge"

    # DeepSeek LLM（多智能体会诊"解读"环节，只解读不计算）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_mock: bool = False

    # 认证（JWT）
    secret_key: str = "industrial-diagnosis-secret-change-me"
    access_token_expire_minutes: int = 60 * 24

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    """获取单例配置。"""
    return Settings()


settings = get_settings()
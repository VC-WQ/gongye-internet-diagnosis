"""全局配置管理模块。"""
from functools import lru_cache
import secrets
from typing import Literal

from pydantic import Field, model_validator

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。

    优先从环境变量或 .env 文件读取，未提供时使用默认值。
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True)

    runtime_environment: Literal["development", "test", "production"] = "development"
    seed_demo_devices: bool | None = None
    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = Field(default="", repr=False)

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
    mqtt_command_topic: str = "device/{device_id}/command"
    mqtt_command_ack_topic: str = "device/+/command_ack"

    # 模型推理
    model_device: str = "cpu"  # cpu / cuda
    edge_model_path: str = "./models/edge"

    # DeepSeek LLM（多智能体会诊"解读"环节，只解读不计算）
    deepseek_api_key: str = Field(default="", repr=False)
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_mock: bool = False

    # 认证（JWT）
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48), repr=False)
    access_token_expire_minutes: int = 60 * 24

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    @model_validator(mode="after")
    def validate_runtime(self):
        production = self.runtime_environment == "production"
        if self.seed_demo_devices is None:
            self.seed_demo_devices = not production
        if production:
            key = self.secret_key.strip()
            if ("secret_key" not in self.model_fields_set or len(key) < 32
                    or len(set(key)) < 8 or "industrial-diagnosis" in key.lower()
                    or any(word in key.lower() for word in ("changeme", "change-me", "example", "placeholder"))):
                raise ValueError("生产环境需要显式配置独立、高强度的 SECRET_KEY")
            if self.bootstrap_admin_password and len(self.bootstrap_admin_password) < 12:
                raise ValueError("生产管理员初始口令至少需要12个字符")
        return self


@lru_cache
def get_settings() -> Settings:
    """获取单例配置。"""
    return Settings()


settings = get_settings()

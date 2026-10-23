"""Pico 测试环境：使用独立 SQLite，避免污染开发数据库。"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="ict-v21-pytest-"))
TEST_DB = TEST_DIR / "suite.db"

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["DEEPSEEK_MOCK"] = "true"
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["MQTT_HOST"] = "localhost"
os.environ["MQTT_PORT"] = "18991"


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001
    """测试结束后清理临时数据库与 WAL 文件。"""
    for suffix in ("", "-wal", "-shm"):
        path = Path(str(TEST_DB) + suffix)
        if path.exists():
            path.unlink()
    TEST_DIR.rmdir()

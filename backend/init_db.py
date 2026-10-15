"""数据库初始化脚本：创建所有数据表。

用法：
    python backend/init_db.py
"""
import sys
from pathlib import Path

# 将 backend 目录加入 sys.path，确保可导入 app 包
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.models import Base, engine  # noqa: E402


def init_db() -> None:
    """创建所有数据表。"""
    Base.metadata.create_all(bind=engine)
    print("数据库初始化完成，已创建表：")
    for table in Base.metadata.sorted_tables:
        print(f"  - {table.name}")


if __name__ == "__main__":
    init_db()
"""用户账号模型。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String

from .base import Base


class User(Base):
    """系统用户（admin / user）。"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, index=True, nullable=False, comment="用户名")
    password_hash = Column(String(256), nullable=False, comment="bcrypt 密码哈希")
    role = Column(String(32), default="user", comment="角色：admin/user")
    is_active = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username} role={self.role}>"

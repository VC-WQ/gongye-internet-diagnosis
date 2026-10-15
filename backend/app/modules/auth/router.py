"""认证路由：注册 / 登录 / 当前用户。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import User, get_db

from .deps import get_current_user
from .security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["认证"])


class RegisterBody(BaseModel):
    username: str
    password: str


class LoginBody(BaseModel):
    username: str
    password: str


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(get_db)) -> dict:
    """注册新用户（默认角色为普通用户）。"""
    if len(body.username) < 3 or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="用户名至少 3 位，密码至少 6 位")
    exists = db.query(User).filter(User.username == body.username).first()
    if exists:
        raise HTTPException(status_code=409, detail="用户名已存在")
    user = User(username=body.username, password_hash=hash_password(body.password), role="user")
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.role)
    return {"token": token, "user": _user_dict(user)}


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)) -> dict:
    """登录，返回 JWT 与用户信息。"""
    user = db.query(User).filter(User.username == body.username).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")
    token = create_access_token(user.id, user.role)
    return {"token": token, "user": _user_dict(user)}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    """返回当前登录用户信息。"""
    return _user_dict(current_user)
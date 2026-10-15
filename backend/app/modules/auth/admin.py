"""用户管理路由（仅管理员）：用户账号的增删改查。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import User, get_db

from .deps import require_admin
from .security import hash_password

router = APIRouter(prefix="/users", tags=["用户管理"])


class CreateUserBody(BaseModel):
    username: str
    password: str
    role: str = "user"  # admin / user


class UpdateUserBody(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[dict]:
    """用户列表（仅管理员）。"""
    return [_user_dict(u) for u in db.query(User).order_by(User.id.asc()).all()]


@router.post("")
def create_user(
    body: CreateUserBody, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    """创建用户（仅管理员）。"""
    if len(body.username) < 3 or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="用户名至少 3 位，密码至少 6 位")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="用户名已存在")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色必须为 admin 或 user")
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@router.put("/{user_id}")
def update_user(
    user_id: int, body: UpdateUserBody, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    """更新用户（角色 / 启用状态 / 重置密码）。"""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if body.role is not None:
        if body.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="角色必须为 admin 或 user")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="密码至少 6 位")
        user.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    """删除用户（不能删除自己）。"""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录的账号")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": user_id}
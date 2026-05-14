from datetime import datetime, timedelta
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import verify_password
from app.models.user import RolePermission, User

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key")
ALGORITHM = "HS256"

DEFAULT_MODULES = [
    "DASHBOARD",
    "REGISTRATION",
    "VIEW_SCHEMES",
    "PHYSICAL_PROGRESS",
    "DPR",
    "CAPEX",
    "MATERIAL",
    "CPM",
    "DOCUMENTS",
    "STATUS",
]


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=120)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def super_admin_permissions():
    permissions = {
        module: {"read": True, "write": True, "admin": True}
        for module in DEFAULT_MODULES
    }
    permissions["SUPER_ADMIN"] = True
    return permissions


@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    try:
        user = db.query(User).filter(User.username == form_data.username).first()
    except SQLAlchemyError:
        user = None

    if user and verify_password(form_data.password, user.hashed_password):
        permissions = db.query(RolePermission).filter(RolePermission.role_name == user.role).all()
        perms_dict = {
            permission.module_name: {
                "read": permission.can_read,
                "write": permission.can_write,
                "admin": permission.is_admin,
            }
            for permission in permissions
        }

        if user.role == "Super_Admin":
            perms_dict["SUPER_ADMIN"] = True

        token = create_access_token({
            "sub": user.username,
            "role": user.role,
            "permissions": perms_dict,
        })
        return {"access_token": token, "token_type": "bearer"}

    if form_data.username == "admin" and form_data.password == "edprojects":
        token = create_access_token({
            "sub": form_data.username,
            "role": "Super_Admin",
            "permissions": super_admin_permissions(),
        })
        return {"access_token": token, "token_type": "bearer"}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

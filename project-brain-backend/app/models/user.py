"""
User & permission models — reconciled to LIVE t5 schema.

Sprint 0 fix:
  users:           was {hashed_password, last_login} -> t5 {password_hash,
                   last_login_at, + designation/department/phone/telegram/
                   is_locked/failed_login_attempts/password_changed_at/...}
  role_permissions: was {permission_id, role_name, module_name, can_read,
                   can_write, is_admin} -> t5 {role_perm_id, role, module_key,
                   can_view, can_edit, can_approve, can_delete}

Backward-compat: a `hashed_password` hybrid property proxies `password_hash`
so any legacy code that still references User.hashed_password keeps working.
(Live auth uses raw psycopg2 with correct column names, so this is belt-and-
braces, not load-bearing.)

Place at: project-brain-backend/app/models/user.py
"""

from sqlalchemy import (
    Boolean, Column, DateTime, Integer, BigInteger, String, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False)
    email = Column(String(200))
    full_name = Column(String(200), nullable=False)
    designation = Column(String(200))
    department = Column(String(200))
    phone = Column(String(50))
    password_hash = Column(String(255))
    role = Column(String(50), nullable=False, default="viewer")  # CHECK enforced in DB
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime)
    telegram_user_id = Column(BigInteger)
    extra_fields = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    failed_login_attempts = Column(Integer, default=0)
    password_changed_at = Column(DateTime, server_default=func.current_timestamp())
    is_locked = Column(Boolean, default=False)

    # ---- backward-compat shims (legacy attribute names) --------------------
    @hybrid_property
    def hashed_password(self):
        return self.password_hash

    @hashed_password.setter
    def hashed_password(self, value):
        self.password_hash = value

    @hybrid_property
    def last_login(self):
        return self.last_login_at

    @last_login.setter
    def last_login(self, value):
        self.last_login_at = value


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_perm_id = Column(Integer, primary_key=True, autoincrement=True)
    role = Column(String(50), nullable=False)
    module_key = Column(String(100), nullable=False)
    can_view = Column(Boolean, nullable=False, default=False)
    can_edit = Column(Boolean, nullable=False, default=False)
    can_approve = Column(Boolean, nullable=False, default=False)
    can_delete = Column(Boolean, nullable=False, default=False)

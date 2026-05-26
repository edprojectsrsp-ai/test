from sqlalchemy import Boolean, Column, Integer, String

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String, index=True)
    module_name = Column(String)
    can_read = Column(Boolean, default=False)
    can_write = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)

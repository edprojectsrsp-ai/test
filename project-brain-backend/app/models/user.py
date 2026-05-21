"""Compatibility exports for user models.

The canonical SQLAlchemy table definitions live in app.models.scheme
for the GOD MODE v2 schema. Re-export them here so existing imports
(`from app.models.user import User`) continue to work without
registering duplicate tables.
"""

from app.models.scheme import RolePermission, User

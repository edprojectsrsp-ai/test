"""
RBAC core — JWT auth + role-based guards.
Matches actual v4 schema (varchar role, module_key + can_view/edit/approve/delete bools).

Drop into `back/app/security/auth.py`.

Usage:
    from app.security.auth import require_user, require_role, require_permission

    @router.get("/api/v1/cpm/schedule")
    def list_schedules(user = Depends(require_permission("cpm", "view"))):
        ...
"""
import os
import logging
import time
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext
import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

# Stable secret — never randomize per-process (that invalidated tokens on restart).
JWT_SECRET = (
    os.environ.get("JWT_SECRET")
    or os.environ.get("PB_AUTH_SECRET")
    or "change-me-in-env-pb-secret"
)
JWT_ALG = "HS256"
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "12"))
# Sprint 0: set PB_AUTH_ENFORCE=0 only for emergency local demos without login.
AUTH_ENFORCE = (os.environ.get("PB_AUTH_ENFORCE", "1").strip().lower()
                not in ("0", "false", "no", "off"))

bearer_scheme = HTTPBearer(auto_error=False)
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_db():
    # Align with app.core.database: prefer DATABASE_URL from .env
    dsn = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("PROJECT_BRAIN_DB_URL")
        or "postgresql://postgres:postgres@127.0.0.1:5432/project_brain"
    )
    return psycopg2.connect(dsn)


# ===========================================================================
# PASSWORD HASHING
# ===========================================================================
def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(plain, hashed)
    except Exception:
        return False


# ===========================================================================
# TOKENS
# ===========================================================================
def create_access_token(user_id: int, role: str, expires_hours: Optional[int] = None) -> str:
    exp = datetime.utcnow() + timedelta(hours=expires_hours or JWT_EXPIRY_HOURS)
    payload = {"sub": str(user_id), "role": role, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# ===========================================================================
# USER LOOKUP (briefly cached)
# ===========================================================================
_user_cache: dict[int, tuple[dict, float]] = {}
USER_CACHE_TTL = 60


def fetch_user(user_id: int) -> Optional[dict]:
    """Get user + their role's module permissions. Lightly cached."""
    now = time.time()
    cached = _user_cache.get(user_id)
    if cached and (now - cached[1]) < USER_CACHE_TTL:
        return cached[0]

    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT user_id, username, full_name, email, role,
                   is_active, is_locked, designation, department, telegram_user_id
            FROM users WHERE user_id = %s
        """, (user_id,))
        user = cur.fetchone()
        if not user:
            return None

        cur.execute("""
            SELECT module_key, can_view, can_edit, can_approve, can_delete
            FROM role_permissions WHERE role = %s
        """, (user["role"],))
        perms: dict[str, dict] = {}
        for r in cur.fetchall():
            perms[r["module_key"]] = {
                "view":    r["can_view"],
                "edit":    r["can_edit"],
                "approve": r["can_approve"],
                "delete":  r["can_delete"],
            }

        user_dict = dict(user)
        user_dict["permissions"] = perms
        _user_cache[user_id] = (user_dict, now)
        return user_dict
    finally:
        conn.close()


def invalidate_user_cache(user_id: Optional[int] = None):
    if user_id is None:
        _user_cache.clear()
    else:
        _user_cache.pop(user_id, None)


# ===========================================================================
# DEPENDENCIES
# ===========================================================================
def require_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    if not AUTH_ENFORCE:
        # Soft mode: accept token when present, else return a synthetic demo admin.
        if credentials:
            try:
                payload = decode_token(credentials.credentials)
                user = fetch_user(int(payload["sub"]))
                if user and user.get("is_active") and not user.get("is_locked"):
                    return user
            except Exception:
                pass
        return {
            "user_id": 0, "username": "demo", "full_name": "Demo User",
            "role": "admin", "is_active": True, "is_locked": False,
            "permissions": {}, "designation": "Demo", "department": "Projects",
        }
    if not credentials:
        raise HTTPException(401, "Missing authorization header")
    payload = decode_token(credentials.credentials)
    user_id = int(payload["sub"])
    user = fetch_user(user_id)
    if not user:
        raise HTTPException(401, "User not found")
    if not user["is_active"] or user.get("is_locked"):
        raise HTTPException(403, "Account inactive or locked")
    return user


def require_role(*allowed_roles: str):
    def _check(user: dict = Depends(require_user)) -> dict:
        if user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(allowed_roles)}. You have: {user['role']}"
            )
        return user
    return _check


def require_permission(module: str, action: str = "view"):
    """Returns a dep that requires permission on a module.

    Args:
      module: e.g. 'scheme', 'package', 'cpm', 'notesheet', 'ai'
      action: 'view' | 'edit' | 'approve' | 'delete'
    """
    if action not in ("view", "edit", "approve", "delete"):
        raise ValueError(f"Invalid action: {action}")

    def _check(user: dict = Depends(require_user)) -> dict:
        if user["role"] == "admin":
            return user
        perms = user.get("permissions", {}).get(module)
        if not perms or not perms.get(action):
            raise HTTPException(
                status_code=403,
                detail=f"Missing permission: {module}.{action}"
            )
        return user
    return _check


def optional_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> Optional[dict]:
    if not credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
        return fetch_user(int(payload["sub"]))
    except Exception:
        return None


# ===========================================================================
# SCHEME-LEVEL ACCESS
# ===========================================================================
def user_can_access_scheme(user: dict, scheme_id: int) -> bool:
    if user["role"] in ("admin", "manager"):
        return True

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT EXISTS(SELECT 1 FROM information_schema.tables
                          WHERE table_name = 'user_scheme_access')
        """)
        has_mapping_table = cur.fetchone()[0]

        if has_mapping_table:
            cur.execute("""
                SELECT 1 FROM user_scheme_access
                WHERE user_id = %s AND scheme_id = %s LIMIT 1
            """, (user["user_id"], scheme_id))
            if cur.fetchone():
                return True

        cur.execute("""
            SELECT 1 FROM packages
            WHERE scheme_id = %s
              AND (project_manager_id = %s OR primary_contractor_id = %s)
            LIMIT 1
        """, (scheme_id, user["user_id"], user["user_id"]))
        return cur.fetchone() is not None
    finally:
        conn.close()


def assert_can_access_scheme(user: dict, scheme_id: int):
    if not user_can_access_scheme(user, scheme_id):
        raise HTTPException(403, f"No access to scheme {scheme_id}")


def get_accessible_scheme_ids(user: dict) -> Optional[list[int]]:
    """Returns list of scheme_ids the user can see, or None if all."""
    if user["role"] in ("admin", "manager"):
        return None

    conn = get_db()
    try:
        cur = conn.cursor()
        scheme_ids: set[int] = set()

        cur.execute("""
            SELECT 1 FROM information_schema.tables WHERE table_name = 'user_scheme_access'
        """)
        if cur.fetchone():
            cur.execute("""
                SELECT scheme_id FROM user_scheme_access WHERE user_id = %s
            """, (user["user_id"],))
            scheme_ids.update(r[0] for r in cur.fetchall())

        cur.execute("""
            SELECT DISTINCT scheme_id FROM packages
            WHERE project_manager_id = %s OR primary_contractor_id = %s
        """, (user["user_id"], user["user_id"]))
        scheme_ids.update(r[0] for r in cur.fetchall())

        return list(scheme_ids)
    finally:
        conn.close()

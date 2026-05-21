"""
AI service auth bridge.

The AI service is standalone but trusts the same JWT_SECRET as the main backend.
So a user logs in once → main backend issues JWT → frontend uses same JWT to call
both port 8000 (main) AND port 8001 (AI).

CRITICAL: JWT_SECRET in .env MUST match between main backend and AI service.

Drop this into ai_service/app/security/auth.py and update the chat router to use it.
"""
import os
import logging
from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALG = "HS256"
bearer = HTTPBearer(auto_error=False)


def get_db():
    dsn = os.environ.get("PROJECT_BRAIN_DB_URL",
                        "postgresql://postgres:abc123@127.0.0.1:5433/project_brain")
    return psycopg2.connect(dsn)


def require_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Validate JWT and return user."""
    if not creds:
        raise HTTPException(401, "Missing authorization header")
    if not JWT_SECRET:
        # Dev mode: skip auth if JWT_SECRET not configured
        # (Use a dummy user, log a warning - DO NOT do this in prod)
        logger.warning("JWT_SECRET not set! Running AI service without auth (dev only).")
        return {"user_id": 1, "role": "admin", "username": "dev"}
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = int(payload["sub"])
        role = payload.get("role", "viewer")
    except JWTError as e:
        raise HTTPException(401, f"Invalid token: {e}")

    # Verify user still active in DB
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT user_id, username, full_name, role::text AS role, is_active, is_locked
        FROM users WHERE user_id=%s AND NOT is_deleted
    """, (user_id,))
    user = cur.fetchone()
    conn.close()
    if not user or not user["is_active"] or user["is_locked"]:
        raise HTTPException(403, "User not active")
    return dict(user)


def require_role(*allowed: str):
    def _check(user: dict = Depends(require_user)) -> dict:
        if user["role"] not in allowed:
            raise HTTPException(403, f"Requires role: {', '.join(allowed)}")
        return user
    return _check


def get_scheme_filter_for_user(user: dict) -> Optional[list[int]]:
    """Return list of scheme_ids the user can see, or None if they can see all.

    Used by the AI service to scope tool calls. For example, the AI's find_scheme
    tool will only search within these IDs for non-admin users.
    """
    if user["role"] in ("admin", "manager"):
        return None  # see everything
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT scheme_id FROM user_scheme_access WHERE user_id=%s
    """, (user["user_id"],))
    scheme_ids = [r[0] for r in cur.fetchall()]
    conn.close()
    # If contractor has no explicit access, restrict to packages they're assigned to
    if not scheme_ids and user["role"] == "contractor":
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT scheme_id FROM packages
            WHERE project_manager_id=%s OR primary_contractor_id=%s
        """, (user["user_id"], user["user_id"]))
        scheme_ids = [r[0] for r in cur.fetchall()]
        conn.close()
    return scheme_ids

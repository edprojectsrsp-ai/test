"""
Auth router — /login, /refresh, /me, /change-password
Mount under /api/v1/auth in main FastAPI app.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
import psycopg2
import psycopg2.extras
from app.security.auth import (
    create_access_token, verify_password, hash_password, fetch_user,
    require_user, invalidate_user_cache, get_db
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str  # can be username or email
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    expires_in_hours: int


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class CreateUserIn(BaseModel):
    username: str
    full_name: str
    email: EmailStr
    password: str
    role: str  # admin/manager/engineer/viewer/contractor
    designation: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn):
    """Authenticate by username or email. Returns JWT."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT user_id, username, password_hash, role::text AS role,
               is_active, is_locked, failed_login_attempts
        FROM users
        WHERE (username = %s OR email = %s) AND NOT is_deleted
    """, (payload.username, payload.username))
    user = cur.fetchone()
    if not user:
        conn.close()
        raise HTTPException(401, "Invalid credentials")
    if not user["is_active"] or user["is_locked"]:
        conn.close()
        raise HTTPException(403, "Account inactive or locked")

    if not verify_password(payload.password, user["password_hash"]):
        # Track failed attempts; lock after 5
        cur.execute("""
            UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                is_locked = CASE WHEN failed_login_attempts >= 4 THEN TRUE ELSE is_locked END
            WHERE user_id = %s
        """, (user["user_id"],))
        conn.commit()
        conn.close()
        raise HTTPException(401, "Invalid credentials")

    # Successful login - reset counter and update last_login
    cur.execute("""
        UPDATE users
        SET failed_login_attempts = 0, last_login_at = CURRENT_TIMESTAMP
        WHERE user_id = %s
    """, (user["user_id"],))
    conn.commit()
    conn.close()
    invalidate_user_cache(user["user_id"])

    from app.security.auth import JWT_EXPIRY_HOURS
    token = create_access_token(user["user_id"], user["role"])
    return TokenOut(
        access_token=token, user_id=user["user_id"],
        role=user["role"], expires_in_hours=JWT_EXPIRY_HOURS,
    )


@router.get("/me")
def me(user: dict = Depends(require_user)):
    """Return current user details."""
    safe = {k: v for k, v in user.items() if k != "password_hash"}
    return safe


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, user: dict = Depends(require_user)):
    """Change own password."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT password_hash FROM users WHERE user_id = %s", (user["user_id"],))
    row = cur.fetchone()
    if not row or not verify_password(payload.current_password, row[0]):
        conn.close()
        raise HTTPException(403, "Current password is incorrect")
    cur.execute("""
        UPDATE users SET password_hash = %s, password_changed_at = CURRENT_TIMESTAMP
        WHERE user_id = %s
    """, (hash_password(payload.new_password), user["user_id"]))
    conn.commit()
    conn.close()
    invalidate_user_cache(user["user_id"])
    return {"ok": True}


@router.post("/users")
def create_user(payload: CreateUserIn, admin: dict = Depends(require_user)):
    """Admin-only: create a new user."""
    if admin["role"] != "admin":
        raise HTTPException(403, "Admin only")
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO users (username, full_name, email, password_hash, role,
                               designation, department, phone, created_by)
            VALUES (%s, %s, %s, %s, %s::role_enum, %s, %s, %s, %s)
            RETURNING user_id
        """, (payload.username, payload.full_name, payload.email,
              hash_password(payload.password), payload.role,
              payload.designation, payload.department, payload.phone, admin["user_id"]))
        uid = cur.fetchone()[0]
        conn.commit()
        return {"user_id": uid, "username": payload.username}
    except psycopg2.IntegrityError as e:
        conn.rollback()
        raise HTTPException(400, f"Conflict: {e}")
    finally:
        conn.close()


@router.get("/users")
def list_users(admin: dict = Depends(require_user)):
    """Admin/manager only: list all users."""
    if admin["role"] not in ("admin", "manager"):
        raise HTTPException(403, "Admin/manager only")
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT user_id, username, full_name, email, role::text AS role,
               designation, department, is_active, is_locked, last_login_at
        FROM users WHERE NOT is_deleted ORDER BY user_id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"users": rows}

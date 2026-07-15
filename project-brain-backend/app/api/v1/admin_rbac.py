"""admin_rbac.py — Admin / RBAC module for Project Brain.

Parity target (rival: user_roles.py 1,664 + access_control.py 1,641 +
login.py 425 LOC) delivered as ONE cohesive router on the existing `users`
table (extended, never replaced) + three new tables. Zero new dependencies:
pbkdf2_hmac password hashing and HMAC-SHA256 signed tokens from the stdlib.

Endpoints (prefix /api/v1/admin):
  AUTH      POST /auth/login · POST /auth/change-password
            POST /auth/otp/request · POST /auth/otp/verify   (password reset)
  USERS     GET/POST /users · PATCH /users/{id} · POST /users/{id}/deactivate
  ROLES     GET /roles/matrix · PUT /roles/matrix              (module × action)
  ACCESS    GET /access/{user_id} · PUT /access/{user_id}      (per-scheme)
  AUDIT     GET /audit
Helpers importable anywhere:
  require(module, action)      FastAPI dependency guarding any router
  allowed_scheme_ids(user_id)  for RBAC-aware AI answers & dashboards
Beyond-rival: account lockout after 5 failed logins (his counts but never
locks), OTPs stored HASHED with expiry + attempt cap, full admin audit trail.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import (
    create_access_token as create_existing_access_token,
    hash_password as hash_existing_password,
    require_user as require_existing_user,
    verify_password as verify_existing_password,
)

router = APIRouter(prefix="/admin", tags=["Admin RBAC"])

SECRET = (os.environ.get("PB_AUTH_SECRET") or "change-me-in-env-pb-secret").encode()
TOKEN_TTL_S = int(os.environ.get("PB_TOKEN_TTL_S") or 12 * 3600)
LOCKOUT_AFTER = 5
OTP_TTL_S = 600
MODULES = ["dashboard", "capex", "scurve", "cpm", "reports", "dpr", "appendix2",
           "notesheet", "risk", "documents", "ppe", "ai", "admin"]
ACTIONS = ["view", "edit", "approve", "export"]
DEFAULT_ROLES: dict[str, dict] = {
    "admin":    {m: ACTIONS[:] for m in MODULES},
    "pmc":      {m: (["view", "edit", "export"] if m not in ("admin",) else []) for m in MODULES},
    "engineer": {m: (["view", "edit"] if m in ("dashboard", "capex", "scurve", "cpm", "dpr", "appendix2") else ["view"] if m != "admin" else []) for m in MODULES},
    "viewer":   {m: (["view"] if m != "admin" else []) for m in MODULES},
}
DEFAULT_ROLES["manager"] = DEFAULT_ROLES["pmc"]
DEFAULT_ROLES["contractor"] = DEFAULT_ROLES["viewer"]
ACTION_COLUMNS = {
    "view": "can_view",
    "edit": "can_edit",
    "approve": "can_approve",
    "export": "can_export",
}

# ---------------------------------------------------------------- crypto
def hash_password(pw: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 120_000)
    return "pbkdf2$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: Optional[str]) -> bool:
    try:
        if not stored or not stored.startswith("pbkdf2$"):
            return False
        _tag, salt_b64, dk_b64 = stored.split("$", 2)
        salt = base64.b64decode(salt_b64)
        expect = base64.b64decode(dk_b64)
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 120_000)
        return hmac.compare_digest(got, expect)
    except Exception:
        return False


def sign_token(user_id: int, role: str, now: Optional[float] = None) -> str:
    payload = {"uid": user_id, "role": role, "exp": int((now or time.time()) + TOKEN_TTL_S)}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=")
    sig = base64.urlsafe_b64encode(hmac.new(SECRET, body, hashlib.sha256).digest()).rstrip(b"=")
    return (body + b"." + sig).decode()


def verify_token(token: str, now: Optional[float] = None) -> Optional[dict]:
    try:
        body, sig = token.encode().split(b".", 1)
        expect = base64.urlsafe_b64encode(hmac.new(SECRET, body, hashlib.sha256).digest()).rstrip(b"=")
        if not hmac.compare_digest(sig, expect):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + b"=" * (-len(body) % 4)))
        if payload.get("exp", 0) < (now or time.time()):
            return None
        return payload
    except Exception:
        return None


# ---------------------------------------------------------------- DDL (lazy)
_DDL = """
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS password_reset_otps (
    id serial PRIMARY KEY, user_id integer NOT NULL,
    otp_hash text NOT NULL, expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_audit (
    id serial PRIMARY KEY, actor_user_id integer, action text NOT NULL,
    target text, detail jsonb DEFAULT '{}'::jsonb, at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key text PRIMARY KEY,
    setting_value text NOT NULL DEFAULT '',
    updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_scheme_access (
    user_id integer NOT NULL,
    scheme_id integer NOT NULL,
    access_level text DEFAULT 'view',
    granted_by integer,
    granted_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, scheme_id)
);
"""

# Sprint 2 — branding / DPR governance defaults
DEFAULT_SETTINGS = {
    "header_title": "Rourkela Steel Plant - Project Department",
    "header_subtitle": "Capital Project Monitoring · Project Brain",
    "org_name": "Rourkela Steel Plant",
    "logo_url": "",
    "primary_color": "#0b3d91",
    "daily_progress_backdate_days": "7",
    "menu_show_ppe": "1",
    "menu_show_ai": "1",
    "menu_show_delay": "1",
    "active_financial_year": "",
}
_ddl_done = False

def _ensure(db: Session) -> None:
    global _ddl_done
    if _ddl_done:
        return
    for stmt in _DDL.split(";"):
        if stmt.strip():
            db.execute(text(stmt))
    # seed default matrix once
    for role, mods in DEFAULT_ROLES.items():
        for module in MODULES:
            actions = set(mods.get(module, []))
            db.execute(text("""
                INSERT INTO role_permissions
                    (role, module_key, can_view, can_edit, can_approve, can_delete, can_export)
                VALUES (:r, :m, :v, :e, :a, false, :x)
                ON CONFLICT (role, module_key) DO NOTHING
            """), {
                "r": role,
                "m": module,
                "v": "view" in actions,
                "e": "edit" in actions,
                "a": "approve" in actions,
                "x": "export" in actions,
            })
    for k, v in DEFAULT_SETTINGS.items():
        db.execute(text("""
            INSERT INTO app_settings (setting_key, setting_value)
            VALUES (:k, :v) ON CONFLICT (setting_key) DO NOTHING
        """), {"k": k, "v": v})
    db.commit()
    _ddl_done = True


def get_setting(db: Session, key: str, default: str = "") -> str:
    _ensure(db)
    row = db.execute(text(
        "SELECT setting_value FROM app_settings WHERE setting_key=:k"
    ), {"k": key}).scalar()
    return str(row) if row is not None else default


def set_setting(db: Session, key: str, value: str) -> None:
    _ensure(db)
    db.execute(text("""
        INSERT INTO app_settings (setting_key, setting_value, updated_at)
        VALUES (:k, :v, now())
        ON CONFLICT (setting_key) DO UPDATE
        SET setting_value = EXCLUDED.setting_value, updated_at = now()
    """), {"k": key, "v": str(value)})


def get_dpr_backdate_days(db: Session) -> int:
    try:
        return max(0, min(365, int(get_setting(db, "daily_progress_backdate_days", "7") or 7)))
    except Exception:
        return 7


def _audit(db: Session, actor: Optional[int], action: str, target: str = "", detail: Optional[dict] = None) -> None:
    db.execute(text("""INSERT INTO admin_audit (actor_user_id, action, target, detail)
                       VALUES (:a,:x,:t,CAST(:d AS jsonb))"""),
               {"a": actor, "x": action, "t": target, "d": json.dumps(detail or {})})
    db.commit()


# ---------------------------------------------------------------- auth deps
def current_user(user: dict = Depends(require_existing_user), db: Session = Depends(get_db)) -> dict:
    _ensure(db)
    return user


def has_permission(db: Session, role: str, module: str, action: str) -> bool:
    _ensure(db)
    column = ACTION_COLUMNS.get(action)
    if not column:
        return False
    row = db.execute(text(f"""SELECT {column} FROM role_permissions
                              WHERE role=:r AND module_key=:m"""),
                     {"r": role, "m": module}).scalar()
    return bool(row)


def require(module: str, action: str):
    """FastAPI dependency: Depends(require('capex','edit')) on any endpoint."""
    def dep(user: dict = Depends(current_user), db: Session = Depends(get_db)) -> dict:
        role = str(user.get("role") or "")
        if role in ("admin", "administrator", "superadmin", "super admin"):
            return user
        if not has_permission(db, role, module, action):
            raise HTTPException(403, f"Role '{role}' lacks {module}:{action}")
        return user
    return dep


def allowed_scheme_ids(db: Session, user_id: int, role: str) -> Optional[list[int]]:
    """None = all schemes (admin/pmc); otherwise explicit grant list.
    Use in AI grounding & dashboards for RBAC-aware answers."""
    _ensure(db)
    if role in ("admin", "pmc"):
        return None
    rows = db.execute(text("SELECT scheme_id FROM user_scheme_access WHERE user_id=:u"),
                      {"u": user_id}).scalars().all()
    return [int(r) for r in rows]


# ---------------------------------------------------------------- payloads
class LoginIn(BaseModel):
    username: str
    password: str

class ChangePwIn(BaseModel):
    old_password: str
    new_password: str

class OtpRequestIn(BaseModel):
    username: str

class OtpVerifyIn(BaseModel):
    username: str
    otp: str
    new_password: str

class UserIn(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "viewer"
    email: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None

class UserPatch(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None

class MatrixIn(BaseModel):
    matrix: dict  # {role: {module: [actions]}}

class AccessIn(BaseModel):
    scheme_ids: list[int]


class SettingsIn(BaseModel):
    header_title: Optional[str] = None
    header_subtitle: Optional[str] = None
    org_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    daily_progress_backdate_days: Optional[int] = None
    menu_show_ppe: Optional[bool] = None
    menu_show_ai: Optional[bool] = None
    menu_show_delay: Optional[bool] = None
    active_financial_year: Optional[str] = None


# ---------------------------------------------------------------- AUTH
@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    _ensure(db)
    row = db.execute(text("""SELECT user_id, username, full_name, role, is_active,
                                    password_hash, failed_login_attempts
                             FROM users WHERE lower(username)=lower(:u)"""),
                     {"u": body.username}).mappings().first()
    if not row:
        raise HTTPException(401, "Invalid credentials")
    if not row["is_active"]:
        raise HTTPException(403, "Account disabled — contact admin")
    if (row["failed_login_attempts"] or 0) >= LOCKOUT_AFTER:
        raise HTTPException(423, "Account locked after repeated failures — reset password via OTP")
    if not verify_existing_password(body.password, row["password_hash"]):
        db.execute(text("""UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts,0)+1
                           , is_locked = CASE WHEN COALESCE(failed_login_attempts,0) >= 4 THEN TRUE ELSE is_locked END
                           WHERE user_id=:u"""), {"u": row["user_id"]})
        db.commit()
        raise HTTPException(401, "Invalid credentials")
    db.execute(text("""UPDATE users SET failed_login_attempts = 0, is_locked = false, last_login_at = now()
                       WHERE user_id=:u"""), {"u": row["user_id"]})
    db.commit()
    perm_rows = db.execute(text("""SELECT module_key, can_view, can_edit, can_approve, can_export
                                    FROM role_permissions WHERE role=:r"""),
                           {"r": row["role"]}).mappings().all()
    perms = [
        f"{perm['module_key']}:{action}"
        for perm in perm_rows
        for action, column in ACTION_COLUMNS.items()
        if perm[column]
    ]
    return {"token": create_existing_access_token(row["user_id"], row["role"]),
            "user": {"user_id": row["user_id"], "username": row["username"],
                     "full_name": row["full_name"], "role": row["role"]},
            "permissions": perms,
            "scheme_access": allowed_scheme_ids(db, row["user_id"], row["role"])}


@router.post("/auth/change-password")
def change_password(body: ChangePwIn, user: dict = Depends(current_user), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT password_hash FROM users WHERE user_id=:u"),
                     {"u": user["user_id"]}).mappings().first()
    if not verify_existing_password(body.old_password, row["password_hash"] if row else None):
        raise HTTPException(401, "Old password incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    db.execute(text("UPDATE users SET password_hash=:h, updated_at=now() WHERE user_id=:u"),
               {"h": hash_existing_password(body.new_password), "u": user["user_id"]})
    db.commit()
    _audit(db, user["user_id"], "change_password", user["username"])
    return {"ok": True}


@router.post("/auth/otp/request")
def otp_request(body: OtpRequestIn, db: Session = Depends(get_db)):
    _ensure(db)
    row = db.execute(text("SELECT user_id, phone, email FROM users WHERE lower(username)=lower(:u) AND is_active"),
                     {"u": body.username}).mappings().first()
    # respond identically whether or not the user exists (no enumeration)
    if row:
        otp = f"{secrets.randbelow(1_000_000):06d}"
        db.execute(text("""INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
                           VALUES (:u, :h, now() + make_interval(secs => :ttl))"""),
                   {"u": row["user_id"], "h": hash_existing_password(otp), "ttl": OTP_TTL_S})
        db.commit()
        _audit(db, None, "otp_requested", body.username)
        # Delivery: hook WhatsApp Cloud API / SMTP here. Dev mode returns it.
        if os.environ.get("PB_OTP_DEV_MODE") == "1":
            return {"ok": True, "dev_otp": otp, "expires_in_s": OTP_TTL_S}
    return {"ok": True, "message": "If the account exists, an OTP has been sent."}


@router.post("/auth/otp/verify")
def otp_verify(body: OtpVerifyIn, db: Session = Depends(get_db)):
    _ensure(db)
    user = db.execute(text("SELECT user_id FROM users WHERE lower(username)=lower(:u)"),
                      {"u": body.username}).mappings().first()
    if not user:
        raise HTTPException(401, "Invalid OTP")
    rec = db.execute(text("""SELECT id, otp_hash, attempts FROM password_reset_otps
                             WHERE user_id=:u AND NOT used AND expires_at > now()
                             ORDER BY id DESC LIMIT 1"""), {"u": user["user_id"]}).mappings().first()
    if not rec or rec["attempts"] >= 5:
        raise HTTPException(401, "Invalid or expired OTP")
    if not verify_existing_password(body.otp, rec["otp_hash"]):
        db.execute(text("UPDATE password_reset_otps SET attempts = attempts+1 WHERE id=:i"), {"i": rec["id"]})
        db.commit()
        raise HTTPException(401, "Invalid or expired OTP")
    if len(body.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    db.execute(text("UPDATE password_reset_otps SET used = true WHERE id=:i"), {"i": rec["id"]})
    db.execute(text("""UPDATE users SET password_hash=:h, failed_login_attempts=0, is_locked=false, updated_at=now()
                       WHERE user_id=:u"""), {"h": hash_existing_password(body.new_password), "u": user["user_id"]})
    db.commit()
    _audit(db, user["user_id"], "otp_password_reset", body.username)
    return {"ok": True}


# ---------------------------------------------------------------- USERS
@router.get("/users")
def list_users(user: dict = Depends(require("admin", "view")), db: Session = Depends(get_db)):
    rows = db.execute(text("""SELECT user_id, username, full_name, email, designation, department,
                                     phone, role, is_active, last_login_at::text AS last_login_at,
                                     failed_login_attempts
                              FROM users ORDER BY user_id""")).mappings().all()
    return {"users": [dict(r) for r in rows]}


@router.post("/users")
def create_user(body: UserIn, user: dict = Depends(require("admin", "edit")), db: Session = Depends(get_db)):
    if body.role not in DEFAULT_ROLES and not db.execute(
            text("SELECT 1 FROM role_permissions WHERE role=:r LIMIT 1"), {"r": body.role}).scalar():
        raise HTTPException(422, f"Unknown role '{body.role}'")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    dup = db.execute(text("SELECT 1 FROM users WHERE lower(username)=lower(:u)"), {"u": body.username}).scalar()
    if dup:
        raise HTTPException(409, "Username already exists")
    new_id = db.execute(text("""
        INSERT INTO users (user_id, username, full_name, email, designation, department, phone,
                           password_hash, role, is_active)
        VALUES (COALESCE((SELECT MAX(user_id)+1 FROM users), 1),
                :u, :fn, :e, :dg, :dp, :ph, :h, :r, true)
        RETURNING user_id"""),
        {"u": body.username, "fn": body.full_name, "e": body.email, "dg": body.designation,
         "dp": body.department, "ph": body.phone, "h": hash_existing_password(body.password), "r": body.role}
    ).scalar()
    db.commit()
    _audit(db, user["user_id"], "create_user", body.username, {"role": body.role})
    return {"user_id": new_id}


@router.patch("/users/{user_id}")
def patch_user(user_id: int, body: UserPatch, user: dict = Depends(require("admin", "edit")), db: Session = Depends(get_db)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        return {"ok": True}
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    db.execute(text(f"UPDATE users SET {sets}, updated_at = now() WHERE user_id = :uid"),
               {**fields, "uid": user_id})
    db.commit()
    _audit(db, user["user_id"], "update_user", str(user_id), fields)
    return {"ok": True}


@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, user: dict = Depends(require("admin", "edit")), db: Session = Depends(get_db)):
    if user_id == user["user_id"]:
        raise HTTPException(422, "You cannot deactivate your own account")
    db.execute(text("UPDATE users SET is_active = false, updated_at = now() WHERE user_id=:u"), {"u": user_id})
    db.commit()
    _audit(db, user["user_id"], "deactivate_user", str(user_id))
    return {"ok": True}


# ---------------------------------------------------------------- ROLES MATRIX
@router.get("/roles/matrix")
def get_matrix(user: dict = Depends(require("admin", "view")), db: Session = Depends(get_db)):
    rows = db.execute(text("""SELECT role, module_key, can_view, can_edit, can_approve, can_export
                              FROM role_permissions""")).mappings().all()
    matrix: dict = {}
    for r in rows:
        actions = [action for action, column in ACTION_COLUMNS.items() if r[column]]
        matrix.setdefault(r["role"], {})[r["module_key"]] = actions
    return {"modules": MODULES, "actions": ACTIONS, "matrix": matrix}


@router.put("/roles/matrix")
def put_matrix(body: MatrixIn, user: dict = Depends(require("admin", "edit")), db: Session = Depends(get_db)):
    if "admin" not in body.matrix or "edit" not in body.matrix.get("admin", {}).get("admin", []):
        raise HTTPException(422, "Refusing a matrix that locks out the admin role from admin:edit")
    for module in MODULES:
        db.execute(text("DELETE FROM role_permissions WHERE module_key=:m"), {"m": module})
    for role, mods in body.matrix.items():
        for module in MODULES:
            actions = set(mods.get(module, []))
            db.execute(text("""
                INSERT INTO role_permissions
                    (role, module_key, can_view, can_edit, can_approve, can_delete, can_export)
                VALUES (:r, :m, :v, :e, :a, false, :x)
                ON CONFLICT (role, module_key) DO UPDATE SET
                    can_view=EXCLUDED.can_view,
                    can_edit=EXCLUDED.can_edit,
                    can_approve=EXCLUDED.can_approve,
                    can_export=EXCLUDED.can_export
            """), {
                "r": role,
                "m": module,
                "v": "view" in actions,
                "e": "edit" in actions,
                "a": "approve" in actions,
                "x": "export" in actions,
            })
    db.commit()
    _audit(db, user["user_id"], "update_role_matrix", "", {"roles": list(body.matrix.keys())})
    return {"ok": True}


# ---------------------------------------------------------------- SCHEME ACCESS
@router.get("/access/{user_id}")
def get_access(user_id: int, user: dict = Depends(require("admin", "view")), db: Session = Depends(get_db)):
    granted = db.execute(text("SELECT scheme_id FROM user_scheme_access WHERE user_id=:u"),
                         {"u": user_id}).scalars().all()
    schemes = db.execute(text("""SELECT scheme_id, scheme_name FROM scheme_master
                                 WHERE COALESCE(is_deleted, FALSE) = FALSE ORDER BY scheme_name""")).mappings().all()
    return {"granted": [int(g) for g in granted], "schemes": [dict(s) for s in schemes]}


@router.put("/access/{user_id}")
def put_access(user_id: int, body: AccessIn, user: dict = Depends(require("admin", "edit")), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM user_scheme_access WHERE user_id=:u"), {"u": user_id})
    for sid in set(body.scheme_ids):
        db.execute(text("""INSERT INTO user_scheme_access (user_id, scheme_id, access_level, granted_by)
                           VALUES (:u,:s,'view',:g) ON CONFLICT DO NOTHING"""),
                   {"u": user_id, "s": sid, "g": user["user_id"]})
    db.commit()
    _audit(db, user["user_id"], "set_scheme_access", str(user_id), {"count": len(set(body.scheme_ids))})
    return {"ok": True, "granted": len(set(body.scheme_ids))}


# ---------------------------------------------------------------- AUDIT
@router.get("/audit")
def get_audit(limit: int = 100, user: dict = Depends(require("admin", "view")), db: Session = Depends(get_db)):
    rows = db.execute(text("""SELECT a.id, a.actor_user_id, u.username AS actor, a.action, a.target,
                                     a.detail, a.at::text AS at
                              FROM admin_audit a LEFT JOIN users u ON u.user_id = a.actor_user_id
                              ORDER BY a.id DESC LIMIT :n"""), {"n": min(limit, 500)}).mappings().all()
    return {"entries": [dict(r) for r in rows]}


# ---------------------------------------------------------------- SETTINGS (Sprint 2)
def _settings_payload(db: Session) -> dict:
    rows = db.execute(text(
        "SELECT setting_key, setting_value FROM app_settings"
    )).mappings().all()
    raw = {r["setting_key"]: r["setting_value"] for r in rows}
    for k, v in DEFAULT_SETTINGS.items():
        raw.setdefault(k, v)

    def flag(k: str) -> bool:
        return str(raw.get(k, "1")).strip().lower() in ("1", "true", "yes", "on")

    try:
        backdate = max(0, min(365, int(raw.get("daily_progress_backdate_days") or 7)))
    except Exception:
        backdate = 7
    return {
        "header_title": raw.get("header_title") or DEFAULT_SETTINGS["header_title"],
        "header_subtitle": raw.get("header_subtitle") or DEFAULT_SETTINGS["header_subtitle"],
        "org_name": raw.get("org_name") or DEFAULT_SETTINGS["org_name"],
        "logo_url": raw.get("logo_url") or "",
        "primary_color": raw.get("primary_color") or "#0b3d91",
        "daily_progress_backdate_days": backdate,
        "menu_show_ppe": flag("menu_show_ppe"),
        "menu_show_ai": flag("menu_show_ai"),
        "menu_show_delay": flag("menu_show_delay"),
        "active_financial_year": raw.get("active_financial_year") or "",
    }


@router.get("/settings")
def get_settings(user: dict = Depends(require("admin", "view")), db: Session = Depends(get_db)):
    """Admin branding + DPR controls + menu toggles."""
    return _settings_payload(db)


@router.put("/settings")
def put_settings(body: SettingsIn, user: dict = Depends(require("admin", "edit")),
                 db: Session = Depends(get_db)):
    data = body.model_dump(exclude_none=True)
    if "daily_progress_backdate_days" in data:
        days = int(data["daily_progress_backdate_days"])
        if days < 0 or days > 365:
            raise HTTPException(422, "backdate days must be 0–365")
        set_setting(db, "daily_progress_backdate_days", str(days))
        del data["daily_progress_backdate_days"]
    for bool_key in ("menu_show_ppe", "menu_show_ai", "menu_show_delay"):
        if bool_key in data:
            set_setting(db, bool_key, "1" if data[bool_key] else "0")
            del data[bool_key]
    for k, v in data.items():
        if k in DEFAULT_SETTINGS:
            set_setting(db, k, str(v))
    db.commit()
    _audit(db, user.get("user_id"), "update_settings", "", data)
    return {"ok": True, **_settings_payload(db)}


@router.get("/branding")
def get_branding(db: Session = Depends(get_db)):
    """Public branding slice for shell / login (no admin role required)."""
    s = _settings_payload(db)
    return {
        "header_title": s["header_title"],
        "header_subtitle": s["header_subtitle"],
        "org_name": s["org_name"],
        "logo_url": s["logo_url"],
        "primary_color": s["primary_color"],
        "menu_show_ppe": s["menu_show_ppe"],
        "menu_show_ai": s["menu_show_ai"],
        "menu_show_delay": s["menu_show_delay"],
        "active_financial_year": s["active_financial_year"],
    }


@router.get("/dpr-controls")
def get_dpr_controls(user: dict = Depends(require_existing_user), db: Session = Depends(get_db)):
    """Any authenticated user can read backdate window (DPR client needs it)."""
    days = get_dpr_backdate_days(db)
    return {"backdateDays": days, "daily_progress_backdate_days": days}

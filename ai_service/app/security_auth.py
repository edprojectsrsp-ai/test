"""Sprint 0 — JWT gate for the AI service (shared secret with project-brain-backend).

Env:
  JWT_SECRET / PB_AUTH_SECRET  — must match the main backend
  PB_AUTH_ENFORCE              — 1 (default) enforce; 0 soft demo mode
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from jose import JWTError, jwt
except ImportError:  # pragma: no cover
    jwt = None
    JWTError = Exception  # type: ignore

JWT_SECRET = (
    os.environ.get("JWT_SECRET")
    or os.environ.get("PB_AUTH_SECRET")
    or "change-me-in-env-pb-secret"
)
JWT_ALG = "HS256"
AUTH_ENFORCE = (os.environ.get("PB_AUTH_ENFORCE", "1").strip().lower()
                not in ("0", "false", "no", "off"))

bearer_scheme = HTTPBearer(auto_error=False)


def require_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not AUTH_ENFORCE:
        if credentials and jwt is not None:
            try:
                payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
                return {"user_id": int(payload.get("sub") or 0), "role": payload.get("role", "viewer")}
            except Exception:
                pass
        return {"user_id": 0, "role": "admin", "username": "demo"}

    if not credentials:
        raise HTTPException(401, "Missing authorization header")
    if jwt is None:
        raise HTTPException(500, "python-jose not installed on AI service")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError as e:
        raise HTTPException(401, f"Invalid token: {e}")
    return {
        "user_id": int(payload.get("sub") or 0),
        "role": payload.get("role", "viewer"),
    }

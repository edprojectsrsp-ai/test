"""Admin authentication for the cloud, reusing the Project Brain login.

The licence screen must be behind a real login: it mints the codes that let a
machine enrol. Rather than invent a second set of admin accounts, this verifies
the JWT that project-brain-backend already issues at /api/v1/auth/login. Both
services then share one set of users and one password policy, and this service
needs no user table, no password hashing and no database call to authenticate --
only the same JWT_SECRET.

Verified with the standard library rather than python-jose. HS256 is an HMAC
over two base64url segments, and adding a dependency to this requirements.txt
would also add it to the edge agent's shipped venv, which is a 1.5 GB payload
built for plant PCs that will never serve an admin page.

Hand-rolled JWT verification is where things go wrong, so, explicitly:
  * the algorithm is pinned to HS256 -- a token asking for "none", or for an
    RS256 verify that would treat a public key as an HMAC secret, is rejected
    before any signature check;
  * the signature is compared with compare_digest;
  * exp is required and enforced.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer_scheme = HTTPBearer(auto_error=False)

# Same names project-brain-backend reads, so one variable configures both.
# No default: this service refuses to authenticate anyone rather than fall back
# to a shared placeholder that is published in the other repo's source.
def _secret() -> str:
    return (os.environ.get("JWT_SECRET")
            or os.environ.get("PB_AUTH_SECRET")
            or "").strip()


ADMIN_ROLES = {"admin", "manager"}


def _b64url_decode(segment: str) -> bytes:
    pad = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + pad)


def decode_token(token: str) -> dict:
    """Return the payload of a valid HS256 JWT, or raise HTTPException(401)."""
    secret = _secret()
    if not secret:
        raise HTTPException(
            503, "admin API is not configured (set JWT_SECRET to the same value "
                 "as project-brain-backend)")

    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(401, "malformed token")
    header_b64, payload_b64, sig_b64 = parts

    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(sig_b64)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(401, "malformed token")

    if header.get("alg") != "HS256":
        raise HTTPException(401, "unsupported token algorithm")

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{header_b64}.{payload_b64}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "invalid token signature")

    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        raise HTTPException(401, "token has no expiry")
    if time.time() >= exp:
        raise HTTPException(401, "token has expired")

    return payload


def require_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """FastAPI dependency: a valid Project Brain token with an admin role."""
    if creds is None or not creds.credentials:
        raise HTTPException(401, "sign in to manage licence codes")
    payload = decode_token(creds.credentials)
    role = str(payload.get("role") or "").strip().lower()
    if role not in ADMIN_ROLES:
        raise HTTPException(403, "your account cannot manage licence codes")
    return {"user_id": payload.get("sub") or payload.get("user_id"), "role": role}

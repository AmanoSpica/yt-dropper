import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from app_state import (
    ENVIRONMENT,
    ADMIN_EMAIL,
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_DAYS,
    db,
    logger,
)

router = APIRouter()


class AllowedEmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_and_validate_email(cls, value: str) -> str:
        normalized = value.lower().strip()
        if not normalized or "@" not in normalized:
            raise ValueError("有効なメールアドレスを入力してください")
        return normalized


async def _get_session_user(request: Request):
    """Return AuthUser for the current session cookie, or None."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    session = await db.authsession.find_unique(
        where={"token": token},
        include={"user": True},
    )
    if session is None:
        return None
    if session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        await db.authsession.delete(where={"id": session.id})
        return None
    return session.user


async def require_session(request: Request):
    """Dependency: raise 401 if not authenticated."""
    user = await _get_session_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_admin(request: Request):
    """Dependency: raise 403 if not ADMIN."""
    user = await require_session(request)
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


OAUTH_STATE_TTL_SECONDS = 600
OAUTH_STATE_COOKIE_NAME = "oauth_state_token"


def _create_oauth_state() -> str:
    """Create a JWT-signed OAuth state token."""
    nonce = secrets.token_urlsafe(24)
    payload = {
        "nonce": nonce,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=OAUTH_STATE_TTL_SECONDS),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def _verify_oauth_state(token: str) -> str:
    """Verify OAuth state JWT token and return nonce."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        nonce = payload.get("nonce")
        if not nonce or not isinstance(nonce, str):
            raise HTTPException(status_code=400, detail="Invalid state")
        return nonce
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="State expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Invalid state")


@router.get("/api/auth/github")
async def auth_github_redirect() -> RedirectResponse:
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GITHUB_CLIENT_ID is not configured")
    if not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GITHUB_CLIENT_SECRET is not configured")

    state_token = _create_oauth_state()
    params = urlencode({
        "client_id": GITHUB_CLIENT_ID,
        "scope": "read:user user:email",
        "state": state_token,
    })
    response = RedirectResponse(url=f"https://github.com/login/oauth/authorize?{params}")
    response.set_cookie(
        key=OAUTH_STATE_COOKIE_NAME,
        value=state_token,
        max_age=OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False if ENVIRONMENT == "development" else True,
        path="/",
    )
    return response


@router.get("/api/auth/github/callback")
async def auth_github_callback(code: str, state: str, request: Request) -> RedirectResponse:
    # Verify state JWT token
    _verify_oauth_state(state)

    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GITHUB_CLIENT_ID is not configured")
    if not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GITHUB_CLIENT_SECRET is not configured")

    token_payload = {
        "client_id": GITHUB_CLIENT_ID,
        "client_secret": GITHUB_CLIENT_SECRET,
        "code": code,
    }

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            data=token_payload,
            headers={"Accept": "application/json"},
        )

    try:
        token_data = token_resp.json()
    except ValueError:
        token_data = {}

    if token_resp.status_code >= 400:
        error_text = token_data.get("error_description") or token_data.get("error") or token_resp.text
        raise HTTPException(
            status_code=502,
            detail=f"Failed to obtain access token: {error_text}",
        )

    access_token = token_data.get("access_token")
    if not access_token:
        error_text = token_data.get("error_description") or token_data.get("error")
        if error_text:
            raise HTTPException(status_code=400, detail=f"Failed to obtain access token: {error_text}")
        raise HTTPException(status_code=400, detail="Failed to obtain access token")

    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        github_user = user_resp.json()

    github_id = github_user.get("id")
    if not isinstance(github_id, int):
        raise HTTPException(status_code=400, detail="Failed to get GitHub user")

    name = github_user.get("name") or github_user.get("login") or "Unknown"
    avatar_url = github_user.get("avatar_url")

    email: str | None = github_user.get("email")
    if not email:
        async with httpx.AsyncClient() as client:
            emails_resp = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
            if emails_resp.status_code == 200:
                for entry in emails_resp.json():
                    if isinstance(entry, dict) and entry.get("primary") and entry.get("verified"):
                        email = entry.get("email")
                        break
    if not email:
        raise HTTPException(status_code=400, detail="GitHub アカウントにメールアドレスが見つかりません")

    email = email.lower().strip()

    logger.info(f"[AUTH] github_email={email!r}, ADMIN_EMAIL={ADMIN_EMAIL!r}, match={email == ADMIN_EMAIL.lower().strip()}")
    is_admin_email = ADMIN_EMAIL and email == ADMIN_EMAIL.lower().strip()
    if not is_admin_email:
        allowed = await db.allowedemail.find_unique(where={"email": email})
        if allowed is None:
            raise HTTPException(status_code=403, detail="このメールアドレスはアクセスが許可されていません")

    role = "ADMIN" if is_admin_email else "USER"

    user = await db.authuser.upsert(
        where={"github_id": github_id},
        data={
            "create": {"github_id": github_id, "email": email, "name": name, "avatar_url": avatar_url, "role": role},
            "update": {"name": name, "avatar_url": avatar_url, "email": email, "role": role},
        },
    )

    session_token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_MAX_AGE_DAYS)
    await db.authsession.create(
        data={
            "user_id": user.id,
            "token": session_token,
            "expires_at": expires_at,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        },
    )

    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        max_age=SESSION_MAX_AGE_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=False if ENVIRONMENT == "development" else True,
        path="/",
    )
    response.delete_cookie(key=OAUTH_STATE_COOKIE_NAME, path="/")
    return response


@router.get("/api/auth/me")
async def auth_me(request: Request) -> dict[str, Any]:
    user = await _get_session_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.id,
        "github_id": user.github_id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "role": user.role,
    }


@router.post("/api/auth/logout")
async def auth_logout(request: Request) -> Response:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        session = await db.authsession.find_unique(where={"token": token})
        if session:
            await db.authsession.delete(where={"id": session.id})
    response = Response(status_code=200)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return response


@router.get("/api/admin/users")
async def list_users(request: Request) -> dict[str, Any]:
    await require_admin(request)
    users = await db.authuser.find_many(order={"created_at": "asc"})
    return {
        "users": [
            {
                "id": u.id,
                "github_id": u.github_id,
                "email": u.email,
                "name": u.name,
                "avatar_url": u.avatar_url,
                "role": u.role,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
    }


@router.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: str, request: Request) -> dict[str, str]:
    admin = await require_admin(request)
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="自分自身は削除できません")
    target = await db.authuser.find_unique(where={"id": user_id})
    if target is None:
        raise HTTPException(status_code=404, detail="ユーザーが見つかりません")
    if target.role == "ADMIN":
        admin_count = await db.authuser.count(where={"role": "ADMIN"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="少なくとも1人の管理者が必要です")
    await db.authuser.delete(where={"id": user_id})
    return {"status": "deleted"}


@router.get("/api/admin/allowed-emails")
async def list_allowed_emails(request: Request) -> dict[str, Any]:
    await require_admin(request)
    rows = await db.allowedemail.find_many(order={"created_at": "asc"})
    return {
        "emails": [
            {"id": r.id, "email": r.email, "created_at": r.created_at.isoformat()}
            for r in rows
        ]
    }


@router.post("/api/admin/allowed-emails")
async def add_allowed_email(payload: AllowedEmailRequest, request: Request) -> dict[str, Any]:
    await require_admin(request)
    email = payload.email
    existing = await db.allowedemail.find_unique(where={"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="このメールアドレスは既に登録されています")
    row = await db.allowedemail.create(data={"email": email})
    return {"id": row.id, "email": row.email, "created_at": row.created_at.isoformat()}


@router.delete("/api/admin/allowed-emails/{email_id}")
async def delete_allowed_email(email_id: str, request: Request) -> dict[str, str]:
    await require_admin(request)
    row = await db.allowedemail.find_unique(where={"id": email_id})
    if row is None:
        raise HTTPException(status_code=404, detail="メールアドレスが見つかりません")
    await db.allowedemail.delete(where={"id": email_id})
    return {"status": "deleted"}

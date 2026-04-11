import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Request

from app_state import COOKIES_DIR, db
from routes.auth_routes import require_session

router = APIRouter()


def _is_netscape_cookies_text(text: str) -> bool:
    # Mirror frontend validation logic to keep behavior consistent.
    lines = [line for line in text.split("\n") if line.strip() and not line.startswith("#")]
    if not lines:
        return False

    for line in lines:
        parts = line.split("\t")
        if len(parts) != 7:
            return False
        if parts[1] not in ("TRUE", "FALSE"):
            return False
        if parts[3] not in ("TRUE", "FALSE"):
            return False
        if not re.fullmatch(r"\d+", parts[4]):
            return False

    return True


@router.get("/api/cookies")
async def list_cookies(request: Request) -> dict[str, Any]:
    user = await require_session(request)
    if user.cookies_txt:
        if os.path.isfile(os.path.join(COOKIES_DIR, user.cookies_txt)):
            return {
                "cookie_exists": True,
                "uploaded_at": user.cookies_uploaded_at.isoformat() if user.cookies_uploaded_at else None,
                "enable_cookies": user.enable_cookies,
            }
        await db.authuser.update(
            where={"id": user.id},
            data={"cookies_txt": None, "cookies_uploaded_at": None, "enable_cookies": False},
        )
    return {"cookie_exists": False}


@router.post("/api/cookies")
async def upload_cookie(request: Request) -> dict[str, str]:
    user = await require_session(request)
    form = await request.form()
    cookies_file = form.get("cookies_file")
    if not cookies_file or not hasattr(cookies_file, "read") or not getattr(cookies_file, "filename", None):
        raise HTTPException(status_code=400, detail="No file uploaded")

    upload_file = cast(Any, cookies_file)
    file_bytes = await upload_file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        file_text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="cookies.txt must be UTF-8 text")

    if not _is_netscape_cookies_text(file_text):
        raise HTTPException(status_code=400, detail="Invalid cookies.txt format")

    file_id = uuid.uuid4().hex[:8]
    filename = f"{user.id}_{file_id}.txt"
    save_path = os.path.join(COOKIES_DIR, filename)
    with open(save_path, "wb") as file_obj:
        file_obj.write(file_bytes)

    if user.cookies_txt:
        old_path = os.path.join(COOKIES_DIR, user.cookies_txt)
        if os.path.isfile(old_path):
            try:
                os.remove(old_path)
            except OSError:
                pass

    await db.authuser.update(
        where={"id": user.id},
        data={"cookies_txt": filename, "cookies_uploaded_at": datetime.now(timezone.utc), "enable_cookies": False},
    )
    return {"status": "uploaded"}


@router.delete("/api/cookies")
async def delete_cookie(request: Request) -> dict[str, str]:
    user = await require_session(request)
    if user.cookies_txt:
        file_path = os.path.join(COOKIES_DIR, user.cookies_txt)
        if os.path.isfile(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        await db.authuser.update(
            where={"id": user.id},
            data={"cookies_txt": None, "cookies_uploaded_at": None, "enable_cookies": False},
        )
    return {"status": "deleted"}


@router.post("/api/cookies/enable")
async def enable_cookies(request: Request) -> dict[str, bool]:
    user = await require_session(request)
    body = await request.json()
    enable = body.get("enable")
    if not isinstance(enable, bool):
        raise HTTPException(status_code=400, detail="'enable' must be a boolean")

    if not user.cookies_txt:
        raise HTTPException(status_code=400, detail="No cookies.txt uploaded")
    if not os.path.isfile(os.path.join(COOKIES_DIR, user.cookies_txt)):
        await db.authuser.update(
            where={"id": user.id},
            data={"cookies_txt": None, "cookies_uploaded_at": None, "enable_cookies": False},
        )
        raise HTTPException(status_code=400, detail="Uploaded cookies.txt file not found on server")

    await db.authuser.update(where={"id": user.id}, data={"enable_cookies": enable})
    return {"status": enable}

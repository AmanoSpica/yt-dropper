# Based on reclip project (MIT License)
# https://github.com/averygan/reclip
# Modified by AmanoSpica

import asyncio
import datetime
import glob
import json
import os
import re
import subprocess
import threading
from typing import Annotated, Literal, Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from prisma import Prisma

from app_state import ALL_YT_DLP_OPTIONS, COOKIES_DIR, DOWNLOAD_DIR, DOWNLOAD_TIMEOUT, db, logger
from routes.auth_routes import require_admin, require_session

router = APIRouter()

ADMIN_STORAGE_LIMIT_KEY = "max_storage_gb"
DEFAULT_ADMIN_STORAGE_LIMIT_GB = 10.0
MAX_CONCURRENT_DOWNLOADS = max(1, int(os.environ.get("MAX_CONCURRENT_DOWNLOADS", "2")))

_download_slots = threading.BoundedSemaphore(MAX_CONCURRENT_DOWNLOADS)
_pending_download_jobs: list[tuple[str, str, str, str | None, bool]] = []
_pending_download_jobs_lock = threading.Lock()


class UrlRequest(BaseModel):
    url: Annotated[str, Field(min_length=1, max_length=2000)]

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("URL is required")
        return normalized


class DownloadRequest(BaseModel):
    url: Annotated[str, Field(min_length=1, max_length=2000)]
    format: Literal["MP3", "MP4"] = "MP4"
    format_id: Annotated[str | None, Field(default=None, max_length=100)] = None
    title: Annotated[str, Field(default="", max_length=500)] = ""
    thumbnail: Annotated[str, Field(default="", max_length=2000)] = ""

    @field_validator("url")
    @classmethod
    def validate_download_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("URL is required")
        return normalized

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return value.strip()

    @field_validator("thumbnail")
    @classmethod
    def normalize_thumbnail(cls, value: str) -> str:
        return value.strip()

    @field_validator("format_id")
    @classmethod
    def normalize_format_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DownloadJobIdsRequest(BaseModel):
    job_ids: list[str]

    @field_validator("job_ids")
    @classmethod
    def validate_job_ids(cls, value: list[str]) -> list[str]:
        normalized_ids = [job_id.strip() for job_id in value if job_id.strip()]
        if not normalized_ids:
            raise ValueError("job_ids is required")
        # Keep order while removing duplicates.
        deduped_ids = list(dict.fromkeys(normalized_ids))
        return deduped_ids


class AdminStorageLimitRequest(BaseModel):
    max_storage_gb: Annotated[float, Field(gt=0)]


async def _create_cookie_cmd(cookies_txt: str | None) -> list[str]:
    if cookies_txt and os.path.isfile(os.path.join(COOKIES_DIR, cookies_txt)):
        return ["--cookies", os.path.join(COOKIES_DIR, cookies_txt)]
    return []


def _format_file_size(bytes_size):
    # float(KB) -> string (KB, MB, GB)
    if bytes_size < 1024:
        return f"{bytes_size:.2f} KB"
    elif bytes_size < 1024 ** 2:
        return f"{bytes_size / 1024:.2f} MB"
    else:
        return f"{bytes_size / (1024 ** 2):.2f} GB"


def _delete_files_for_job(job_id: str) -> int:
    deleted_count = 0
    for file_path in glob.glob(os.path.join(DOWNLOAD_DIR, f"{job_id}.*")):
        try:
            os.remove(file_path)
            deleted_count += 1
        except OSError:
            logger.warning(f"Failed to delete file: {file_path}")
    return deleted_count


def _delete_file_by_basename(filename: str) -> bool:
    target_path = os.path.join(DOWNLOAD_DIR, filename)
    if not os.path.isfile(target_path):
        return False
    try:
        os.remove(target_path)
        return True
    except OSError:
        logger.warning(f"Failed to delete file: {target_path}")
        return False


def _get_download_dir_usage_bytes() -> int:
    total = 0
    for entry in os.scandir(DOWNLOAD_DIR):
        if entry.is_file():
            try:
                total += entry.stat().st_size
            except OSError:
                logger.warning(f"Failed to read file size: {entry.path}")
    return total


async def _get_admin_storage_limit_gb(prisma_client: Prisma = db) -> float:
    setting = await prisma_client.adminsetting.find_unique(where={"key": ADMIN_STORAGE_LIMIT_KEY})
    if setting is None:
        return DEFAULT_ADMIN_STORAGE_LIMIT_GB
    try:
        parsed = float(setting.value)
        return parsed if parsed > 0 else DEFAULT_ADMIN_STORAGE_LIMIT_GB
    except (TypeError, ValueError):
        return DEFAULT_ADMIN_STORAGE_LIMIT_GB


def _queue_download_job(job_id: str, url: str, format_choice: str, format_id: str | None, enable_cookies: bool) -> None:
    with _pending_download_jobs_lock:
        _pending_download_jobs.append((job_id, url, format_choice, format_id, enable_cookies))


def _try_start_download_job(job_id: str, url: str, format_choice: str, format_id: str | None, enable_cookies: bool) -> bool:
    if not _download_slots.acquire(blocking=False):
        return False

    try:
        thread = threading.Thread(
            target=_run_download_job_in_thread,
            args=(job_id, url, format_choice, format_id, enable_cookies, True),
            daemon=True,
        )
        thread.start()
        return True
    except Exception:
        _download_slots.release()
        raise


def _start_next_queued_download() -> None:
    with _pending_download_jobs_lock:
        if not _pending_download_jobs:
            return
        next_job = _pending_download_jobs.pop(0)

    started = _try_start_download_job(*next_job)
    if not started:
        with _pending_download_jobs_lock:
            _pending_download_jobs.insert(0, next_job)


async def get_video_info(url: str, cookies_txt: str | None = None) -> dict[str, object]:
    cmd = ["yt-dlp", "--no-playlist", "-j"]
    cmd += ALL_YT_DLP_OPTIONS
    cmd += await _create_cookie_cmd(cookies_txt)
    cmd.append(url)
    try:
        logger.info(f"Running yt-dlp for info: {cmd}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(status_code=502, detail=f"yt-dlp error: {result.stderr.strip()}")

        info = json.loads(result.stdout)

        best_by_height = {}
        best_audio = None
        for format_row in info.get("formats", []):
            height = format_row.get("height")
            if height and format_row.get("vcodec", "none") != "none":
                if height not in best_by_height or (format_row.get("vbr") or 0) > (best_by_height[height].get("vbr") or 0):
                    best_by_height[height] = format_row
            if format_row.get("acodec", "none") != "none":
                if best_audio is None or (format_row.get("abr") or 0) > (best_audio.get("abr") or 0):
                    best_audio = format_row

        audio_file_size_kb: int = best_audio.get("filesize_approx", 0) / 1024 if best_audio and best_audio.get("filesize_approx") else 0

        formats = []
        for height, format_row in best_by_height.items():
            predicted_file_size_kb: int = 0
            if format_row.get("filesize_approx"):
                predicted_file_size_kb = format_row["filesize_approx"] / 1024
            formats.append({
                "id": format_row["format_id"],
                "label": f"{height}p",
                "height": height,
                "size": predicted_file_size_kb + audio_file_size_kb,
            })
        formats.sort(key=lambda item: item["height"], reverse=True)

        return {
            "id": info.get("id"),
            "url": info.get("original_url"),
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail", ""),
            "duration": info.get("duration"),
            "uploader": info.get("uploader", ""),
            "formats": formats,
            "mp3_size": audio_file_size_kb,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="yt-dlp timed out")
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse yt-dlp output")
    except Exception as error:
        logger.error(f"Error running yt-dlp: {error}")
        raise HTTPException(status_code=500, detail=f"Error running yt-dlp: {str(error)}")


@router.post("/api/info")
async def fetch_video_info(payload: UrlRequest, request: Request) -> dict[str, object]:
    user = await require_session(request)
    url = payload.url
    return await get_video_info(url, user.cookies_txt if user.enable_cookies else None)


@router.post("/api/youtube-playlist")
async def fetch_playlist_info(payload: UrlRequest, request: Request) -> dict[str, object]:
    user = await require_session(request)
    url = payload.url

    cmd = ["yt-dlp", "--flat-playlist", "-J"]
    cmd += ALL_YT_DLP_OPTIONS
    cmd += await _create_cookie_cmd(user.cookies_txt if user.enable_cookies else None)
    cmd.append(url)
    try:
        logger.info(f"Running yt-dlp for playlist: {cmd}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr.strip().split("\n")[-1])

        info = json.loads(result.stdout)
        entries = info.get("entries", [])
        urls = [entry.get("url") for entry in entries if entry.get("url")]
        return {"urls": urls}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="yt-dlp timed out")
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse yt-dlp output")
    except Exception as error:
        logger.error(f"Error running yt-dlp: {error}")
        raise HTTPException(status_code=500, detail=f"Error running yt-dlp: {str(error)}")


@router.post("/api/download")
async def download_video(payload: DownloadRequest, request: Request):
    user = await require_session(request)
    url = payload.url
    format_choice = payload.format
    format_id = payload.format_id
    title = payload.title
    thumbnail = payload.thumbnail

    job_info = await db.downloadjob.create(data={
        "url": url,
        "title": title,
        "thumbnail": thumbnail,
        "status": "queued",
        "progress": 0.0,
        "user_id": user.id,
    })

    started = _try_start_download_job(
        job_info.id,
        url,
        format_choice,
        format_id,
        user.enable_cookies,
    )
    if not started:
        _queue_download_job(job_info.id, url, format_choice, format_id, user.enable_cookies)

    return {"job_id": job_info.id}


def _run_download_job_in_thread(job_id, url, format_choice, format_id, enable_cookies=False, mark_as_downloading=True):
    try:
        asyncio.run(_run_download_job_with_thread_client(job_id, url, format_choice, format_id, enable_cookies, mark_as_downloading))
    finally:
        _download_slots.release()
        _start_next_queued_download()


async def _run_download_job_with_thread_client(job_id, url, format_choice, format_id, enable_cookies=False, mark_as_downloading=True):
    thread_db = Prisma()
    await thread_db.connect()
    try:
        if mark_as_downloading:
            try:
                await thread_db.downloadjob.update(
                    where={"id": job_id},
                    data={"status": "downloading", "progress": 0.0, "error": None},
                )
            except Exception:
                return
        await run_download_job(thread_db, job_id, url, format_choice, format_id, enable_cookies)
    finally:
        await thread_db.disconnect()


async def run_download_job(prisma_client: Prisma, job_id, url, format_choice: Literal["MP3", "MP4"], format_id, enable_cookies=False):
    job_info = await prisma_client.downloadjob.find_unique(where={"id": job_id}, include={"user": True})
    if job_info is None:
        return

    video_data: dict[str, Any] = await get_video_info(url, job_info.user.cookies_txt if enable_cookies and job_info.user else None)
    predicted_size_kb: int | None = None
    if format_choice == "MP3":
        predicted_size_kb: int | None = video_data.get("mp3_size")
    else:
        raw_formats = video_data.get("formats")
        format_items = raw_formats if isinstance(raw_formats, list) else []
        video_format_data = (
            next(
                (
                    item
                    for item in format_items
                    if isinstance(item, dict) and str(item.get("id")) == str(format_id)
                ),
                None,
            )
            if format_id
            else None
        )
        predicted_size_kb = video_format_data.get("size") if video_format_data else None

    if predicted_size_kb is not None:
        download_capacity = await check_download_capacity(prisma_client, predicted_size_kb)
        if predicted_size_kb and not download_capacity["download_allowed"]:
            await prisma_client.downloadjob.update(
                where={"id": job_id},
                data={
                    "status": "error",
                    "error": f"容量不足: {_format_file_size(predicted_size_kb + download_capacity['current_usage_kb'])}/{_format_file_size(download_capacity['max_storage_kb'])}",
                    "progress": 100.0,
                },
            )
            return
    else:
        logger.warning(f"Job {job_id}: predicted size unavailable, skipping capacity check")

    out_template = os.path.join(DOWNLOAD_DIR, f"{job_id}.%(ext)s")

    cmd = ["yt-dlp", "--no-playlist", "-o", out_template]
    cmd += ALL_YT_DLP_OPTIONS
    cmd += await _create_cookie_cmd(job_info.user.cookies_txt if enable_cookies else None) if job_info.user else []
    cmd += ["--newline", "--progress"]

    if format_choice == "MP3":
        cmd += ["-x", "--audio-format", "mp3", "-S", "acodec:aac"]
    elif format_id:
        cmd += ["-f", f"{format_id}+bestaudio/best", "--merge-output-format", "mp4", "-S", "acodec:aac"]
    else:
        cmd += ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4", "-S", "acodec:aac"]

    cmd.append(url)

    process = None
    try:
        logger.info(f"Starting download job {job_id} with command: {cmd}")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        progress_pattern = re.compile(r"\[download\]\s+Destination:|\[download\]\s+(\d+\.?\d*)%")
        last_error_lines = []

        if process.stdout is None:
            await prisma_client.downloadjob.update(
                where={"id": job_id},
                data={"status": "error", "error": "Failed to start download process"},
            )
            return

        for line in process.stdout:
            line = line.strip()
            if not line:
                continue

            match = progress_pattern.search(line)
            if match and match.group(1):
                try:
                    pct = float(match.group(1))
                    await prisma_client.downloadjob.update(
                        where={"id": job_id},
                        data={"progress": min(pct, 100.0)},
                    )
                except ValueError:
                    pass

            if line.startswith("ERROR:") or line.startswith("WARNING:"):
                last_error_lines.append(line)
                logger.warning(f"Job {job_id}: {line}")

        process.wait(timeout=DOWNLOAD_TIMEOUT)

        if process.returncode != 0:
            if last_error_lines:
                await prisma_client.downloadjob.update(
                    where={"id": job_id},
                    data={"status": "error", "error": last_error_lines[-1].replace("ERROR: ", "")},
                )
            else:
                await prisma_client.downloadjob.update(
                    where={"id": job_id},
                    data={"status": "error", "error": f"yt-dlp exited with code {process.returncode}"},
                )
            return

        files = glob.glob(os.path.join(DOWNLOAD_DIR, f"{job_id}.*"))
        if not files:
            await prisma_client.downloadjob.update(
                where={"id": job_id},
                data={"status": "error", "error": "Download completed but no file was found"},
            )
            return

        expected_ext = ".mp3" if format_choice == "MP3" else ".mp4"
        target = [file for file in files if file.endswith(expected_ext)]
        if not target:
            raise Exception("Downloaded file with unexpected format found")
        chosen = target[0]

        for file_path in files:
            if file_path != chosen:
                try:
                    os.remove(file_path)
                except OSError:
                    pass

        ext = os.path.splitext(chosen)[1]
        title = job_info.title or f"download-{job_id}"
        safe_title = "".join(char for char in title if char not in r'\\/:*?"<>|').strip().strip()

        file_size = None
        try:
            file_size = os.path.getsize(chosen)
        except OSError:
            pass

        await prisma_client.downloadjob.update(
            where={"id": job_id},
            data={
                "status": "done",
                "progress": 100.0,
                "file_size_kb": file_size / 1024 if file_size else None,
                "filename": f"{safe_title}{ext}" if safe_title else os.path.basename(chosen),
                "deleted_at": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1),
            },
        )
    except subprocess.TimeoutExpired:
        await prisma_client.downloadjob.update(
            where={"id": job_id},
            data={
                "status": "error",
                "error": f"Download timed out ({DOWNLOAD_TIMEOUT // 60} min limit). Try a lower quality format for large files.",
                "progress": 100.0,
            },
        )
        try:
            if process:
                process.kill()
        except Exception:
            pass
        for file_path in glob.glob(os.path.join(DOWNLOAD_DIR, f"{job_id}.*")):
            try:
                os.remove(file_path)
            except OSError:
                pass
    except Exception as error:
        await prisma_client.downloadjob.update(where={"id": job_id}, data={"status": "error", "error": str(error), "progress": 100.0})
        logger.exception(f"Job {job_id} failed with unexpected error")


# ダウンロード可能かを確認するヘルパー関数（容量）
async def check_download_capacity(prisma_client: Prisma, size_kb: float) -> dict:
    max_storage_gb = await _get_admin_storage_limit_gb(prisma_client)
    max_storage_kb = max_storage_gb * 1024 * 1024
    current_usage_kb = _get_download_dir_usage_bytes() / 1024
    return {"download_allowed": (current_usage_kb + size_kb) <= max_storage_kb, "current_usage_kb": current_usage_kb, "max_storage_kb": max_storage_kb}


@router.get("/api/status/{job_id}")
async def get_download_status(job_id: str, request: Request):
    user = await require_session(request)
    job_info = await db.downloadjob.find_unique(where={"id": job_id})
    if job_info is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job_info.user_id != user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to access this file")
    return {
        "id": job_info.id,
        "url": job_info.url,
        "title": job_info.title,
        "status": job_info.status,
        "progress": round(job_info.progress, 2),
        "error": job_info.error,
        "file_size_kb": job_info.file_size_kb,
        "filename": job_info.filename,
        "created_at": job_info.created_at.isoformat(),
    }


@router.get("/api/download-jobs")
async def list_download_jobs(request: Request):
    user = await require_session(request)
    jobs = await db.downloadjob.find_many(
        where={"user_id": user.id},
        order={"created_at": "desc"},
    )

    return {
        "jobs": [
            {
                "id": job.id,
                "url": job.url,
                "title": job.title,
                "thumbnail": job.thumbnail,
                "status": job.status,
                "progress": round(job.progress, 2),
                "error": job.error,
                "file_size_kb": job.file_size_kb,
                "filename": job.filename,
                "created_at": job.created_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
                "deleted_at": job.deleted_at.isoformat() if job.deleted_at else None,
            }
            for job in jobs
        ]
    }


@router.get("/api/admin/active-downloads")
async def list_admin_active_downloads(request: Request):
    await require_admin(request)
    jobs = await db.downloadjob.find_many(
        where={"status": {"in": ["downloading", "queued"]}},
        include={"user": True},
        order={"created_at": "desc"},
    )

    return {
        "jobs": [
            {
                "id": job.id,
                "url": job.url,
                "title": job.title,
                "thumbnail": job.thumbnail,
                "status": job.status,
                "progress": round(job.progress, 2),
                "error": job.error,
                "created_at": job.created_at.isoformat(),
                "user": {
                    "id": job.user.id,
                    "name": job.user.name,
                    "email": job.user.email,
                    "avatar_url": job.user.avatar_url,
                    "role": job.user.role,
                }
                if job.user
                else None,
            }
            for job in jobs
        ]
    }


@router.get("/api/admin/download-jobs")
async def list_admin_download_jobs(
    request: Request,
    status: Literal["downloading", "done"] = Query(default="downloading"),
):
    await require_admin(request)
    if status == "downloading":
        jobs = await db.downloadjob.find_many(
            where={"status": {"in": ["downloading", "queued"]}},
            include={"user": True},
            order={"created_at": "desc"},
        )
    else:
        jobs = await db.downloadjob.find_many(
            where={"status": "done"},
            include={"user": True},
            order={"created_at": "desc"},
        )

    if status == "done":
        all_job_ids = {
            item.id
            for item in await db.downloadjob.find_many()
        }
        orphan_jobs: list[dict[str, object]] = []
        for entry in os.scandir(DOWNLOAD_DIR):
            if not entry.is_file():
                continue

    if status == "done":
        all_job_ids = {
            item.id
            for item in await db.downloadjob.find_many()
        }
        orphan_jobs: list[dict[str, object]] = []
        for entry in os.scandir(DOWNLOAD_DIR):
            if not entry.is_file():
                continue

            filename = entry.name
            basename, _ = os.path.splitext(filename)
            if not basename or basename in all_job_ids:
                continue

            file_size_kb = None
            created_at_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            try:
                file_size_kb = entry.stat().st_size / 1024
                created_at_iso = datetime.datetime.fromtimestamp(entry.stat().st_mtime, tz=datetime.timezone.utc).isoformat()
            except OSError:
                pass

            orphan_jobs.append(
                {
                    "id": f"unknown:{filename}",
                    "url": "",
                    "title": "不明な動画",
                    "thumbnail": None,
                    "status": "done",
                    "progress": 100,
                    "error": None,
                    "file_size_kb": file_size_kb if file_size_kb else None,
                    "filename": filename,
                    "created_at": created_at_iso,
                    "updated_at": created_at_iso,
                    "deleted_at": None,
                    "user": None,
                    "is_unknown": True,
                }
            )

        orphan_jobs.sort(key=lambda item: str(item["created_at"]), reverse=True)
    else:
        orphan_jobs = []

    return {
        "jobs": [
            {
                "id": job.id,
                "url": job.url,
                "title": job.title,
                "thumbnail": job.thumbnail,
                "status": job.status,
                "progress": round(job.progress, 2),
                "error": job.error,
                "file_size_kb": job.file_size_kb if job.file_size_kb else None,
                "filename": job.filename,
                "created_at": job.created_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
                "deleted_at": job.deleted_at.isoformat() if job.deleted_at else None,
                "is_unknown": False,
                "user": {
                    "id": job.user.id,
                    "name": job.user.name,
                    "email": job.user.email,
                    "avatar_url": job.user.avatar_url,
                    "role": job.user.role,
                }
                if job.user
                else None,
            }
            for job in jobs
        ]
        + orphan_jobs
    }


@router.get("/api/admin/disk-usage")
async def get_admin_disk_usage(request: Request):
    await require_admin(request)
    used_bytes = _get_download_dir_usage_bytes()
    return {
        "used_bytes": used_bytes,
        "used_mb": round(used_bytes / (1024 * 1024), 2),
        "used_gb": round(used_bytes / (1024 * 1024 * 1024), 2),
    }


@router.get("/api/admin/storage-limit")
async def get_admin_storage_limit(request: Request):
    await require_admin(request)
    max_storage_gb = await _get_admin_storage_limit_gb()
    return {"max_storage_gb": max_storage_gb}


@router.put("/api/admin/storage-limit")
async def update_admin_storage_limit(payload: AdminStorageLimitRequest, request: Request):
    await require_admin(request)
    max_storage_gb = payload.max_storage_gb
    await db.adminsetting.upsert(
        where={"key": ADMIN_STORAGE_LIMIT_KEY},
        data={
            "create": {
                "key": ADMIN_STORAGE_LIMIT_KEY,
                "value": str(max_storage_gb),
            },
            "update": {
                "value": str(max_storage_gb),
            },
        },
    )
    return {"max_storage_gb": max_storage_gb}


@router.post("/api/download-jobs/delete-files")
async def delete_download_job_files(payload: DownloadJobIdsRequest, request: Request):
    user = await require_session(request)
    jobs = await db.downloadjob.find_many(
        where={
            "user_id": user.id,
            "id": {"in": payload.job_ids},
        }
    )

    now = datetime.datetime.now(datetime.timezone.utc)
    updated = 0
    skipped = 0

    for job in jobs:
        if job.status in ("downloading", "queued"):
            skipped += 1
            continue

        _delete_files_for_job(job.id)
        await db.downloadjob.update(
            where={"id": job.id},
            data={"deleted_at": now},
        )
        updated += 1

    return {"updated": updated, "skipped": skipped}


@router.post("/api/admin/download-jobs/delete-files")
async def admin_delete_download_job_files(payload: DownloadJobIdsRequest, request: Request):
    await require_admin(request)
    unknown_ids = [job_id for job_id in payload.job_ids if job_id.startswith("unknown:")]
    known_ids = [job_id for job_id in payload.job_ids if not job_id.startswith("unknown:")]

    jobs = await db.downloadjob.find_many(
        where={
            "id": {"in": known_ids},
        }
    )

    now = datetime.datetime.now(datetime.timezone.utc)
    updated = 0
    skipped = 0

    for job in jobs:
        if job.status in ("downloading", "queued"):
            skipped += 1
            continue

        _delete_files_for_job(job.id)
        await db.downloadjob.update(
            where={"id": job.id},
            data={"deleted_at": now},
        )
        updated += 1

    for unknown_id in unknown_ids:
        filename = unknown_id.removeprefix("unknown:").strip()
        if not filename:
            skipped += 1
            continue

        # Prevent path traversal and only allow deleting direct files under DOWNLOAD_DIR.
        if filename != os.path.basename(filename):
            skipped += 1
            continue

        if _delete_file_by_basename(filename):
            updated += 1
        else:
            skipped += 1

    return {"updated": updated, "skipped": skipped}


@router.delete("/api/download-jobs")
async def delete_download_job_history(payload: DownloadJobIdsRequest, request: Request):
    user = await require_session(request)
    jobs = await db.downloadjob.find_many(
        where={
            "user_id": user.id,
            "id": {"in": payload.job_ids},
        }
    )

    deleted = 0
    skipped = 0

    for job in jobs:
        if job.status in ("downloading", "queued"):
            skipped += 1
            continue

        _delete_files_for_job(job.id)
        await db.downloadjob.delete(where={"id": job.id})
        deleted += 1

    return {"deleted": deleted, "skipped": skipped}


@router.get("/api/download/{job_id}")
async def download_file(job_id: str, request: Request):
    user = await require_session(request)
    job_info = await db.downloadjob.find_unique(where={"id": job_id})
    if job_info is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job_info.user_id != user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to access this file")
    if job_info.status != "done" or not job_info.filename:
        raise HTTPException(status_code=400, detail="File is not ready for download")

    if job_info.deleted_at is not None and job_info.deleted_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(status_code=410, detail="File has been deleted. Downloads are available for 24 hours.")

    file_path = os.path.join(DOWNLOAD_DIR, f"{job_id}.*")
    files = glob.glob(file_path)
    if not files:
        raise HTTPException(status_code=404, detail="File not found")
    target_file = files[0]

    return FileResponse(
        path=target_file,
        media_type="application/octet-stream",
        filename=job_info.filename,
    )

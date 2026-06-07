import datetime
import logging
import os
import glob

from dotenv import load_dotenv
from prisma import Prisma
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()

ENVIRONMENT = os.environ.get("ENVIRONMENT", "production")

PORT = int(os.environ.get("SERVER_PORT", "3001"))

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")
if ENVIRONMENT == "production":
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY must be set when ENVIRONMENT=production")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_KEY = "access_token"
REFRESH_TOKEN_KEY = "refresh_token"
ACCESS_TOKEN_LIFETIME = datetime.timedelta(minutes=5)
REFRESH_TOKEN_LIFETIME = datetime.timedelta(days=7)

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URL = os.environ.get("DISCORD_REDIRECT_URL", "")
SESSION_COOKIE_NAME = "session_token"
SESSION_MAX_AGE_DAYS = 30
ADMIN_DISCORD_ID = os.environ.get("ADMIN_DISCORD_ID", "")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
DOWNLOAD_TIMEOUT = 30 * 60  # 30 minutes

COOKIES_DIR = os.path.join(os.path.dirname(__file__), "cookies_txt")
os.makedirs(COOKIES_DIR, exist_ok=True)

ALL_YT_DLP_OPTIONS = ["--js-runtime", "node"]

db = Prisma()
logger = logging.getLogger("uvicorn.app")
logger.setLevel(logging.INFO)

# Background scheduler for cleanup tasks
scheduler = AsyncIOScheduler()


async def cleanup_deleted_files():
    """Delete files that have been marked as deleted for more than 24 hours."""
    try:
        from datetime import timedelta, timezone
        now = datetime.datetime.now(timezone.utc)

        # Find jobs deleted more than 24 hours ago
        jobs = await db.downloadjob.find_many(
            where={
                "deleted_at": {"lt": now - timedelta(hours=24)},
            }
        )

        for job in jobs:
            file_path = os.path.join(DOWNLOAD_DIR, f"{job.id}.*")
            files = glob.glob(file_path)
            for file_path_item in files:
                try:
                    os.remove(file_path_item)
                    logger.info(f"Deleted file for job {job.id}: {file_path_item}")
                except OSError as e:
                    logger.error(f"Failed to delete file {file_path_item}: {e}")
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")


async def start_scheduler():
    """Start the background scheduler."""
    if not scheduler.running:
        scheduler.add_job(
            cleanup_deleted_files,
            "interval",
            hours=1,
            id="cleanup_files",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("Background scheduler started")


async def stop_scheduler():
    """Stop the background scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Background scheduler stopped")

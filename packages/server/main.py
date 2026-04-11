from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app_state import PORT, db, start_scheduler, stop_scheduler
from routes.auth_routes import router as auth_router
from routes.cookie_routes import router as cookie_router
from routes.download_routes import router as download_router
from routes.spa_routes import router as spa_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await db.connect()
    await start_scheduler()
    try:
        yield
    finally:
        await stop_scheduler()
        await db.disconnect()


fastapi_app = FastAPI(lifespan=lifespan)


fastapi_app.include_router(auth_router)
fastapi_app.include_router(cookie_router)
fastapi_app.include_router(download_router)
# SPA fallback must be registered last.
fastapi_app.include_router(spa_router)

app = fastapi_app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)

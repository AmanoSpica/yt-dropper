import os

from fastapi import APIRouter, HTTPException, Response

from app_state import STATIC_DIR

router = APIRouter()
_index_html: str | None = None


@router.get("/{full_path:path}")
async def spa_fallback(full_path: str) -> Response:
    """Serve static files; fall back to index.html for SPA routes."""
    global _index_html  # noqa: PLW0603

    file_path = os.path.join(STATIC_DIR, full_path)
    if full_path and os.path.isfile(file_path):
        import mimetypes

        content_type, _ = mimetypes.guess_type(file_path)
        with open(file_path, "rb") as file_obj:
            return Response(content=file_obj.read(), media_type=content_type or "application/octet-stream")

    index_path = os.path.join(STATIC_DIR, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=404, detail="Frontend not built. Run 'yarn build' in packages/app.")
    if _index_html is None:
        with open(index_path, "r", encoding="utf-8") as file_obj:
            _index_html = file_obj.read()
    return Response(content=_index_html, media_type="text/html")

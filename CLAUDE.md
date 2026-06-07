# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

yt-dropper is a self-hosted YouTube downloader with a monorepo structure:

- **`packages/app`** — React 19 + TypeScript frontend (Vite, Tailwind CSS v4, shadcn/ui)
- **`packages/server`** — Python FastAPI backend (Prisma ORM, PostgreSQL, yt-dlp)

In production, the frontend is built as static files into `packages/server/static/`, and the FastAPI server serves both the API and the SPA. In development, Vite dev server (port 3000) proxies `/api/*` requests to FastAPI (port 3001).

The root `package.json` / Yarn workspace manages only the frontend. Python dependencies are managed with `uv` via `packages/server/pyproject.toml`.

## Development Commands

### Frontend (`packages/app`)
```bash
yarn dev          # Start Vite dev server on port 3000 (proxies /api to :3001)
yarn build        # Build to packages/server/static/
yarn lint         # Run ESLint
```

### Backend (`packages/server`)
```bash
# From packages/server/ with .venv activated (or via uv run)
uvicorn main:app --host 0.0.0.0 --port 3001 --reload

# Or via the package script:
yarn dev   # in packages/server/
```

### Database (Prisma)
```bash
# From packages/server/
prisma db push          # Apply schema to DB (used in production/Docker)
prisma migrate dev      # Create and apply a migration (development)
prisma generate         # Regenerate Python client after schema changes
```

### Docker
```bash
docker compose up --build   # Build and run everything (web + postgres)
```

## Environment Variables

Required in `packages/server/.env` for local development:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Secret for OAuth state JWT signing |
| `DISCORD_CLIENT_ID` | Discord OAuth app client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth app client secret |
| `DISCORD_REDIRECT_URL` | OAuth2 callback URL, must match the Discord app's registered redirect (e.g. `http://localhost:3001/api/auth/discord/callback`) |
| `ADMIN_DISCORD_ID` | Discord user ID of the admin user (auto-granted ADMIN role on first login) |
| `ENVIRONMENT` | `development` or `production` (controls cookie `secure` flag) |
| `MAX_CONCURRENT_DOWNLOADS` | Default `2`; limits parallel yt-dlp processes |
| `SERVER_PORT` | Default `3001` |

## Key Design Decisions

### Authentication
Discord OAuth only. Access is allowlist-based: the `AllowedDiscordUser` table controls who can log in. The Discord ID matching `ADMIN_DISCORD_ID` is automatically granted `ADMIN` role. Sessions use a secure random token stored in a PostgreSQL `AuthSession` row (not JWT); the OAuth state parameter uses a short-lived JWT to prevent CSRF.

### Download Queue
Downloads run in background threads (`threading.Thread`) with a `BoundedSemaphore` to cap concurrency at `MAX_CONCURRENT_DOWNLOADS`. Each thread creates its own Prisma client because the main async event loop's client cannot be shared across threads. Jobs not immediately started are pushed to `_pending_download_jobs` (a plain list protected by a `Lock`) and dequeued when a slot frees up.

### File Lifecycle
Downloaded files are stored in `packages/server/downloads/{job_id}.{ext}`. When a user deletes a file, `deleted_at` is set to now; the file is immediately removed from disk. A background APScheduler job runs hourly and hard-deletes any file whose `deleted_at` is older than 24 hours. Completed downloads auto-expire 24 hours after completion (`deleted_at = now + 1 day` set at job completion).

### Cookies Support
Users can upload a Netscape-format `cookies.txt` file (per-user, stored in `packages/server/cookies_txt/`). They must explicitly enable it per-session. The backend validates the format server-side before saving.

### SPA Routing
The `spa_routes` router is registered last in `main.py` and catches all unmatched paths, serving `static/index.html` for client-side routing.

### Frontend Path Alias
`@/` maps to `packages/app/src/` (configured in `vite.config.ts`).

## Prisma Schema Notes

The schema uses `prisma-client-py` with async interface. After any change to `packages/server/prisma/schema.prisma`, run `prisma generate` to regenerate the Python client and `prisma migrate dev` (or `prisma db push` in prod) to apply the migration.

# ==========================================
# Stage 1: Frontend Build
# ==========================================
FROM node:24-alpine AS frontend-builder

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/app/package.json ./packages/app/
COPY packages/server/package.json ./packages/server/

ARG YARN_VERSION=4.12.0
RUN corepack prepare yarn@${YARN_VERSION} --activate

RUN yarn install --immutable

COPY packages/app ./packages/app

WORKDIR /app/packages/app

RUN yarn build


# ==========================================
# Stage 2: Python Dependencies
# ==========================================
FROM python:3.11-slim AS python-deps

# uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

ENV UV_COMPILE_BYTECODE=0 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY packages/server/pyproject.toml packages/server/uv.lock ./

RUN uv sync \
    --frozen \
    --no-dev \
    --no-cache


# ==========================================
# Stage 3: Runtime
# ==========================================
FROM python:3.11-slim AS runtime

ARG USERNAME=appuser
ARG USER_UID=1000
ARG USER_GID=$USER_UID

ARG SERVER_PORT=3000

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    ENVIRONMENT=production \
    SERVER_PORT=${SERVER_PORT}

WORKDIR /app

RUN groupadd --gid $USER_GID $USERNAME && \
    useradd --uid $USER_UID --gid $USER_GID -m $USERNAME

# Python env only
COPY --from=python-deps /app/.venv /app/.venv

# backend source
WORKDIR /app/packages/server
COPY packages/server ./

# frontend static only
COPY --from=frontend-builder /app/packages/server/static ./static

RUN mkdir -p downloads cookies_txt && \
    chown -R $USERNAME:$USERNAME /app

USER $USERNAME

RUN prisma generate

EXPOSE ${SERVER_PORT}

CMD ["sh", "-c", "prisma db push && exec python main.py"]

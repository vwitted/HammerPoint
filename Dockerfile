# syntax=docker/dockerfile:1

# ---- Build: compile the React client (dist/) and bundle the server (build/) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Chrome is only needed at runtime; don't download it in the build stage.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    SIDECAR_DOCKER=1
COPY package.json package-lock.json ./
COPY scripts/install-sidecar.mjs ./scripts/install-sidecar.mjs
RUN npm ci

COPY . .

# Vite inlines VITE_* variables into the browser bundle at build time, so the Maps key has to be
# passed as a build argument (it is public by design). Without it the app builds, minus the map.
# (Build args are visible to RUN as environment variables.)
ARG VITE_GOOGLE_MAPS_PLATFORM_KEY=""
RUN npm run build

# ---- Runtime: production dependencies, headless Chrome fallback, and the Python sidecar ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOME=/app \
    XDG_CACHE_HOME=/app/.cache \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    PUPPETEER_SKIP_DOWNLOAD=true \
    SIDECAR_AUTOSTART=1 \
    SIDECAR_PYTHON=/app/.venv/bin/python \
    SIDECAR_DOCKER=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY package.json package-lock.json ./
COPY scripts/install-sidecar.mjs ./scripts/install-sidecar.mjs
# Install production Node deps, then the exact Chrome build Puppeteer expects. The local CLI is
# used (not `npx`, which can resolve a different Puppeteer) so the browser version always matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip ca-certificates python3 python3-venv python3-pip \
 && npm ci --omit=dev \
 && ./node_modules/.bin/puppeteer browsers install chrome --install-deps \
 && npm cache clean --force \
 && mkdir -p /app/.cache \
 && chown -R node:node /app/.cache

# Python sidecar: Camoufox (patched Firefox) for JavaScript pages and curl_cffi for browser-grade
# TLS/HTTP2 on plain requests. Dependencies are pinned in sidecar/requirements.txt.
COPY sidecar/requirements.txt ./sidecar/requirements.txt
RUN python3 -m venv /app/.venv \
 && /app/.venv/bin/pip install --no-cache-dir --disable-pip-version-check -r sidecar/requirements.txt

COPY sidecar ./sidecar

# The Camoufox browser is ~1 GB. Keep this switchable so a low-disk environment can still build the
# image (the Node providers then fall back to Chrome), and so a failed browser download doesn't
# take the whole deployment down.
ARG INSTALL_CAMOUFOX=1
RUN if [ "$INSTALL_CAMOUFOX" = "1" ]; then \
      HOME=/app XDG_CACHE_HOME=/app/.cache /app/.venv/bin/python -m camoufox fetch && \
      HOME=/app XDG_CACHE_HOME=/app/.cache /app/.venv/bin/python -m playwright install-deps firefox; \
    fi \
 && chown -R node:node /app/.venv /app/.cache \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build

USER node
EXPOSE 3000
CMD ["node", "build/server.cjs"]

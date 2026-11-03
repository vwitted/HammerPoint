# syntax=docker/dockerfile:1

# ---- Build: compile the React client (dist/) and bundle the server (build/) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Chrome is only needed at runtime; don't download it in the build stage.
ENV PUPPETEER_SKIP_DOWNLOAD=false
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables into the browser bundle at build time, so the Maps key has to be
# passed as a build argument (it is public by design). Without it the app builds, minus the map.
# (Build args are visible to RUN as environment variables.)
ARG VITE_GOOGLE_MAPS_PLATFORM_KEY=""
RUN npm run build

# ---- Runtime: production dependencies + headless Chrome for the scrapers ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json ./
# npm ci downloads Puppeteer's pinned Chrome (unzip is needed to extract it) into
# PUPPETEER_CACHE_DIR; --install-deps then apt-installs the shared libraries Chrome needs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip fonts-liberation \
 && npm ci --omit=dev \
 && npx puppeteer browsers install chrome --install-deps \
 && apt-get purge -y unzip \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force \
 && chown -R node:node /app/.cache

COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build

USER node
EXPOSE 3000
CMD ["node", "build/server.cjs"]

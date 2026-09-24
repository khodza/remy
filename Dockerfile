# syntax=docker/dockerfile:1
# Remy backend (Telegram bot + Mini App API) as one container.
#
#   docker build -t remy .
#   docker run --env-file .env -p 3000:3000 remy
#   npm run docker:up            # the same through docker compose, with Mongo
#
# Three stages: production dependencies, a full build with SWC, and a small
# non-root runtime that runs exactly what `npm run start:prod:api` runs.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
# Install scripts have no place in an image build: husky (prepare) wants
# .git and mongodb-memory-server (postinstall) would download a database.
ENV HUSKY=0 MONGOMS_DISABLE_POSTINSTALL=1

# --- production dependencies only ---------------------------------------
FROM base AS deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# --- compile src/ -> build/ (nest build: type check + SWC) ---------------
FROM base AS build
# npm ci must install dev dependencies here (NODE_ENV=production would skip them).
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- runtime -------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/build ./build
COPY --chown=node:node package.json ./
# The node image ships an unprivileged `node` user (uid 1000).
USER node
EXPOSE 3000
# /api/v1/health answers 503 while MongoDB or Telegram is unreachable, so the
# container turns "unhealthy" instead of silently doing nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/main"]

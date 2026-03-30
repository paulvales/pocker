# External Integrations

**Analysis Date:** 2026-03-30

## APIs & External Services

**Issue Tracking API:**
- YouTrack REST API - Story points update from revealed room votes
  - SDK/Client: Native `fetch` in Node (no dedicated SDK) in `src/handlers/socket.js`
  - Auth: `YOUTRACK_TOKEN` bearer token with `YOUTRACK_BASE_URL` endpoint and `YOUTRACK_STORY_POINTS_FIELD` command field (`index.js`, `src/handlers/socket.js`, `.env.example`)
  - Boundary: Call is gated by room-admin membership and only executed via `set_story_points` socket event (`src/handlers/socket.js`, `room-registry.js`)

**Container/Ingress Platform:**
- Traefik (routing and TLS labels) for service exposure in production compose
  - SDK/Client: Docker labels in `docker-compose.yml`
  - Auth: Not in app code; handled by ingress/proxy layer

- Local Docker Registry (`registry:2`) for release images
  - SDK/Client: `docker-compose.registry.yml`, `scripts/release-local-registry.sh`
  - Auth: Not configured in repo; uses insecure/local host patterns from `.env.example`

## Data Storage

**Databases:**
- PostgreSQL (primary persisted history store)
  - Connection: `DATABASE_URL` (`estimation-history-store.js`, `.env.example`, `docker-compose.yml`)
  - Client: `pg` Pool (`estimation-history-store.js`)
  - Behavior: Auto-creates and migrates `estimation_history` table/indexes at startup (`estimation-history-store.js`)

**File Storage:**
- Local filesystem only for static assets/pages (`index.html`, `history.html`, `public/*`, served by `src/routes/http.js`)

**Caching:**
- Redis integration implemented but not wired into runtime entrypoint
  - Connection: `REDIS_URL` + optional `REDIS_KEY_PREFIX`, `REDIS_ROOM_TTL` (`src/stores/redis-room-store.js`)
  - Client: `ioredis`
  - Status: Adapter exists in `src/stores/room-registry-adapter.js`, but `index.js` currently uses in-memory `createRoomRegistry()` directly

## Authentication & Identity

**Auth Provider:**
- Custom room-scoped authorization, no external identity provider
  - Implementation: Membership and admin checks in room registry (`room-registry.js`), enforced per socket event (`src/handlers/socket.js`)
  - Boundary: Admin-only operations include `note_update`, `task_list_update`, `set_estimation_mode`, `task_select`, `set_story_points`, `reveal`, `reset`

## Realtime & Message Systems

**Realtime Transport:**
- Socket.IO pub/sub events between server and browser clients (`index.js`, `src/handlers/socket.js`)

**Event Model:**
- Incoming mutation events: `create_room`, `join`, `vote`, `set_reaction`, `task_list_update`, `task_select`, `set_estimation_mode`, `note_update`, `set_story_points`
- Outgoing broadcast events: `players_update`, `votes_update`, `reveal_update`, `reactions_update`, `task_state_update`, `estimation_mode_update`, `user_event` (`src/handlers/socket.js`)

## Monitoring & Observability

**Error Tracking:**
- None detected (no SaaS tracker SDK in `package.json` or server code)

**Logs:**
- Structured logging via `pino` with pretty output outside production (`src/utils/logger.js`)
- Module-level child loggers in socket/redis adapters (`src/handlers/socket.js`, `src/stores/room-registry-adapter.js`, `src/stores/redis-room-store.js`)

## CI/CD & Deployment

**Hosting:**
- Dockerized Node app, optionally behind Traefik (`Dockerfile`, `docker-compose.yml`)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml`)
  - Test job: `npm ci`, `npm test`, optional lint (`npm run lint --if-present`)
  - Build job: Docker build + `/health` check in container

**Release Flow:**
- Local-registry publish script builds tagged image and pushes `version` + `latest` (`scripts/release-local-registry.sh`)
- Server deploy script performs `git pull`, registry ensure, push, compose pull/up (`scripts/server-deploy.sh`)

## Environment Configuration

**Required env vars:**
- Core runtime: `PORT`, `NODE_ENV`, `APP_VERSION`, `APP_BUILD` (`index.js`, `src/routes/http.js`, `src/utils/logger.js`)
- Persistence: `DATABASE_URL` (`estimation-history-store.js`, `docker-compose.yml`, `.env.example`)
- External API: `YOUTRACK_BASE_URL`, `YOUTRACK_TOKEN`, `YOUTRACK_STORY_POINTS_FIELD` (`index.js`, `src/handlers/socket.js`, `.env.example`)
- Optional cache: `REDIS_URL`, `REDIS_KEY_PREFIX`, `REDIS_ROOM_TTL` (`src/stores/redis-room-store.js`)
- Deployment infra: `APP_IMAGE`, `APP_TAG`, `CONTAINER_NAME`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINTS`, `TRAEFIK_CERT_RESOLVER`, `APP_HOST`, `REGISTRY_BIND_ADDR`, `REGISTRY_PORT`, `REGISTRY_CONTAINER_NAME` (`docker-compose.yml`, `docker-compose.registry.yml`, `.env.example`, `scripts/release-local-registry.sh`)

**Secrets location:**
- Runtime secrets are expected in `.env` / deployment environment; template keys in `.env.example`
- `.env` file present in repo root and treated as environment configuration (content intentionally not quoted)

## Webhooks & Callbacks

**Incoming:**
- None detected for HTTP webhook endpoints; only app HTTP endpoints (`/health`, `/version`, `/api/estimation-history`) in `src/routes/http.js`

**Outgoing:**
- YouTrack command API call: `POST {YOUTRACK_BASE_URL}/api/commands` from `set_story_points` flow (`src/handlers/socket.js`)

---

*Integration audit: 2026-03-30*

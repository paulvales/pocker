# Technology Stack

**Analysis Date:** 2026-03-30

## Languages

**Primary:**
- JavaScript (Node.js, CommonJS) - Backend server and domain logic in `index.js`, `room-registry.js`, `estimation-history-store.js`, `src/**/*.js`
- Shell/Bash - Deployment and release automation in `scripts/release-local-registry.sh`, `scripts/server-deploy.sh`

**Secondary:**
- Batch (`.bat`) - Local Docker helper in `scripts/docker-local-rebuild.bat`
- YAML - CI and container orchestration in `.github/workflows/ci.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.registry.yml`

## Runtime

**Environment:**
- Node.js 18+ required for local use (`README.md`), with CI matrix validating Node 18.x and 20.x (`.github/workflows/ci.yml`)
- Container runtime uses `node:18-alpine` in `Dockerfile`

**Package Manager:**
- npm (scripts and lockfile from `package.json`, `package-lock.json`)
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- Socket.IO server (`socket.io`) for realtime room/voting events (`index.js`, `src/handlers/socket.js`)
- Node HTTP server (`http`) with custom route handler (`index.js`, `src/routes/http.js`)

**Testing:**
- Jest (`jest`) as test runner via `npm test` (`package.json`, `__tests__/*.test.js`)
- `pg-mem` for in-memory PostgreSQL behavior in tests (`__tests__/server.test.js`, `scripts/stress-vote.js`)

**Build/Dev:**
- Docker image build with multi-env args (`Dockerfile`, `.github/workflows/ci.yml`)
- Docker Compose for production-style and local dev flows (`docker-compose.yml`, `docker-compose.dev.yml`)
- Local stress tool for vote/reconnect behavior (`scripts/stress-vote.js`, `package.json` script `stress:votes`)

## Key Dependencies

**Critical:**
- `socket.io` - Core websocket transport and event API (`index.js`, `src/handlers/socket.js`)
- `pg` - Persistence adapter for estimation history (`estimation-history-store.js`)
- `dotenv` - Local env loading outside Jest (`index.js`)

**Infrastructure:**
- `pino` + `pino-pretty` - Structured logging with pretty transport in non-production (`src/utils/logger.js`)
- `ioredis` - Optional Redis room-state store implementation (`src/stores/redis-room-store.js`, `src/stores/room-registry-adapter.js`)
- `socket.io-client` - Integration tests and stress script clients (`__tests__/server.test.js`, `scripts/stress-vote.js`)

## Configuration

**Environment:**
- Local config loaded from `.env` via `dotenv` (`index.js`)
- Supported env template exists in `.env.example` (do not commit real values from `.env`)
- Runtime env usage in code paths: `APP_VERSION`, `APP_BUILD`, `PORT`, `DATABASE_URL`, `YOUTRACK_BASE_URL`, `YOUTRACK_TOKEN`, `YOUTRACK_STORY_POINTS_FIELD`, `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`, `REDIS_KEY_PREFIX`, `REDIS_ROOM_TTL` (`index.js`, `estimation-history-store.js`, `src/utils/logger.js`, `src/stores/redis-room-store.js`)

**Build:**
- Container build args: `APP_VERSION`, `APP_BUILD` (`Dockerfile`, `scripts/release-local-registry.sh`)
- Compose runtime wiring for production/dev and Traefik routing (`docker-compose.yml`, `docker-compose.dev.yml`)
- CI build/test in GitHub Actions (`.github/workflows/ci.yml`)

## Platform Requirements

**Development:**
- Node.js 18+ and npm (`README.md`, `package.json`)
- Docker/Compose for local containerized runs (`README.md`, `docker-compose.dev.yml`)

**Production:**
- Docker container running Node service (`Dockerfile`, `docker-compose.yml`)
- Optional Traefik reverse proxy/network (`docker-compose.yml` labels and external `web` network)
- PostgreSQL connection expected when history persistence is enabled (`DATABASE_URL` in `estimation-history-store.js`, `docker-compose.yml`)

---

*Stack analysis: 2026-03-30*

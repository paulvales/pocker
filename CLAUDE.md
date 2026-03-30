<!-- GSD:project-start source:PROJECT.md -->
## Project

**Pocker**

Pocker is a real-time Scrum Poker tool for distributed teams running estimation sessions by room link. It provides live voting, reveal/reset, per-room tasks and notes, reactions, and estimation history. The current system is production-oriented around a Node.js + Socket.IO backend with a lightweight web UI.

**Core Value:** A team can join a room link and complete a planning poker estimation cycle reliably in real time with minimal friction.

### Constraints

- **Tech stack**: Node.js + Socket.IO + current frontend stack - preserve existing runtime to minimize migration risk
- **Compatibility**: Existing room-link UX and client event contracts must keep working - avoids breaking active users
- **Operations**: Docker/Compose-first deployment flow remains supported - aligns with current release process
- **Data safety**: History persistence must remain backward-compatible - prevents loss of historical estimation records
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (Node.js, CommonJS) - Backend server and domain logic in `index.js`, `room-registry.js`, `estimation-history-store.js`, `src/**/*.js`
- Shell/Bash - Deployment and release automation in `scripts/release-local-registry.sh`, `scripts/server-deploy.sh`
- Batch (`.bat`) - Local Docker helper in `scripts/docker-local-rebuild.bat`
- YAML - CI and container orchestration in `.github/workflows/ci.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.registry.yml`
## Runtime
- Node.js 18+ required for local use (`README.md`), with CI matrix validating Node 18.x and 20.x (`.github/workflows/ci.yml`)
- Container runtime uses `node:18-alpine` in `Dockerfile`
- npm (scripts and lockfile from `package.json`, `package-lock.json`)
- Lockfile: present (`package-lock.json`)
## Frameworks
- Socket.IO server (`socket.io`) for realtime room/voting events (`index.js`, `src/handlers/socket.js`)
- Node HTTP server (`http`) with custom route handler (`index.js`, `src/routes/http.js`)
- Jest (`jest`) as test runner via `npm test` (`package.json`, `__tests__/*.test.js`)
- `pg-mem` for in-memory PostgreSQL behavior in tests (`__tests__/server.test.js`, `scripts/stress-vote.js`)
- Docker image build with multi-env args (`Dockerfile`, `.github/workflows/ci.yml`)
- Docker Compose for production-style and local dev flows (`docker-compose.yml`, `docker-compose.dev.yml`)
- Local stress tool for vote/reconnect behavior (`scripts/stress-vote.js`, `package.json` script `stress:votes`)
## Key Dependencies
- `socket.io` - Core websocket transport and event API (`index.js`, `src/handlers/socket.js`)
- `pg` - Persistence adapter for estimation history (`estimation-history-store.js`)
- `dotenv` - Local env loading outside Jest (`index.js`)
- `pino` + `pino-pretty` - Structured logging with pretty transport in non-production (`src/utils/logger.js`)
- `ioredis` - Optional Redis room-state store implementation (`src/stores/redis-room-store.js`, `src/stores/room-registry-adapter.js`)
- `socket.io-client` - Integration tests and stress script clients (`__tests__/server.test.js`, `scripts/stress-vote.js`)
## Configuration
- Local config loaded from `.env` via `dotenv` (`index.js`)
- Supported env template exists in `.env.example` (do not commit real values from `.env`)
- Runtime env usage in code paths: `APP_VERSION`, `APP_BUILD`, `PORT`, `DATABASE_URL`, `YOUTRACK_BASE_URL`, `YOUTRACK_TOKEN`, `YOUTRACK_STORY_POINTS_FIELD`, `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`, `REDIS_KEY_PREFIX`, `REDIS_ROOM_TTL` (`index.js`, `estimation-history-store.js`, `src/utils/logger.js`, `src/stores/redis-room-store.js`)
- Container build args: `APP_VERSION`, `APP_BUILD` (`Dockerfile`, `scripts/release-local-registry.sh`)
- Compose runtime wiring for production/dev and Traefik routing (`docker-compose.yml`, `docker-compose.dev.yml`)
- CI build/test in GitHub Actions (`.github/workflows/ci.yml`)
## Platform Requirements
- Node.js 18+ and npm (`README.md`, `package.json`)
- Docker/Compose for local containerized runs (`README.md`, `docker-compose.dev.yml`)
- Docker container running Node service (`Dockerfile`, `docker-compose.yml`)
- Optional Traefik reverse proxy/network (`docker-compose.yml` labels and external `web` network)
- PostgreSQL connection expected when history persistence is enabled (`DATABASE_URL` in `estimation-history-store.js`, `docker-compose.yml`)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Use lowercase kebab-case for root and module files: `room-registry.js`, `estimation-history-store.js`, `src/handlers/socket.js`, `src/routes/http.js`, `src/utils/logger.js`.
- Use `.test.js` suffix in `__tests__/` for Jest suites: `__tests__/server.test.js`, `__tests__/room-registry.test.js`, `__tests__/estimation-history-store.test.js`.
- Keep browser entry script as `public/js/app.js` (single bundled legacy script pattern).
- Use camelCase for functions and helpers: `normalizeTaskState`, `createSocketHandler`, `buildPoolConfig`, `emitWithAck`.
- Use `create*` factory naming for dependency-injected modules: `createHttpHandler` in `src/routes/http.js`, `createSocketHandler` in `src/handlers/socket.js`, `createEstimationHistoryStore` in `estimation-history-store.js`.
- Use `UPPER_SNAKE_CASE` for constants and env-derived config: `APP_VERSION_LABEL` in `index.js`, `ROOM_ID_MAX_LENGTH` in `room-registry.js`, `DEFAULT_DATABASE_URL` in `estimation-history-store.js`.
- Use descriptive camelCase locals for runtime state: `historyEntries`, `normalizedRoomId`, `currentOffset`.
- Not applicable for static typing in current source: no TypeScript config or `.ts/.tsx` code detected in repo-owned source.
- Encode runtime error/result contracts with string error codes (`FORBIDDEN`, `ROOM_NOT_FOUND`, `REACTION_INVALID`) in `room-registry.js` and `src/handlers/socket.js`.
## Code Style
- Formatting tool not detected (no repo-owned `.prettierrc*`, `prettier.config.*`, or formatter script in `package.json`).
- Preserve existing style manually:
- Lint config not detected (no repo-owned `.eslintrc*` or `eslint.config.*`).
- CI runs optional lint only if present (`npm run lint --if-present`) in `.github/workflows/ci.yml`.
## Import Organization
- None detected; use relative require paths only (examples in `index.js`, `src/handlers/socket.js`, `src/routes/http.js`).
## Error Handling
- Use explicit string-coded errors from domain functions (`throw new Error('FORBIDDEN')`) in `room-registry.js`.
- Wrap socket handlers in `try/catch` and return ack payloads `{ ok: false, error: 'CODE' }` in `src/handlers/socket.js`.
- Ignore intentionally non-critical event failures with comments (`// ignore unauthorized ...`) in `src/handlers/socket.js`.
- Guard startup failures with logged error and `process.exit(1)` in `index.js`.
## Logging
- Use shared logger from `src/utils/logger.js` and module child loggers (`createChildLogger`) for subsystem context.
- Log structured objects, not interpolated strings: `logger.debug({ socketId }, 'New socket connection')` in `index.js`, `log.error({ err }, 'Failed to persist estimation history')` in `src/handlers/socket.js`.
- Keep debug-heavy operational logging in socket lifecycle and storage boundaries.
## Comments
- Use short comments only for non-obvious operational decisions:
- Not used in current codebase; no JSDoc/TSDoc annotations detected.
## Function Design
- Keep domain helpers small/pure (`normalize*`, `mapRowToEntry`) in `room-registry.js` and `estimation-history-store.js`.
- Central orchestrators are allowed to be large (`registerSocketHandlers` in `src/handlers/socket.js`, UI controller in `public/js/app.js`).
- Prefer object parameters for complex APIs to preserve call-site readability and extensibility:
- Use explicit structured objects for state snapshots and operation results (`{ roomId, room, roomState }`, `{ items, pagination }`).
- For network events, always return ack envelopes with `ok` boolean in `src/handlers/socket.js`.
## Module Design
- Use CommonJS named exports via object literals:
- Not used. Modules are imported directly by relative path (`index.js` requires `./src/routes/http`, `./src/handlers/socket`, `./room-registry`).
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single process runtime started in `index.js` that serves HTTP and Socket.IO on one port.
- Room state is maintained in-memory via `room-registry.js` and exposed through event-driven socket handlers in `src/handlers/socket.js`.
- History persistence is separated behind a store interface in `estimation-history-store.js` with optional integration adapter code in `src/stores/`.
## Layers
- Purpose: Compose the app and wire dependencies.
- Location: `index.js`
- Contains: HTTP server creation, Socket.IO server creation, store and registry initialization, env-based integration settings.
- Depends on: `src/routes/http.js`, `src/handlers/socket.js`, `room-registry.js`, `estimation-history-store.js`, `src/utils/logger.js`.
- Used by: Process entrypoint (`npm start`) and integration tests in `__tests__/server.test.js`.
- Purpose: Serve static assets/pages and JSON endpoints.
- Location: `src/routes/http.js`
- Contains: Route switching for `/`, `/history/`, `/health`, `/version`, `/api/estimation-history`, plus static file serving under `/public/`.
- Depends on: `src/utils/helpers.js`, Node `fs`/`path`, `roomRegistry`, `estimationHistoryStore`.
- Used by: Node HTTP server created in `index.js`.
- Purpose: Handle real-time room lifecycle and voting actions.
- Location: `src/handlers/socket.js`
- Contains: Socket event handlers (`create_room`, `join`, `vote`, `reveal`, `reset`, `task_*`, `set_story_points`, `set_reaction`).
- Depends on: `room-registry.js` API, `src/utils/helpers.js` (history entry creation), `estimation-history-store.js`, `fetch` for YouTrack API.
- Used by: Socket.IO `connection` handling in `index.js`.
- Purpose: Enforce room rules, normalization, permissions, and voting state transitions.
- Location: `room-registry.js`
- Contains: room ID normalization/validation, membership checks, admin-only protections, vote/reaction state updates, reveal/reset behavior.
- Depends on: Internal module-only logic (no DB/network dependencies).
- Used by: `src/handlers/socket.js`, `src/routes/http.js`, and unit tests in `__tests__/room-registry.test.js`.
- Purpose: Persist and query estimation history.
- Location: `estimation-history-store.js`
- Contains: PostgreSQL pool setup, schema migration/cleanup, append/list/listMeta APIs, pagination/filtering.
- Depends on: `pg` (`Pool`) and `DATABASE_URL`.
- Used by: `index.js` (startup init), `src/handlers/socket.js` (`reveal` append), `src/routes/http.js` (`/api/estimation-history`).
- Purpose: Redis-backed room state sync wrapper and Redis key-value room storage.
- Location: `src/stores/room-registry-adapter.js`, `src/stores/redis-room-store.js`
- Contains: Registry method wrapping with async sync/delete logic and Redis room/player keys with TTL.
- Depends on: `ioredis`, `room-registry.js`.
- Used by: Not currently wired from `index.js`; kept as optional extension code.
- Purpose: Browser UI, socket client behavior, and interaction flows.
- Location: `index.html`, `history.html`, `public/js/app.js`, `public/css/app.css`
- Contains: Room creation/join UX, voting controls, reactions, history UI, socket event wiring.
- Depends on: Socket.IO client and Semantic UI assets under `public/vendor/`.
- Used by: HTTP routes in `src/routes/http.js`.
## Data Flow
- Authoritative volatile room state lives in the in-process map inside `room-registry.js`.
- Durable analytical history lives in PostgreSQL through `estimation-history-store.js`.
- Optional Redis room snapshotting exists in `src/stores/` but is not active in current composition.
## Key Abstractions
- Purpose: Central domain model for room-level state and permissions.
- Examples: `room-registry.js`, usage in `src/handlers/socket.js`.
- Pattern: Encapsulated state machine-like API with normalization + guard clauses.
- Purpose: Persistence port for history writes/reads.
- Examples: `estimation-history-store.js`, tests in `__tests__/estimation-history-store.test.js`.
- Pattern: Repository-style abstraction with init + CRUD-like operations and pagination metadata.
- Purpose: Build event handlers with injected dependencies.
- Examples: `src/handlers/socket.js` created from `index.js`.
- Pattern: Factory function returning `registerSocketHandlers` closure.
## Entry Points
- Location: `index.js`
- Triggers: `npm start`, Docker command from `Dockerfile`, and import in `__tests__/server.test.js`.
- Responsibilities: Dependency construction, HTTP/socket bootstrapping, startup initialization (`estimationHistoryStore.initialize()`).
- Location: `src/routes/http.js`
- Triggers: Incoming Node HTTP requests.
- Responsibilities: Serve pages/assets, health/version endpoints, history API responses, room URL normalization redirects.
- Location: `src/handlers/socket.js`
- Triggers: Socket.IO `connection` event.
- Responsibilities: Register room/vote/admin/integration events and emit room-scoped updates.
## Error Handling
- Event handlers wrap mutations in `try/catch` and return `{ ok: false, error: 'CODE' }` callbacks (for example in `src/handlers/socket.js`).
- Non-critical persistence failures during reveal are logged and do not crash socket flow (`src/handlers/socket.js`).
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

# Architecture

**Analysis Date:** 2026-03-30

## Pattern Overview

**Overall:** Stateful real-time Node.js service with layered modules (transport -> domain state -> persistence/integration).

**Key Characteristics:**
- Single process runtime started in `index.js` that serves HTTP and Socket.IO on one port.
- Room state is maintained in-memory via `room-registry.js` and exposed through event-driven socket handlers in `src/handlers/socket.js`.
- History persistence is separated behind a store interface in `estimation-history-store.js` with optional integration adapter code in `src/stores/`.

## Layers

**Runtime Composition Layer:**
- Purpose: Compose the app and wire dependencies.
- Location: `index.js`
- Contains: HTTP server creation, Socket.IO server creation, store and registry initialization, env-based integration settings.
- Depends on: `src/routes/http.js`, `src/handlers/socket.js`, `room-registry.js`, `estimation-history-store.js`, `src/utils/logger.js`.
- Used by: Process entrypoint (`npm start`) and integration tests in `__tests__/server.test.js`.

**HTTP Delivery Layer:**
- Purpose: Serve static assets/pages and JSON endpoints.
- Location: `src/routes/http.js`
- Contains: Route switching for `/`, `/history/`, `/health`, `/version`, `/api/estimation-history`, plus static file serving under `/public/`.
- Depends on: `src/utils/helpers.js`, Node `fs`/`path`, `roomRegistry`, `estimationHistoryStore`.
- Used by: Node HTTP server created in `index.js`.

**Socket Transport Layer:**
- Purpose: Handle real-time room lifecycle and voting actions.
- Location: `src/handlers/socket.js`
- Contains: Socket event handlers (`create_room`, `join`, `vote`, `reveal`, `reset`, `task_*`, `set_story_points`, `set_reaction`).
- Depends on: `room-registry.js` API, `src/utils/helpers.js` (history entry creation), `estimation-history-store.js`, `fetch` for YouTrack API.
- Used by: Socket.IO `connection` handling in `index.js`.

**Domain State Layer:**
- Purpose: Enforce room rules, normalization, permissions, and voting state transitions.
- Location: `room-registry.js`
- Contains: room ID normalization/validation, membership checks, admin-only protections, vote/reaction state updates, reveal/reset behavior.
- Depends on: Internal module-only logic (no DB/network dependencies).
- Used by: `src/handlers/socket.js`, `src/routes/http.js`, and unit tests in `__tests__/room-registry.test.js`.

**Persistence Layer (History):**
- Purpose: Persist and query estimation history.
- Location: `estimation-history-store.js`
- Contains: PostgreSQL pool setup, schema migration/cleanup, append/list/listMeta APIs, pagination/filtering.
- Depends on: `pg` (`Pool`) and `DATABASE_URL`.
- Used by: `index.js` (startup init), `src/handlers/socket.js` (`reveal` append), `src/routes/http.js` (`/api/estimation-history`).

**Optional Cache/Replication Layer:**
- Purpose: Redis-backed room state sync wrapper and Redis key-value room storage.
- Location: `src/stores/room-registry-adapter.js`, `src/stores/redis-room-store.js`
- Contains: Registry method wrapping with async sync/delete logic and Redis room/player keys with TTL.
- Depends on: `ioredis`, `room-registry.js`.
- Used by: Not currently wired from `index.js`; kept as optional extension code.

**Client Presentation Layer:**
- Purpose: Browser UI, socket client behavior, and interaction flows.
- Location: `index.html`, `history.html`, `public/js/app.js`, `public/css/app.css`
- Contains: Room creation/join UX, voting controls, reactions, history UI, socket event wiring.
- Depends on: Socket.IO client and Semantic UI assets under `public/vendor/`.
- Used by: HTTP routes in `src/routes/http.js`.

## Data Flow

**Live Planning Session Flow:**

1. A browser loads `index.html` via `src/routes/http.js` and establishes a socket connection handled by `src/handlers/socket.js`.
2. Room and participant actions (`create_room`, `join`, `vote`, `task_list_update`, `set_estimation_mode`) mutate in-memory state through `room-registry.js`.
3. Handler broadcasts derived state updates (`players_update`, `votes_update`, `task_state_update`, `estimation_mode_update`, `reveal_update`) back to all sockets in the room.

**Reveal and History Persistence Flow:**

1. Admin triggers `reveal` event in `src/handlers/socket.js`.
2. Handler builds immutable history entries via `buildHistoryEntries` in `src/utils/helpers.js` from current `room-registry.js` state.
3. Entries are persisted through `estimation-history-store.js` and later exposed by HTTP endpoint `/api/estimation-history` in `src/routes/http.js`.

**State Management:**
- Authoritative volatile room state lives in the in-process map inside `room-registry.js`.
- Durable analytical history lives in PostgreSQL through `estimation-history-store.js`.
- Optional Redis room snapshotting exists in `src/stores/` but is not active in current composition.

## Key Abstractions

**Room Registry:**
- Purpose: Central domain model for room-level state and permissions.
- Examples: `room-registry.js`, usage in `src/handlers/socket.js`.
- Pattern: Encapsulated state machine-like API with normalization + guard clauses.

**Estimation History Store:**
- Purpose: Persistence port for history writes/reads.
- Examples: `estimation-history-store.js`, tests in `__tests__/estimation-history-store.test.js`.
- Pattern: Repository-style abstraction with init + CRUD-like operations and pagination metadata.

**Socket Handler Factory:**
- Purpose: Build event handlers with injected dependencies.
- Examples: `src/handlers/socket.js` created from `index.js`.
- Pattern: Factory function returning `registerSocketHandlers` closure.

## Entry Points

**Server Entrypoint:**
- Location: `index.js`
- Triggers: `npm start`, Docker command from `Dockerfile`, and import in `__tests__/server.test.js`.
- Responsibilities: Dependency construction, HTTP/socket bootstrapping, startup initialization (`estimationHistoryStore.initialize()`).

**HTTP Request Entrypoint:**
- Location: `src/routes/http.js`
- Triggers: Incoming Node HTTP requests.
- Responsibilities: Serve pages/assets, health/version endpoints, history API responses, room URL normalization redirects.

**Socket Connection Entrypoint:**
- Location: `src/handlers/socket.js`
- Triggers: Socket.IO `connection` event.
- Responsibilities: Register room/vote/admin/integration events and emit room-scoped updates.

## Error Handling

**Strategy:** Guarded operations with explicit error codes for client acks; fail-fast startup for critical persistence init.

**Patterns:**
- Event handlers wrap mutations in `try/catch` and return `{ ok: false, error: 'CODE' }` callbacks (for example in `src/handlers/socket.js`).
- Non-critical persistence failures during reveal are logged and do not crash socket flow (`src/handlers/socket.js`).

## Cross-Cutting Concerns

**Logging:** Structured logging via pino from `src/utils/logger.js`; child loggers used in modules.
**Validation:** Domain-level normalization/validation in `room-registry.js` and filter parsing in `src/utils/helpers.js`.
**Authentication:** No user identity provider; authorization is room membership plus single-admin checks in `room-registry.js`.

---

*Architecture analysis: 2026-03-30*

# Codebase Structure

**Analysis Date:** 2026-03-30

## Directory Layout

```
[pocker]/
├── index.js                     # Runtime entrypoint; wires HTTP + Socket.IO + stores
├── room-registry.js             # In-memory domain state and room rules
├── estimation-history-store.js  # PostgreSQL-backed history repository
├── src/                         # Transport/persistence helpers for backend runtime
├── public/                      # Static JS/CSS/vendor assets served by backend
├── __tests__/                   # Jest unit/integration tests
├── scripts/                     # Local ops scripts (deploy, stress, docker helpers)
├── .github/workflows/           # CI workflow definitions
├── Dockerfile                   # Container build definition
├── docker-compose*.yml          # Runtime composition for dev/prod/registry setups
└── apps/web/dist/               # Built frontend bundle artifact (not backend runtime source)
```

## Directory Purposes

**`src/handlers/`:**
- Purpose: Real-time transport handlers.
- Contains: Socket event handler factories.
- Key files: `src/handlers/socket.js`.

**`src/routes/`:**
- Purpose: HTTP request routing.
- Contains: Route dispatch and static file serving logic.
- Key files: `src/routes/http.js`.

**`src/utils/`:**
- Purpose: Shared server-side utilities.
- Contains: JSON/html response helpers, history filter builders, logger factory.
- Key files: `src/utils/helpers.js`, `src/utils/logger.js`.

**`src/stores/`:**
- Purpose: Optional storage adapters around room state.
- Contains: Redis room store + registry sync adapter.
- Key files: `src/stores/redis-room-store.js`, `src/stores/room-registry-adapter.js`.

**`public/`:**
- Purpose: Browser-delivered static assets.
- Contains: Main UI script/styles and vendored libraries.
- Key files: `public/js/app.js`, `public/css/app.css`, `public/vendor/socket.io.min.js`.

**`__tests__/`:**
- Purpose: Regression coverage for domain logic and full server behavior.
- Contains: Jest tests including socket integration tests.
- Key files: `__tests__/server.test.js`, `__tests__/room-registry.test.js`, `__tests__/estimation-history-store.test.js`.

**`scripts/`:**
- Purpose: Operational automation and local load testing.
- Contains: deploy/release scripts and stress tooling.
- Key files: `scripts/server-deploy.sh`, `scripts/release-local-registry.sh`, `scripts/stress-vote.js`.

## Key File Locations

**Entry Points:**
- `index.js`: Main Node application entrypoint.
- `index.html`: Main planning UI page served from root route.
- `history.html`: History viewer UI page served from `/history/`.

**Configuration:**
- `package.json`: Node package manifest and npm scripts.
- `.github/workflows/ci.yml`: CI test/build pipeline.
- `Dockerfile`: Image build/start configuration.
- `docker-compose.yml`: Production-oriented compose stack.
- `docker-compose.dev.yml`: Local dev compose stack.

**Core Logic:**
- `room-registry.js`: Room domain model and permission checks.
- `estimation-history-store.js`: History schema/init and data access.
- `src/handlers/socket.js`: Socket event orchestration.
- `src/routes/http.js`: HTTP endpoints and static page handling.

**Testing:**
- `__tests__/server.test.js`: End-to-end server behavior over HTTP/socket.
- `__tests__/room-registry.test.js`: Domain normalization and state transition tests.
- `__tests__/estimation-history-store.test.js`: Store utility/unit tests.

## Naming Conventions

**Files:**
- Server/domain modules use lower-kebab names for compound files: `estimation-history-store.js`, `room-registry.js`.
- Test files use `.test.js` suffix under `__tests__/`.

**Directories:**
- Runtime backend folders are layer-oriented under `src/` (`handlers`, `routes`, `stores`, `utils`).
- Static client assets are grouped by asset type under `public/` (`js`, `css`, `vendor`).

## Where to Add New Code

**New Feature:**
- Primary backend flow code: `src/handlers/` for new socket actions, `src/routes/` for HTTP endpoints.
- Domain/state rules: `room-registry.js` (or split new domain module at repo root only if strongly bounded).
- Tests: mirror behavior in `__tests__/server.test.js` for integration and add focused unit tests in `__tests__/`.

**New Component/Module:**
- Persistence adapters: `src/stores/`.
- Shared server helpers: `src/utils/`.
- Frontend behavior/UI updates: `public/js/app.js` and `public/css/app.css`.

**Utilities:**
- Shared helpers for HTTP/socket payload shaping: `src/utils/helpers.js`.
- Logging context helpers: `src/utils/logger.js`.

## Special Directories

**`.planning/codebase/`:**
- Purpose: Generated mapping docs consumed by GSD planning/execution commands.
- Generated: Yes.
- Committed: Yes.

**`apps/web/dist/`:**
- Purpose: Built frontend artifact bundle.
- Generated: Yes.
- Committed: Yes (artifact present in repository).

**`.env` / `.env.example`:**
- Purpose: Environment configuration files for runtime integration settings.
- Generated: `.env` is local runtime config; `.env.example` is template.
- Committed: `.env.example` yes; `.env` may exist locally.

---

*Structure analysis: 2026-03-30*

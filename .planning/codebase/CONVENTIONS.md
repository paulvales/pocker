# Coding Conventions

**Analysis Date:** 2026-03-30

## Naming Patterns

**Files:**
- Use lowercase kebab-case for root and module files: `room-registry.js`, `estimation-history-store.js`, `src/handlers/socket.js`, `src/routes/http.js`, `src/utils/logger.js`.
- Use `.test.js` suffix in `__tests__/` for Jest suites: `__tests__/server.test.js`, `__tests__/room-registry.test.js`, `__tests__/estimation-history-store.test.js`.
- Keep browser entry script as `public/js/app.js` (single bundled legacy script pattern).

**Functions:**
- Use camelCase for functions and helpers: `normalizeTaskState`, `createSocketHandler`, `buildPoolConfig`, `emitWithAck`.
- Use `create*` factory naming for dependency-injected modules: `createHttpHandler` in `src/routes/http.js`, `createSocketHandler` in `src/handlers/socket.js`, `createEstimationHistoryStore` in `estimation-history-store.js`.

**Variables:**
- Use `UPPER_SNAKE_CASE` for constants and env-derived config: `APP_VERSION_LABEL` in `index.js`, `ROOM_ID_MAX_LENGTH` in `room-registry.js`, `DEFAULT_DATABASE_URL` in `estimation-history-store.js`.
- Use descriptive camelCase locals for runtime state: `historyEntries`, `normalizedRoomId`, `currentOffset`.

**Types:**
- Not applicable for static typing in current source: no TypeScript config or `.ts/.tsx` code detected in repo-owned source.
- Encode runtime error/result contracts with string error codes (`FORBIDDEN`, `ROOM_NOT_FOUND`, `REACTION_INVALID`) in `room-registry.js` and `src/handlers/socket.js`.

## Code Style

**Formatting:**
- Formatting tool not detected (no repo-owned `.prettierrc*`, `prettier.config.*`, or formatter script in `package.json`).
- Preserve existing style manually:
  - Server modules use 4-space indentation in `index.js`, `src/handlers/socket.js`, `room-registry.js`.
  - Some tests use 2-space indentation in `__tests__/server.test.js`.
  - Semicolons are consistently used across runtime and tests.

**Linting:**
- Lint config not detected (no repo-owned `.eslintrc*` or `eslint.config.*`).
- CI runs optional lint only if present (`npm run lint --if-present`) in `.github/workflows/ci.yml`.

## Import Organization

**Order:**
1. Node/core and third-party requires first (`http`, `socket.io`, `pg`, `pino`) as in `index.js` and `estimation-history-store.js`.
2. Local project modules second (`./room-registry`, `./src/routes/http`, `../utils/helpers`).
3. Module exports at bottom using `module.exports = { ... }`.

**Path Aliases:**
- None detected; use relative require paths only (examples in `index.js`, `src/handlers/socket.js`, `src/routes/http.js`).

## Error Handling

**Patterns:**
- Use explicit string-coded errors from domain functions (`throw new Error('FORBIDDEN')`) in `room-registry.js`.
- Wrap socket handlers in `try/catch` and return ack payloads `{ ok: false, error: 'CODE' }` in `src/handlers/socket.js`.
- Ignore intentionally non-critical event failures with comments (`// ignore unauthorized ...`) in `src/handlers/socket.js`.
- Guard startup failures with logged error and `process.exit(1)` in `index.js`.

## Logging

**Framework:** `pino` with optional `pino-pretty` transport in `src/utils/logger.js`.

**Patterns:**
- Use shared logger from `src/utils/logger.js` and module child loggers (`createChildLogger`) for subsystem context.
- Log structured objects, not interpolated strings: `logger.debug({ socketId }, 'New socket connection')` in `index.js`, `log.error({ err }, 'Failed to persist estimation history')` in `src/handlers/socket.js`.
- Keep debug-heavy operational logging in socket lifecycle and storage boundaries.

## Comments

**When to Comment:**
- Use short comments only for non-obvious operational decisions:
  - TLS fallback rationale in `estimation-history-store.js`.
  - Ignore-path comments for expected failures in `src/handlers/socket.js`.
  - TTL default rationale in `src/stores/redis-room-store.js`.

**JSDoc/TSDoc:**
- Not used in current codebase; no JSDoc/TSDoc annotations detected.

## Function Design

**Size:**
- Keep domain helpers small/pure (`normalize*`, `mapRowToEntry`) in `room-registry.js` and `estimation-history-store.js`.
- Central orchestrators are allowed to be large (`registerSocketHandlers` in `src/handlers/socket.js`, UI controller in `public/js/app.js`).

**Parameters:**
- Prefer object parameters for complex APIs to preserve call-site readability and extensibility:
  - `createSocketHandler({ io, roomRegistry, ... })` in `src/handlers/socket.js`.
  - `createEstimationHistoryStore({ PoolClass, connectionString, ... })` in `estimation-history-store.js`.

**Return Values:**
- Use explicit structured objects for state snapshots and operation results (`{ roomId, room, roomState }`, `{ items, pagination }`).
- For network events, always return ack envelopes with `ok` boolean in `src/handlers/socket.js`.

## Module Design

**Exports:**
- Use CommonJS named exports via object literals:
  - `module.exports = { createSocketHandler }` in `src/handlers/socket.js`.
  - `module.exports = { createEstimationHistoryStore, ... }` in `estimation-history-store.js`.

**Barrel Files:**
- Not used. Modules are imported directly by relative path (`index.js` requires `./src/routes/http`, `./src/handlers/socket`, `./room-registry`).

---

*Convention analysis: 2026-03-30*

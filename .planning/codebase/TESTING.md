# Testing Patterns

**Analysis Date:** 2026-03-30

## Test Framework

**Runner:**
- Jest `^29.7.0` from `package.json`.
- Config: no dedicated `jest.config.*`; Jest defaults are used through `npm test` script in `package.json`.

**Assertion Library:**
- Jest built-in `expect`/matchers in `__tests__/server.test.js`, `__tests__/room-registry.test.js`, and `__tests__/estimation-history-store.test.js`.

**Run Commands:**
```bash
npm test                       # Run all tests (script in package.json)
npm test -- --runInBand        # Serial execution for deterministic integration runs
npx jest __tests__/server.test.js  # Run socket/http integration suite only
```

## Test File Organization

**Location:**
- Centralized test folder pattern: `__tests__/` at project root.

**Naming:**
- `*.test.js` naming: `__tests__/server.test.js`, `__tests__/room-registry.test.js`, `__tests__/estimation-history-store.test.js`.

**Structure:**
```
__tests__/
  estimation-history-store.test.js
  room-registry.test.js
  server.test.js
```

## Test Structure

**Suite Organization:**
```javascript
describe('socket server', () => {
  beforeAll(async () => { ... });
  afterAll(async () => { ... });

  test('exposes health and version info over http and serves room paths', async () => { ... });
});
```
Pattern source: `__tests__/server.test.js`.

**Patterns:**
- Setup pattern: initialize shared resources in `beforeAll` (`server.listen`, `estimationHistoryStore.initialize`) in `__tests__/server.test.js`.
- Teardown pattern: close sockets/HTTP server/store in `afterAll` and `finally` blocks in `__tests__/server.test.js`.
- Assertion pattern: combine exact payload checks and partial structural matching (`toEqual`, `expect.objectContaining`, `expect.arrayContaining`).

## Mocking

**Framework:**
- In-memory infrastructure substitution using `pg-mem` instead of networked PostgreSQL in `__tests__/server.test.js`.

**Patterns:**
```javascript
const historyDb = newDb();
const { Pool } = historyDb.adapters.createPg();

global.__POCKER_HISTORY_STORE_OPTIONS__ = {
  PoolClass: Pool,
  connectionString: 'postgres://test:test@127.0.0.1:5432/pocker_test?sslmode=disable',
  skipLegacyDeduplication: true,
};
const { estimationHistoryStore, io, server } = require('..');
delete global.__POCKER_HISTORY_STORE_OPTIONS__;
```
Pattern source: `__tests__/server.test.js`.

**What to Mock:**
- Database layer via injected pool (`PoolClass`) for deterministic tests in `estimation-history-store.js` and `__tests__/server.test.js`.

**What NOT to Mock:**
- Socket.IO server/client interaction is exercised end-to-end with real events (`socket.io-client`) in `__tests__/server.test.js`.
- HTTP route behavior (`/health`, `/version`, `/api/estimation-history`) is tested via real loopback requests in `__tests__/server.test.js`.

## Fixtures and Factories

**Test Data:**
```javascript
function emitWithAck(client, eventName, payload) {
  return new Promise(resolve => {
    client.emit(eventName, payload, resolve);
  });
}

function joinRoom(client, payload) {
  return emitWithAck(client, 'join', payload);
}
```
Pattern source: `__tests__/server.test.js`.

**Location:**
- Test helpers are defined inline per test file, not in shared fixture modules.

## Coverage

**Requirements:**
- No enforced coverage threshold or coverage config detected (no `collectCoverageFrom` config and no coverage script in `package.json`).
- Current observed run result: 3 suites, 95 tests passing via `npm test -- --runInBand`.

**View Coverage:**
```bash
npx jest --coverage
```
(Command available through Jest CLI; not defined as npm script.)

## Test Types

**Unit Tests:**
- Pure normalization and mapping behavior in `__tests__/room-registry.test.js` and `__tests__/estimation-history-store.test.js`.
- Focus on edge cases, coercion, and error-code semantics.

**Integration Tests:**
- Full socket + HTTP integration in `__tests__/server.test.js` with real `socket.io-client` and in-memory DB.
- Includes reconnection/vote lifecycle, room state sync, history persistence, reaction TTL, and admin authorization checks.

**E2E Tests:**
- Browser/UI E2E framework not detected in repo-owned files (no Playwright/Cypress config).
- `scripts/stress-vote.js` is a stress/integration script, not a CI-managed E2E suite.

## Common Patterns

**Async Testing:**
```javascript
const voteUpdatePromise = waitForEvent(
  adminClient,
  'votes_update',
  players => players.some(player => player.name === 'Viewer' && player.vote === '5'),
);

await expect(emitWithAck(viewerClient, 'vote', { roomId, value: '5' }))
  .resolves.toEqual(expect.objectContaining({ ok: true, value: '5' }));
await expect(voteUpdatePromise).resolves.toEqual(expect.arrayContaining([
  expect.objectContaining({ name: 'Viewer', vote: '5' }),
]));
```
Pattern source: `__tests__/server.test.js`.

**Error Testing:**
```javascript
await expect(emitWithAck(viewerClient, 'task_list_update', {
  roomId,
  items: ['https://tracker.example/ABC-999'],
})).resolves.toEqual({
  ok: false,
  error: 'FORBIDDEN',
});
```
Pattern source: `__tests__/server.test.js`.

## Current Coverage Scope

- Covered:
  - Room slug normalization, membership, voting, reactions, and reveal/reset transitions in `room-registry.js` through `__tests__/room-registry.test.js`.
  - Estimation history normalization, connection parsing, pagination behavior, and DB mapping in `estimation-history-store.js` through `__tests__/estimation-history-store.test.js`.
  - HTTP endpoints and socket event flows (including reconnect paths) in `index.js`, `src/handlers/socket.js`, and `src/routes/http.js` through `__tests__/server.test.js`.

- Known gaps:
  - No direct tests for browser UI script logic in `public/js/app.js` (join UX, localStorage behavior, DOM rendering).
  - No tests for Redis adapter integration in `src/stores/redis-room-store.js` and `src/stores/room-registry-adapter.js`.
  - No CI-enforced coverage gate in `.github/workflows/ci.yml` and no dedicated coverage npm script in `package.json`.

---

*Testing analysis: 2026-03-30*

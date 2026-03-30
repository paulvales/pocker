# Architecture Evolution: Single-Process Authority -> Resilient Multi-Instance

**Project:** Pocker  
**Research type:** ARCHITECTURE  
**Researched:** 2026-03-30

## Current Baseline (What Must Be Preserved)

Current behavior in this repository is a single Node.js process where `room-registry.js` is authoritative for volatile room/session state and Socket.IO handlers in `src/handlers/socket.js` mutate/broadcast directly.

Behavioral invariants to preserve during migration:
- Existing Socket.IO event names and callback contracts (`create_room`, `join`, `vote`, `reveal`, `reset`, `task_*`, `set_story_points`, `set_reaction`).
- Room-link UX and URL semantics (dynamic room suffix).
- Admin-only actions and current authorization outcomes (even if internals are hardened).
- Reveal/history semantics: reveal triggers history append and broadcast flow.
- Current reconnect expectation: clients can rejoin and continue room flow.

## Recommended Target Architecture

Use **stateless realtime gateways + shared room runtime state in Redis + durable history/events in PostgreSQL**.

This keeps Socket.IO and current client contracts while removing single-process authority.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| Edge/LB (Traefik or equivalent) | TLS, routing, sticky sessions for Engine.IO transport | Realtime Gateway instances |
| Realtime Gateway (`index.js` + split handler modules) | Socket connection lifecycle, input validation, event contract, room fanout | Redis adapter, Room Runtime Service, History Store, YouTrack client |
| Room Runtime Service (new module boundary) | Authoritative command handling for room state transitions (create/join/vote/reveal/reset/task/reaction), optimistic concurrency/idempotency | Redis Room State Store, Postgres Room Event Log, Gateway |
| Redis Room State Store | Fast shared snapshot for active rooms, membership indices, TTL/GC metadata | Room Runtime Service, Gateway readers |
| Socket.IO Adapter Bus | Cross-instance event propagation (`io.to(room).emit(...)`) | Realtime Gateway instances via Redis adapter |
| PostgreSQL History Store (existing `estimation-history-store.js`) | Durable estimation history API and reveal append | Room Runtime Service / Gateway, HTTP API |
| PostgreSQL Room Event Log (new) | Durable command/event trail for recovery, replay, debugging, multi-instance convergence | Room Runtime Service |
| External Integration Worker (YouTrack) | Outbound story point sync with timeout/retry/circuit policy | Room Runtime Service, YouTrack API |
| HTTP API (`src/routes/http.js`) | Health/readiness, version, history API, static app delivery | History Store, Runtime health probes |

## Data Flow (Target)

### 1. Command Path (write)
1. Client sends socket command (e.g., `vote`).
2. Gateway validates shape/membership token and forwards to Room Runtime Service.
3. Runtime acquires room-scoped lease (short lock) and applies deterministic transition.
4. Runtime writes durable room event (Postgres event log), then updates Redis snapshot atomically.
5. Gateway broadcasts resulting state update through Socket.IO (Redis adapter fans out to all instances).
6. Gateway returns ack using existing callback payload shape.

### 2. Query/Snapshot Path (read)
1. Join/reconnect asks for room snapshot.
2. Gateway reads Redis room snapshot (fast path).
3. If missing and room exists in event log, runtime rehydrates snapshot and repopulates Redis.
4. Gateway emits current state using existing event payload structure.

### 3. Reveal + History Path
1. Admin sends `reveal`.
2. Runtime transitions room to revealed, persists room event.
3. Runtime derives reveal history entries and appends to existing history store.
4. Gateway emits `reveal_update` and `votes_update` without contract changes.

## Migration Path (No-Break Evolution)

### Stage A: Refactor for seams, zero behavior change
- Split `src/handlers/socket.js` into domain-focused modules behind one registration facade.
- Introduce `RoomRuntime` interface used by handlers (backed initially by existing in-memory registry).
- Keep current tests passing as contract baseline.

### Stage B: Activate horizontal transport only
- Enable Socket.IO Redis adapter in `index.js`.
- Keep room authority still local in memory (temporary), but validate cross-instance emits and sticky session config.
- Add readiness checks for Redis connectivity.

### Stage C: Move room authority to shared state
- Implement Redis-backed room snapshot store with **atomic update semantics** (WATCH/MULTI or Lua script).
- Implement room-scoped versioning (`roomVersion`) and idempotency key for command retries.
- Switch `RoomRuntime` implementation from in-memory map to shared Redis-backed runtime.

### Stage D: Add durable room event log and recovery
- Create Postgres `room_events` table (append-only) and write on every accepted command.
- Add rehydrate-on-miss path to rebuild Redis state after restart/eviction.
- Preserve current UX by keeping same outgoing events and ack structure.

### Stage E: Harden operations and security boundaries
- Replace client-asserted admin with server-issued signed session/admin claims.
- Enforce CORS origin allowlist + rate limits.
- Add integration timeout/circuit for YouTrack, plus structured metrics.
- Upgrade `/health` and add `/ready` with DB/Redis dependency checks.

## Build Order (Recommended)

1. **Contract lock-in:** Add/expand socket contract tests for all current events and failure cases.
2. **Handler modularization:** Decompose `socket.js` into bounded modules while preserving behavior.
3. **Runtime abstraction:** Introduce `RoomRuntime` port and in-memory adapter (drop-in).
4. **Redis adapter activation:** Wire official Socket.IO Redis adapter; deploy with sticky sessions.
5. **Shared state runtime:** Implement Redis room store + optimistic concurrency + idempotency.
6. **Durable event log:** Add Postgres room event persistence and replay/rehydration path.
7. **Auth hardening:** Server-issued room/admin claims and anti-forgery checks.
8. **Operational hardening:** Readiness probes, metrics, rate limits, timeout/circuit for external calls.
9. **Scale validation:** Multi-instance chaos tests (restart, partial Redis outage, reconnect storms).

## Design Rules To Prevent Regression

- Keep all client-visible socket event names/payloads backward compatible until explicit versioning.
- Runtime transitions must be deterministic and side-effect ordered: validate -> persist event -> update snapshot -> broadcast.
- Never depend on `redis.keys()` for production room listing; use indexed sets/SCAN-based iteration.
- Treat history persistence and room-state durability as separate concerns (history is analytical, room snapshot is operational).
- Keep a single source of truth for authorization (server-issued claims), not UI flags.

## Sources

### High confidence (official/current)
- Socket.IO Redis adapter docs: https://socket.io/docs/v4/redis-adapter/
- Socket.IO connection state recovery docs: https://socket.io/docs/v4/connection-state-recovery/
- Socket.IO horizontal scaling tutorial: https://socket.io/docs/v4/tutorial/step-9
- Socket.IO Postgres adapter docs (release/status reference): https://socket.io/docs/v4/postgres-adapter/
- Redis KEYS command warning: https://redis.io/docs/latest/commands/keys/

### Codebase evidence (high confidence for current state)
- `index.js` (single process + open CORS + handler wiring)
- `room-registry.js` (in-memory authority + admin checks)
- `src/handlers/socket.js` (event contract + mixed concerns)
- `src/stores/room-registry-adapter.js` and `src/stores/redis-room-store.js` (inactive/broken Redis path)
- `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/CONCERNS.md`

## Confidence

- **Architecture direction:** HIGH
- **Migration feasibility:** HIGH
- **Operational risk if stages are skipped:** HIGH
- **Exact lock implementation choice (WATCH/MULTI vs Lua):** MEDIUM (team preference + benchmark dependent)

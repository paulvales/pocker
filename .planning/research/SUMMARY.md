# Project Research Summary

**Project:** pocker
**Domain:** Realtime planning-poker collaboration app
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

Pocker is a realtime planning-poker product where reliability and trust in ceremony flow matter more than framework novelty. The research converges on a clear direction: keep the current Node + Socket.IO + PostgreSQL architecture, but harden it for production by upgrading runtime baseline, fixing authorization boundaries, and activating shared state for multi-instance correctness.

The recommended approach is an evolutionary migration, not a rewrite. Move to Node 24 LTS, modularize realtime handlers behind a RoomRuntime boundary, wire Redis-backed shared room state, and keep durable history in PostgreSQL. Preserve existing socket contracts and UX while adding deterministic state transitions, idempotency, and readiness/security controls.

The highest risks are client-asserted admin trust, split-brain state in multi-node deployments, reconnect drift, and insecure/open realtime surfaces. Mitigation is straightforward but must be phased: server-issued signed role claims, sticky-session and adapter correctness, authoritative rejoin/state sync, strict origin/rate controls, and contract-first regression tests.

## Key Findings

### Recommended Stack

The stack is already directionally correct; the gap is operational maturity, not technology mismatch. Keep Socket.IO and PostgreSQL, add Redis as an actively wired runtime state path, and upgrade runtime/ops contracts before feature expansion.

**Core technologies:**
- Node.js 24 LTS: runtime baseline, security/perf support window, and current ecosystem default.
- Socket.IO 4.x: realtime transport and event contract continuity with current clients.
- Redis: shared room snapshot/coordination layer for multi-instance consistency.
- PostgreSQL: durable history and append-only event durability for recovery/audit.
- Docker Compose + CI matrix (22.x/24.x): reproducible deployment and safer runtime transition.
- Jest + contract tests: preserve behavior while refactoring/migrating internals.

### Expected Features

Table stakes emphasize ceremony trust and room usability first, with integrations as the first visible differentiator once core reliability is solved.

**Must have (table stakes):**
- Real-time rooms with join/rejoin stability and synchronized hidden-vote reveal/reset.
- Story/task sequencing within sessions, with deterministic round lifecycle.
- Role-aware facilitation with server-verifiable authority (not client flags).
- Common estimation decks plus basic custom deck support.
- Session history for final estimates/notes and ceremony traceability.
- Basic operational reliability: health/readiness and predictable reconnect semantics.

**Should have (competitive):**
- Two-way backlog sync (Jira first) with estimate write-back.
- Lightweight consensus analytics from history data.
- Export/summary support for post-session follow-through.

**Defer (v2+):**
- Async estimation mode until shared-state/reconnect correctness is proven.
- Advanced multidimensional estimation workflows.
- Native mobile apps, SSO/SAML/SCIM, and in-app chat/video.

### Architecture Approach

Adopt stateless realtime gateways over a shared room runtime: Socket gateways validate and route commands, RoomRuntime applies deterministic transitions, Redis stores active room snapshots for cross-instance truth, and PostgreSQL stores durable history/events for replay and audit. Preserve current event names/payloads while introducing room-scoped versioning, idempotency, and rehydrate-on-miss recovery.

**Major components:**
1. Edge/LB + sticky sessions: stable Engine.IO transport routing in multi-node deployments.
2. Realtime Gateway (Socket.IO handlers): connection lifecycle, validation, event contract enforcement.
3. Room Runtime Service: authoritative command handling and transition ordering.
4. Redis room state store + adapter bus: shared active-state and cross-instance fanout.
5. PostgreSQL history/event stores: durable reveal history and replayable event log.
6. HTTP operational surface: health/readiness/version with dependency-aware checks.

### Critical Pitfalls

1. **Client-asserted admin identity**: replace with server-issued signed role/session claims and per-event authorization.
2. **Multi-node split brain**: make shared Redis-backed runtime authoritative and test cross-instance convergence.
3. **Reconnect data drift**: treat rejoin as authoritative full-state sync; add event IDs/replay policy for critical flows.
4. **Load balancer transport misconfiguration**: enforce sticky sessions (or explicit websocket-only strategy) and timeout alignment.
5. **Open realtime surface and weak abuse controls**: enforce origin allowlist, auth at handshake, rate/message limits, and security telemetry.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Trust Boundary Hardening
**Rationale:** Authorization flaws undermine all ceremony outcomes and must be fixed before scaling/features.
**Delivers:** Server-issued signed room/session/admin claims, per-event authorization, origin allowlist baseline.
**Addresses:** Role-aware facilitation, safe reveal/reset/task controls.
**Avoids:** Client-forged admin and unauthorized state mutation.

### Phase 2: Realtime Contract Stabilization
**Rationale:** Freeze behavior before internal refactors to avoid regression cascade.
**Delivers:** Contract tests for all socket events/acks, handler modularization behind RoomRuntime interface.
**Uses:** Existing Socket.IO event surface and Jest baseline.
**Implements:** Gateway + runtime separation without client breakage.

### Phase 3: Shared State and Multi-Instance Readiness
**Rationale:** Cluster correctness is prerequisite for reliable ceremonies under scale.
**Delivers:** Redis-backed room authority, socket adapter wiring, room versioning/idempotency, sticky-session deployment contract.
**Addresses:** Reliable rooms, reconnect continuity, multi-node consistency.
**Avoids:** Split-brain state and session-id transport failures.

### Phase 4: Durability and Operational Resilience
**Rationale:** Recovery and predictable operations are needed before integration expansion.
**Delivers:** Postgres room event log, rehydrate-on-miss, deep readiness (DB/Redis), timeouts/retry/circuit rules, rate limits/metrics.
**Addresses:** Session history reliability and ceremony-time stability.
**Avoids:** Silent data loss, dependency-induced stalls, low-observability incidents.

### Phase 5: First Differentiator (Jira Two-Way Sync)
**Rationale:** Visible product value should follow platform hardening, not precede it.
**Delivers:** Jira story import + estimate sync-back with bounded failure behavior and telemetry.
**Addresses:** Competitive differentiation and workflow adoption.
**Avoids:** Integration-driven reliability regressions in core ceremony flows.

### Phase Ordering Rationale

- Security/authorization precedes scale because compromised authority invalidates all room semantics.
- Contract stabilization precedes architecture shifts to preserve backward compatibility during migration.
- Shared runtime state precedes advanced features because it is the dependency for reconnect correctness and async-ready evolution.
- Resilience/operations precede integration expansion to prevent external API failures from degrading core realtime UX.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** Redis concurrency strategy details (WATCH/MULTI vs Lua) and failure semantics under load.
- **Phase 5:** Jira API mapping, auth scopes, retry/backoff contracts, and sync conflict rules.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Signed token claims, message-level authorization, CORS/origin policy.
- **Phase 2:** Handler decomposition and socket contract test harness.
- **Phase 4:** Readiness probes, rate limits, timeout/circuit patterns, structured metrics.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Based on official Node/Socket.IO/TypeScript docs plus direct repo fit. |
| Features | HIGH | Table stakes strongly consistent across active planning-poker products. |
| Architecture | HIGH | Evolutionary path aligns with current code boundaries and known scaling patterns. |
| Pitfalls | HIGH | Risks are validated by codebase evidence and official Socket.IO/OWASP/Redis guidance. |

**Overall confidence:** HIGH

### Gaps to Address

- **Token lifecycle policy:** finalize expiry/rotation/revocation and legacy-room transition window during planning.
- **Redis atomic update method:** benchmark and choose WATCH/MULTI vs Lua with clear rollback semantics.
- **Reconnect replay scope:** define exactly which events require persisted offset replay vs full-state-only resync.
- **Jira integration boundaries:** lock MVP field mapping and failure UX before build starts.

## Sources

### Primary (HIGH confidence)
- [STACK.md](/I:/Server/domains/pocker/.planning/research/STACK.md)
- [FEATURES.md](/I:/Server/domains/pocker/.planning/research/FEATURES.md)
- [ARCHITECTURE.md](/I:/Server/domains/pocker/.planning/research/ARCHITECTURE.md)
- [PITFALLS.md](/I:/Server/domains/pocker/.planning/research/PITFALLS.md)
- https://github.com/nodejs/Release
- https://nodejs.org/en/about/releases/
- https://socket.io/docs/v4/using-multiple-nodes/
- https://socket.io/docs/v4/redis-adapter/
- https://socket.io/docs/v4/connection-state-recovery/
- https://socket.io/docs/v4/delivery-guarantees
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- https://redis.io/docs/latest/commands/keys/
- https://redis.io/docs/latest/commands/scan/

### Secondary (MEDIUM confidence)
- https://www.planningpoker.com/
- https://www.parabol.co/agile/sprint-poker/
- https://help.miro.com/hc/en-us/articles/10648975837970-Planner-for-Jira
- https://help.easyagile.com/easy-agile-teamrhythm/planning-poker

---
*Research completed: 2026-03-30*
*Ready for roadmap: yes*

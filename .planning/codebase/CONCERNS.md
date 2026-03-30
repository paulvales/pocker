# Codebase Concerns

**Analysis Date:** 2026-03-30

## Tech Debt

**[P1] Unused and likely broken Redis room persistence path (High impact, High likelihood):**
- Issue: A Redis-backed adapter exists but is not wired into the running server, and its import path likely breaks if enabled (`require('../room-registry')` from `src/stores` does not map to an existing file).
- Files: `index.js`, `src/stores/room-registry-adapter.js`, `src/stores/redis-room-store.js`
- Impact: Durable room state is effectively unavailable in production path; future attempts to enable Redis persistence can fail at runtime or behave differently than expected.
- Fix approach: Decide one canonical room-store architecture, wire it in `index.js`, fix module paths, and add integration tests that boot with Redis enabled.

**[P2] Heavy monolithic socket event handler (Medium impact, High likelihood):**
- Issue: Most real-time domain logic lives in one large file with mixed concerns (membership, voting, reactions, YouTrack sync, history persistence, event fanout).
- Files: `src/handlers/socket.js`
- Impact: Change risk and regression probability are high; ownership boundaries are unclear.
- Fix approach: Split by bounded concerns (`room-membership`, `voting`, `reactions`, `story-points-sync`) with a shared validation/ack layer.

**[P2] Mixed code placement between root and `src/` (Medium impact, Medium likelihood):**
- Issue: Core domain files stay at project root while newer pieces are in `src/`, and only part of `src/stores` is active.
- Files: `room-registry.js`, `estimation-history-store.js`, `index.js`, `src/**/*`
- Impact: Navigation friction, accidental duplicate implementations, and drift between intended vs active architecture.
- Fix approach: Move all runtime modules under `src/` and enforce import boundaries.

## Known Bugs

**[P1] Admin role trust is client-asserted (High impact, High likelihood):**
- Symptoms: First client to join with `isAdmin: true` becomes admin; no secret, token, or server-issued role proof.
- Files: `room-registry.js`, `src/handlers/socket.js`
- Trigger: Any client sends `join` with `isAdmin: true` before others.
- Workaround: None in code; relies on social coordination.

**[P2] Redis restore logic restores room shell only, not full room state (Medium impact, Medium likelihood):**
- Symptoms: `restoreFromRedis` loads state but recreates only room identity, not persisted note/task/votes/players.
- Files: `src/stores/room-registry-adapter.js`
- Trigger: Server restart with Redis-backed rooms.
- Workaround: None; state continuity is partial by implementation.

## Security Considerations

**[P1] Open CORS policy on Socket.IO endpoint (High impact, High likelihood):**
- Risk: Any origin can open socket connections; abuse/spam risk increases.
- Files: `index.js`
- Current mitigation: Room membership checks for specific events in `room-registry.js`.
- Recommendations: Restrict allowed origins via environment-driven allowlist; add rate limiting and connection throttling.

**[P1] No authentication or authorization boundary beyond room membership (High impact, High likelihood):**
- Risk: Role assignment and sensitive actions (`note`, `task list`, `story points`) are effectively protected only by in-memory membership and first-admin semantics.
- Files: `room-registry.js`, `src/handlers/socket.js`
- Current mitigation: `assertMembership(..., { requireAdmin: true })` checks.
- Recommendations: Introduce signed room/session tokens, explicit admin claim verification, and server-issued role transitions.

**[P2] Outbound YouTrack call lacks timeout/circuit-breaker safeguards (Medium impact, Medium likelihood):**
- Risk: Hanging or slow upstream can degrade event-loop responsiveness for `set_story_points`.
- Files: `src/handlers/socket.js`
- Current mitigation: Error is returned via callback on failure.
- Recommendations: Add `AbortController` timeout, bounded retries with backoff, and structured failure metrics.

**[P2] TLS verification weakened for DB when `sslmode` is enabled (Medium impact, Medium likelihood):**
- Risk: `rejectUnauthorized: false` accepts unverifiable cert chains, increasing MITM exposure.
- Files: `estimation-history-store.js`
- Current mitigation: TLS is enabled, but verification is relaxed.
- Recommendations: Support CA bundle configuration and default to strict verification in production.

## Performance Bottlenecks

**[P2] Synchronous filesystem checks in request path (Medium impact, Medium likelihood):**
- Problem: `existsSync/statSync` are used during HTTP request handling.
- Files: `src/routes/http.js`
- Cause: Blocking file metadata calls in hot path.
- Improvement path: Use async `fs.promises` with a static-file cache strategy where applicable.

**[P2] Redis `KEYS` scan pattern can block at scale (Medium impact, Medium likelihood):**
- Problem: Active room listing uses `redis.keys(...)`.
- Files: `src/stores/redis-room-store.js`
- Cause: `KEYS` is O(N) and blocks Redis for large keyspaces.
- Improvement path: Replace with `SCAN` iterator and bounded pagination.

**[P3] Sequential inserts for history append (Low impact, Medium likelihood):**
- Problem: History append loops single-row inserts in a transaction.
- Files: `estimation-history-store.js`
- Cause: Per-entry roundtrips.
- Improvement path: Use batched multi-row inserts when reveal payload grows.

## Fragile Areas

**[P1] Real-time event contract fragility in single handler module:**
- Files: `src/handlers/socket.js`, `__tests__/server.test.js`
- Why fragile: Many events share mutable room state and ordering assumptions; small changes can break unrelated behaviors.
- Safe modification: Add event-specific contract tests before refactoring each handler branch.
- Test coverage: High for happy paths in `__tests__/server.test.js`, but gaps for failure injection and adversarial client behavior.

**[P2] In-memory room lifecycle without explicit TTL/cleanup policy (when Redis adapter is inactive):**
- Files: `room-registry.js`, `index.js`
- Why fragile: Map-backed state grows with room creation and depends on disconnect cleanup behavior.
- Safe modification: Add explicit room garbage-collection policy and metrics for room count/age.
- Test coverage: Basic lifecycle covered; no long-run soak tests in CI.

## Scaling Limits

**[P1] Single-process in-memory authority for room state:**
- Current capacity: Bound to one Node process memory/CPU and one Socket.IO instance.
- Limit: Horizontal scaling causes split-brain room state without shared adapter.
- Scaling path: Introduce active shared state backend (Redis) plus adapter integration tests and deployment profile.

**[P2] Health endpoint does not include dependency health:**
- Current capacity: `/health` only reports process/version.
- Limit: Can report healthy while DB or external integrations are degraded.
- Scaling path: Add readiness checks for DB connectivity and optional integration probes.

## Dependencies at Risk

**[P2] Runtime dependency on Node global `fetch`:**
- Risk: Behavior differs across Node versions/platform policy if runtime changes.
- Impact: YouTrack sync path can break unexpectedly.
- Migration plan: Pin runtime version in deployment and/or use explicit HTTP client dependency with controlled timeouts.

**[P2] `pg` connection SSL behavior customized in app code:**
- Risk: Provider-specific connection quirks are handled with relaxed trust and can drift from platform security baselines.
- Impact: Security/compliance concerns and deployment inconsistency.
- Migration plan: Externalize DB SSL settings and verify against provider CA chain.

## Missing Critical Features

**[P1] No robust identity/auth model for room/admin actions:**
- Problem: Role and trust are implicit and client-driven.
- Blocks: Safe public internet exposure with strong abuse resistance.

**[P1] No first-class observability (metrics/traces/alerts):**
- Problem: Logging exists, but no metrics endpoint or SLO monitoring pipeline.
- Blocks: Reliable incident detection, capacity planning, and regressions triage.

## Test Coverage Gaps

**[P1] Security and abuse-path tests are sparse:**
- What's not tested: Origin restrictions, role forgery hardening, brute-force/rate-limit behavior, malicious payload patterns.
- Files: `index.js`, `src/handlers/socket.js`, `room-registry.js`, `__tests__/server.test.js`
- Risk: Security regressions can ship unnoticed.
- Priority: High

**[P2] Redis adapter/store paths are not covered in CI tests:**
- What's not tested: Redis initialization, restore behavior, error handling, and cross-instance consistency semantics.
- Files: `src/stores/room-registry-adapter.js`, `src/stores/redis-room-store.js`, `.github/workflows/ci.yml`
- Risk: Persistence/scaling features can fail silently when activated.
- Priority: High

**[P2] Operational scripts/deploy workflows are not validated in automated tests:**
- What's not tested: `server-deploy.sh` and local-registry release flow under failure modes.
- Files: `scripts/server-deploy.sh`, `scripts/release-local-registry.sh`, `.github/workflows/ci.yml`
- Risk: Deployment incidents due to script drift.
- Priority: Medium

---

*Concerns audit: 2026-03-30*
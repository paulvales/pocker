# Domain Pitfalls

**Domain:** Realtime planning-poker systems (Socket.IO + room state + history persistence)  
**Researched:** 2026-03-30

## Phase Mapping Legend

- **Phase A: Auth Hardening** - server-verifiable identity, admin claims, origin policy, message-level authorization.
- **Phase B: Resilience & Operations** - readiness/health depth, timeout/circuit-breakers, telemetry, abuse controls.
- **Phase C: Multi-Instance Scaling** - shared room authority, adapter correctness, sticky sessions, reconnect behavior.
- **Phase D: Realtime Modularization & Contract Tests** - handler decomposition, adversarial and failure-injection tests.

## Critical Pitfalls

### Pitfall 1: Trusting client-asserted admin identity
**What goes wrong:** First client can self-claim admin and mutate room note/task/mode/reveal flows.  
**Why it happens:** Role claim is accepted from client payload instead of server-issued proof.  
**Consequences:** Unauthorized reveals/resets/task edits; session integrity collapses.  
**Warning signs:**
- Join payload includes `isAdmin: true` and grants privileged behavior.
- No signed token/session binding for admin rights.
- Security tests only cover happy-path `FORBIDDEN`, not role-forgery attempts.
**Prevention strategy:**
- Issue short-lived signed room-session tokens (admin/viewer scope) from server.
- Validate authorization per event, not just at join time.
- Rotate/invalidate tokens on disconnect/logout/session expiry.
**Phase mapping:** **Phase A** (implementation), **Phase D** (forgery regression tests).

### Pitfall 2: Assuming "connected now" means no data loss
**What goes wrong:** Votes/reveal/task events are missed across temporary disconnects and clients drift from room truth.  
**Why it happens:** Socket.IO is at-most-once by default; server does not buffer all missed events by default.  
**Consequences:** Inconsistent vote visibility, incorrect reveal outcomes, broken trust in estimations.  
**Warning signs:**
- Reconnect paths rely only on live broadcasts.
- No event IDs/offset replay or explicit state resync after reconnect.
- Intermittent reports of "my vote disappeared" or stale UI after tab/network interruption.
**Prevention strategy:**
- Keep join/rejoin as authoritative full-state resync path.
- Add event IDs + persisted offset replay for critical events (vote/reveal/task/mode).
- Evaluate Socket.IO connection-state recovery with explicit fallback when `recovered === false`.
**Phase mapping:** **Phase B** (reconnect policy + telemetry), **Phase D** (disconnect/failure tests), **Phase C** (cross-node consistency).

### Pitfall 3: Multi-node split brain (local memory authority in clustered deploys)
**What goes wrong:** Different instances hold divergent room state; participants in same room see different realities.  
**Why it happens:** In-memory authority with incomplete/unused shared adapter path.  
**Consequences:** Reveal/reset/vote/task state divergence; severe production incidents under scale.  
**Warning signs:**
- Room state backend is process-local only.
- Redis adapter/store path exists but not exercised in CI.
- Bugs appear only after adding second instance/load balancer.
**Prevention strategy:**
- Make one canonical shared room-state architecture and wire it as default for multi-instance mode.
- Add integration tests that boot multiple app instances against shared backend and assert state convergence.
- Add startup safety checks that fail fast when cluster mode is enabled without required adapter config.
**Phase mapping:** **Phase C** (architecture + deployment), **Phase D** (multi-instance contract tests).

### Pitfall 4: Incorrect load-balancer strategy for Socket.IO transport mix
**What goes wrong:** Clients hit HTTP 400 "Session ID unknown," frequent reconnect loops, phantom disconnects.  
**Why it happens:** No sticky session while long-polling is enabled, or mismatched proxy timeouts.  
**Consequences:** Random room drops, perceived instability, low confidence during live planning sessions.  
**Warning signs:**
- Spikes of transport errors under load-balanced deployment.
- Intermittent reconnect storms concentrated behind ingress/proxy.
- No explicit sticky-session or websocket-only transport decision in ops docs.
**Prevention strategy:**
- Decide explicitly: sticky sessions with polling fallback, or websocket-only transport.
- Validate ingress/proxy timeout values against Socket.IO heartbeat settings.
- Add deployment verification tests (smoke + chaos reconnect) in CI/CD environment profile.
**Phase mapping:** **Phase C** (LB + adapter design), **Phase B** (operational verification).

### Pitfall 5: Open-origin realtime endpoint + weak message-level controls
**What goes wrong:** Cross-site and abuse traffic reaches websocket endpoint; event handlers become attack surface.  
**Why it happens:** Permissive origin/CORS policy and weak handshake/message authorization.  
**Consequences:** CSWSH risk, unauthorized action attempts, connection/resource exhaustion.  
**Warning signs:**
- Socket endpoint accepts arbitrary origins.
- No explicit origin allowlist enforcement in handshake.
- Missing per-user/per-IP rate limits and message size caps.
**Prevention strategy:**
- Enforce explicit origin allowlist and secure token-based auth at handshake.
- Keep message-level authorization for every state-mutating event.
- Add connection/message rate limits and security event logging.
**Phase mapping:** **Phase A** (auth/origin policy), **Phase B** (rate limiting + monitoring), **Phase D** (security regression suite).

### Pitfall 6: Blocking or unbounded external calls inside realtime handlers
**What goes wrong:** One slow upstream dependency stalls event-loop responsiveness for unrelated room actions.  
**Why it happens:** Outbound calls in socket handlers without timeout/circuit-breaker boundaries.  
**Consequences:** Increased ack latency, dropped clients, degraded session UX during integrations failure.  
**Warning signs:**
- p95/p99 ack latency spikes during external API incidents.
- "Works locally, stalls in prod" reports tied to integration calls.
- No timeout/retry/circuit metrics on outbound requests.
**Prevention strategy:**
- Apply hard timeouts, bounded retries, and circuit-breaker behavior for all external calls.
- Offload non-critical side effects to async workers/queues.
- Separate critical in-room mutations from best-effort integrations.
**Phase mapping:** **Phase B** (resilience envelope), **Phase D** (failure-injection tests).

### Pitfall 7: Realtime logic monolith without contract-first tests
**What goes wrong:** Small edits break unrelated events (vote/reveal/task/reaction/history) due to hidden coupling.  
**Why it happens:** Large handler module with mixed concerns and implicit ordering assumptions.  
**Consequences:** Frequent regressions and slower delivery velocity in subsequent milestones.  
**Warning signs:**
- Single handler file owns many room behaviors.
- New features repeatedly require broad retesting of entire socket surface.
- Incident fixes create follow-on regressions in neighboring event branches.
**Prevention strategy:**
- Split handlers by bounded domain (membership, voting, tasks, reactions, integrations).
- Keep event schema contracts centralized and versioned.
- Add adversarial tests: reconnect races, duplicate emits, out-of-order events, malicious payloads.
**Phase mapping:** **Phase D** (modularization + tests), with **Phase A/B/C** regression gates.

## Moderate Pitfalls

### Pitfall 1: Using Redis `KEYS` in runtime paths
**What goes wrong:** Redis latency spikes and keyspace blocking under growth.  
**Warning signs:** Active-room listing slows as room count increases.  
**Prevention strategy:** Replace `KEYS` with cursor-based `SCAN`, with bounded pagination and metrics.  
**Phase mapping:** **Phase C**.

### Pitfall 2: In-memory room lifecycle without TTL/GC policy
**What goes wrong:** Long-running process accumulates stale rooms and memory pressure.  
**Warning signs:** Room count only trends upward; heap growth without corresponding active sessions.  
**Prevention strategy:** Add idle TTL/garbage collection and metrics on room age/count/activity.  
**Phase mapping:** **Phase B**.

## Minor Pitfalls

### Pitfall 1: Weak observability for realtime correctness
**What goes wrong:** Team cannot distinguish user-network issues from server-state bugs quickly.  
**Warning signs:** Incidents depend on manual log grepping; no per-event success/error/latency dashboards.  
**Prevention strategy:** Emit structured metrics and traces for join/vote/reveal/reset/task/mode/reaction flows.  
**Phase mapping:** **Phase B**.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Auth hardening rollout | Breaking existing room links while introducing signed tokens | Dual-mode transition (legacy + signed) with explicit sunset date and telemetry |
| Reconnect reliability | False confidence from connection-state recovery alone | Always keep full-state resync path and test `recovered=false` behavior |
| Multi-instance rollout | Enabling adapter without sticky-session/proxy tuning | Staging soak test with LB + adapter + forced disconnect scenarios |
| Handler modularization | Behavior drift during refactor | Freeze event contracts and add before/after parity test matrix |

## Sources

- Project context and risks: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `__tests__/server.test.js` (HIGH, project-primary).
- Socket.IO docs - delivery guarantees: https://socket.io/docs/v4/delivery-guarantees (HIGH).
- Socket.IO docs - handling disconnections: https://socket.io/docs/v4/tutorial/handling-disconnections (HIGH).
- Socket.IO docs - connection state recovery (including adapter compatibility): https://socket.io/docs/v4/connection-state-recovery (HIGH).
- Socket.IO docs - multiple nodes / sticky sessions / 400 session unknown: https://socket.io/docs/v4/using-multiple-nodes (HIGH).
- OWASP WebSocket Security Cheat Sheet (origin validation, message-level auth, DoS controls, monitoring): https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html (HIGH).
- Redis command docs - `KEYS` warning: https://redis.io/docs/latest/commands/keys/ (HIGH).
- Redis command docs - `SCAN` behavior and guarantees: https://redis.io/docs/latest/commands/scan/ (HIGH).

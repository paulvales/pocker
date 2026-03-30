# Roadmap: Pocker

**Project:** Pocker  
**Granularity:** standard  
**Source requirements:** `.planning/REQUIREMENTS.md` v1

## Phases

- [ ] **Phase 1: Trust Boundary Hardening** - Secure facilitator authority and privileged realtime actions.
- [ ] **Phase 2: Session Reliability Guarantees** - Make reconnect and retry behavior deterministic for active ceremonies.
- [ ] **Phase 3: Shared Room State & Scale Readiness** - Enable multi-instance room correctness with safe room lifecycle controls.
- [ ] **Phase 4: Integration Resilience & Operability** - Protect ceremony flow from integration failures and improve service observability.
- [ ] **Phase 5: Regression Guardrails for Realtime/Scale Paths** - Lock in behavior with adversarial and scale-path CI coverage.

## Phase Details

### Phase 1: Trust Boundary Hardening
**Goal**: Users can trust that only a server-verified facilitator can perform privileged room actions.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
1. A user without server-verified facilitator proof cannot reveal, reset, or change story-point/task state.
2. A user with valid facilitator context can perform privileged actions from any active room session without client-side flag hacks.
3. Socket connections from disallowed origins are rejected using environment-configured origin policy.
4. Bursty or malformed critical action events are rate-limited/rejected without crashing room flow.
**Plans**: TBD

### Phase 2: Session Reliability Guarantees
**Goal**: Users can continue estimation sessions through disconnects and retries without manual recovery.
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
1. A reconnecting participant is automatically returned to the same room and sees current room state immediately.
2. Repeated vote/reveal/reset attempts caused by retries do not create duplicated or conflicting room outcomes.
3. Clients receive standardized error shapes for API/socket failures so UI handling is predictable.
4. Operators can correlate API/socket errors in logs using consistent structured error fields.
**Plans**: TBD

### Phase 3: Shared Room State & Scale Readiness
**Goal**: Teams can run rooms safely in multi-instance deployments with consistent state across nodes.
**Depends on**: Phase 2
**Requirements**: ROOM-01, ROOM-02, ROOM-03
**Success Criteria** (what must be TRUE):
1. With shared-state mode enabled, room behavior matches single-instance semantics for join, vote, reveal, and reset.
2. Multi-node deployments pass adapter and sticky-session validation before scale mode is considered ready.
3. Stale rooms are cleaned up by lifecycle policy (TTL/GC) without removing active rooms.
4. Room lifecycle metrics expose enough signal to verify cleanup and active-room health over time.
**Plans**: TBD

### Phase 4: Integration Resilience & Operability
**Goal**: External integration problems do not interrupt planning sessions, and system health is visible.
**Depends on**: Phase 3
**Requirements**: INTG-01, INTG-02, OPS-01, OPS-02
**Success Criteria** (what must be TRUE):
1. Tracker update calls fail fast using explicit timeout and bounded retry behavior.
2. When tracker integration fails, estimation can still continue and clients receive actionable failure codes.
3. Readiness reflects dependency health (history store and optional integrations) rather than process-only liveness.
4. Operators can observe baseline metrics for active sessions, handler latency, and error rates.
**Plans**: TBD

### Phase 5: Regression Guardrails for Realtime/Scale Paths
**Goal**: Critical realtime and scaling behaviors are continuously protected from regressions.
**Depends on**: Phase 4
**Requirements**: QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):
1. CI fails when adversarial contract scenarios (role forgery, reconnect race, duplicated events) regress.
2. CI runs Redis/state-path integration coverage whenever scale mode is enabled and blocks merges on failures.
3. Maintainers can identify whether failures are contract-path or scale-path via test suite output.
**Plans**: TBD

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Trust Boundary Hardening | 0/0 | Not started | - |
| 2. Session Reliability Guarantees | 0/0 | Not started | - |
| 3. Shared Room State & Scale Readiness | 0/0 | Not started | - |
| 4. Integration Resilience & Operability | 0/0 | Not started | - |
| 5. Regression Guardrails for Realtime/Scale Paths | 0/0 | Not started | - |

## Coverage Validation

- Total v1 requirements: 16
- Mapped requirements: 16
- Unmapped requirements: 0
- Duplicate mappings: 0

### Requirement to Phase Map

- AUTH-01 -> Phase 1
- AUTH-02 -> Phase 1
- AUTH-03 -> Phase 1
- AUTH-04 -> Phase 1
- SESS-01 -> Phase 2
- SESS-02 -> Phase 2
- SESS-03 -> Phase 2
- ROOM-01 -> Phase 3
- ROOM-02 -> Phase 3
- ROOM-03 -> Phase 3
- INTG-01 -> Phase 4
- INTG-02 -> Phase 4
- OPS-01 -> Phase 4
- OPS-02 -> Phase 4
- QUAL-01 -> Phase 5
- QUAL-02 -> Phase 5

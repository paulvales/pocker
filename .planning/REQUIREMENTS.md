# Requirements: Pocker

**Defined:** 2026-03-30
**Core Value:** A team can join a room link and complete a planning poker estimation cycle reliably in real time with minimal friction.

## v1 Requirements

### Security & Access

- [ ] **AUTH-01**: Room facilitator/admin rights are granted by server-verifiable proof, not client-supplied flags
- [ ] **AUTH-02**: Privileged socket actions (reveal/reset/task/story-points) require authenticated facilitator context on the server
- [ ] **AUTH-03**: Socket connections are restricted to an allowlisted origin policy configurable by environment
- [ ] **AUTH-04**: Event-level abuse controls exist for critical actions (rate limiting and payload validation)

### Session Reliability

- [ ] **SESS-01**: Client reconnect re-joins the same room and receives current room state without manual recovery
- [ ] **SESS-02**: Vote/reveal/reset flows are idempotent under retries and transient disconnects
- [ ] **SESS-03**: API and socket error responses are standardized and observable in logs

### Room State & Scale

- [ ] **ROOM-01**: Shared room-state backend can be enabled for multi-instance operation without breaking existing room behavior
- [ ] **ROOM-02**: Cross-node Socket.IO configuration is validated (adapter + sticky sessions) before scale mode is enabled
- [ ] **ROOM-03**: Room lifecycle cleanup policy exists (TTL/GC) with safe defaults and metrics

### Integrations

- [ ] **INTG-01**: Outbound YouTrack/Jira update calls use explicit timeout and bounded retry policy
- [ ] **INTG-02**: Integration failures do not break planning flow and return actionable error codes to clients

### Operability & Quality

- [ ] **OPS-01**: Readiness signal includes dependency health (history store + optional integration checks)
- [ ] **OPS-02**: Baseline service metrics are exposed for session count, error rates, and handler latency
- [ ] **QUAL-01**: Realtime handler contract tests cover adversarial flows (role forgery, reconnect races, duplicated events)
- [ ] **QUAL-02**: Redis/state-path integration tests run in CI when scale mode is enabled

## v2 Requirements

### Product Differentiators

- **PROD-01**: Two-way issue tracker sync supports pull + push reconciliation with conflict handling
- **PROD-02**: Advanced moderation controls (temporary mute/kick and room-level audit actions)
- **PROD-03**: Team-level room templates and reusable estimation workflows

### Platform Enhancements

- **PLAT-01**: Incremental static typing strategy (`checkJs`/TypeScript) for realtime domain modules
- **PLAT-02**: Event stream/audit-log architecture for deep replay and incident forensics

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile app | Web flow covers current usage pattern and keeps delivery focused |
| Full enterprise IAM (SAML/SCIM) | Not required for current deployment stage |
| Realtime chat unrelated to estimation | Expands scope beyond core planning poker value |
| Full framework rewrite | Introduces high migration risk with low immediate value |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 2 | Pending |
| ROOM-01 | Phase 3 | Pending |
| ROOM-02 | Phase 3 | Pending |
| ROOM-03 | Phase 3 | Pending |
| INTG-01 | Phase 4 | Pending |
| INTG-02 | Phase 4 | Pending |
| OPS-01 | Phase 4 | Pending |
| OPS-02 | Phase 4 | Pending |
| QUAL-01 | Phase 5 | Pending |
| QUAL-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after initialization*

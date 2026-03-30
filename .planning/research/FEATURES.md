# Feature Landscape

**Domain:** Planning-poker / Scrum-poker products
**Project:** Pocker (subsequent milestone)
**Researched:** 2026-03-30

## Method and Confidence

This classification combines:
- Current project context (`.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `README.md`)
- Current product positioning from active planning-poker tools and docs (see Sources)

Confidence by section:
- Table stakes: **HIGH** (strong cross-product consistency)
- Differentiators: **MEDIUM** (varies by target segment)
- Anti-features: **MEDIUM** (partly judgment based on domain fit and your constraints)

## Table Stakes

These are expected in 2026. Missing these makes a planning-poker product feel incomplete.

| Feature | Why Expected | Complexity | Dependency Notes |
|---|---|---|---|
| Real-time multi-user room sessions via shareable link | Core interaction model across tools | Medium | Stable Socket.IO room authority, connection/reconnect handling |
| Hidden voting + synchronized reveal | Fundamental anti-anchoring mechanic | Medium | Consistent vote-state model, deterministic reveal/reset events |
| Re-vote/reset flow per story | Required for consensus loops | Low | Stateful round lifecycle and idempotent reset handlers |
| Common estimation decks (Fibonacci, T-shirt) and simple custom deck support | Teams use different estimation styles | Low-Med | Deck config schema + client rendering compatibility |
| Story/task list per session with next/previous navigation | Sessions estimate multiple items, not one-off votes | Medium | Room-scoped task state and ordering semantics |
| Role-aware facilitation (facilitator/admin vs participant/observer) | Session control requires explicit host authority | Medium-High | **Blocked by current client-asserted admin trust**; needs server-verifiable role claims |
| Session history (final estimate + notes) | Teams need auditability and retrospection | Medium | Persistence consistency, backward-compatible history schema |
| Basic reliability signals (`/health`, predictable reconnect behavior) | Teams expect tool to work during ceremonies | Medium | Readiness/health depth, graceful dependency failure handling |

## Differentiators

These do not define baseline usability, but they can materially improve adoption and retention.

| Feature | Value Proposition | Complexity | Dependency Notes |
|---|---|---|---|
| Two-way backlog integrations (Jira/GitHub/GitLab) with import + estimate sync-back | Eliminates context switching and manual copy/paste | High | Auth/oauth flow, field mapping, retries/timeouts, integration observability |
| Async estimation mode (vote before/without live meeting) | Supports distributed teams across time zones | High | Durable per-user vote state, deadlines, partial reveal policy |
| Rich consensus analytics (distribution, consensus score, trend over time) | Improves calibration and team estimation quality | Medium-High | Clean history model, aggregation queries, clear data retention policy |
| Multi-dimensional estimation (e.g., value + effort/WSJF style) | Useful for teams combining sizing and prioritization | High | Flexible schema, UI complexity, workflow redesign |
| Automated meeting summary/export (CSV + concise recap) | Reduces facilitator overhead and improves follow-up | Medium | Reliable event capture and summary generation rules |
| Strong enterprise hardening as a product capability (auditable auth, CORS policy, rate limiting) | Turns “toy poker app” into production-ready team service | Medium-High | Security middleware, token model, abuse tests, ops instrumentation |

## Anti-Features

These features are likely to slow delivery or dilute product value for this project’s next milestone.

| Anti-Feature | Why Avoid (Now) | What to Do Instead |
|---|---|---|
| Building native mobile apps | High surface-area cost; current app is web-first and this is explicitly out of scope | Keep mobile-responsive web UX only |
| Full enterprise identity platform (SSO/SAML/SCIM) in this milestone | Large integration and compliance scope, not needed for current deployment scope | Implement lightweight signed room/session tokens and server-verified facilitator role |
| In-app full chat/video collaboration suite | Not core to estimation mechanics; increases moderation, performance, and UX complexity | Keep lightweight reactions/notes and rely on existing team comms tools |
| Heavy roadmap/program-planning suite inside Pocker | Competes with Jira/Miro rather than complementing them | Focus on estimation workflow + selective sync/export |
| AI-estimate autopilot as a primary flow | High trust risk; can undermine team discussion and calibration | Add analytics first; if AI is explored later, keep as optional suggestion only |

## Feature Dependencies

```text
Server-verifiable facilitator identity
  -> Safe admin actions (reveal/reset/task controls)
  -> Trustworthy multi-user sessions

Durable room/state backend integration (Redis adapter wired + tested)
  -> Multi-instance scaling
  -> Async estimation feasibility
  -> Reliable reconnect semantics

Robust history model
  -> Consensus analytics
  -> Session summaries/exports

Integration abstraction layer (Jira/GitHub/etc.)
  -> Two-way backlog sync
  -> Automated estimate write-back
```

## What This Project Should Prioritize Next

Given current codebase concerns, the best next milestone is **table-stakes hardening first**, then one focused differentiator.

1. **Secure facilitation and session authority (Table-stakes hardening)**
   - Implement server-verifiable facilitator/admin claims (replace client-asserted admin).
   - Add explicit role transition rules and abuse-path tests.
   - Why first: Current P1 risk; foundational for trusted reveal/reset/task actions.

2. **Operational reliability for real ceremonies (Table-stakes hardening)**
   - Deepen readiness checks (DB + optional integrations), add timeouts/circuit behavior for external calls.
   - Restrict CORS + add connection/rate safeguards.
   - Why second: Reduces ceremony-time failures and incident risk.

3. **Shared state/scaling path (Table-stakes hardening with future leverage)**
   - Wire and test Redis room-store path end-to-end (including restore correctness).
   - Add cross-instance contract tests.
   - Why third: Enables confident multi-instance deployment and unlocks async/differentiator features.

4. **One market-visible differentiator: two-way backlog sync (Jira first)**
   - Import stories and write estimates back with strict timeout/retry boundaries.
   - Keep scope narrow: one integration done well > many shallow integrations.
   - Why fourth: Strong user-visible value once trust/reliability baseline is solved.

## MVP Recommendation for This Milestone

Prioritize:
1. Server-verifiable facilitator/admin authorization
2. Reliability and abuse hardening (readiness, CORS/rate limits, external-call safeguards)
3. Redis-backed shared room-state integration with tests
4. Jira two-way sync as the first differentiator

Defer:
- Async estimation mode until shared-state reliability is proven
- Advanced analytics until history schema and retention are settled
- Mobile native, SSO/SAML/SCIM, and chat/video features

## Sources

Primary ecosystem/product sources used:
- PlanningPoker.com homepage/features: https://www.planningpoker.com/ (anonymous voting, custom scoring/timers, Jira sync messaging)
- Parabol Sprint Poker: https://www.parabol.co/agile/sprint-poker/ (hidden votes, reveal flow, async discussion, integrations)
- Parabol support (GitHub issue import/sync-back): https://www.parabol.co/support/how-to-select-github-issues-for-estimation/ and https://www.parabol.co/support/how-to-synchronize-estimates-back-to-github/
- Miro planning poker page: https://miro.com/agile/planning-poker/ (inclusive estimation, anti-groupthink positioning)
- Miro Planner for Jira help doc (updated 2026-02-09): https://help.miro.com/hc/en-us/articles/10648975837970-Planner-for-Jira (real-time Jira sync/capacity context)
- Easy Agile TeamRhythm planning poker doc: https://help.easyagile.com/easy-agile-teamrhythm/planning-poker (sync/async voting, reveal, clear-votes flow in Jira)
- Pointing Poker homepage: https://www.pointingpoker.com/ (no-signup, quick session expectations)

Project context sources:
- `.planning/PROJECT.md`
- `.planning/codebase/CONCERNS.md`
- `README.md`

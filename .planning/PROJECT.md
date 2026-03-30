# Pocker

## What This Is

Pocker is a real-time Scrum Poker tool for distributed teams running estimation sessions by room link. It provides live voting, reveal/reset, per-room tasks and notes, reactions, and estimation history. The current system is production-oriented around a Node.js + Socket.IO backend with a lightweight web UI.

## Core Value

A team can join a room link and complete a planning poker estimation cycle reliably in real time with minimal friction.

## Requirements

### Validated

- ✅ Team can create and join dynamic room links for estimation sessions - existing
- ✅ Team members can vote, reveal, reset, and switch estimation modes in real time - existing
- ✅ Estimation history is persisted and queryable via API/UI history view - existing
- ✅ Basic admin-only controls for room-level actions exist on server side - existing

### Active

- [ ] Harden authorization so admin privileges are server-verifiable, not client-asserted
- [ ] Improve operational resilience: stricter health/readiness signals and safer external integration behavior
- [ ] Strengthen scalability path for multi-instance deployments with verified shared room state
- [ ] Reduce regression risk in realtime handlers through modularization and contract-focused tests

### Out of Scope

- Mobile native applications - web-first delivery remains sufficient for current users
- Full enterprise identity platform (SSO/SAML/SCIM) - not required for current deployment scope
- Realtime chat/messaging beyond estimation mechanics - not core to planning poker value

## Context

- Existing brownfield Node.js repository with active runtime code and test suite.
- Core architecture and risks are documented in `.planning/codebase/`.
- Existing deployment path is Docker/Compose with optional Traefik and registry workflow.
- Room authority is currently process-local and mostly in-memory; optional Redis adapter exists but is not integrated.
- Project already carries production-facing concerns: reliability, abuse resistance, and maintainability.

## Constraints

- **Tech stack**: Node.js + Socket.IO + current frontend stack - preserve existing runtime to minimize migration risk
- **Compatibility**: Existing room-link UX and client event contracts must keep working - avoids breaking active users
- **Operations**: Docker/Compose-first deployment flow remains supported - aligns with current release process
- **Data safety**: History persistence must remain backward-compatible - prevents loss of historical estimation records

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat this initialization as brownfield, not greenfield | Codebase and behavior already exist in production-oriented form | ✓ Good |
| Use codebase map findings as baseline context | Fresh architecture/concerns audit is available and actionable | ✓ Good |
| Prioritize reliability/security/scalability over net-new product surfaces in early phases | Main risk is operational integrity, not missing core MVP features | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after initialization*

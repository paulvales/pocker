# Technology Stack Recommendations (2025/2026)

**Project:** pocker (existing Scrum Poker app)  
**Researched:** 2026-03-30  
**Scope:** Stack-only guidance for next milestone, minimizing rewrites

## Executive Recommendation

Keep the core architecture (`Node + Socket.IO + PostgreSQL + Docker Compose`) and upgrade the runtime/operational layers around it. Do not rewrite to a new framework (NestJS/Next.js/full SPA) in this milestone.

The biggest pragmatic gains now are:
1. Move runtime baseline from Node 18/20 to Node 24 LTS (with Node 22 still tested during transition).
2. Wire Redis-backed room state as an actual production path (it exists in repo but is not integrated in `index.js`).
3. Standardize observability and deployment contracts (readiness/health, structured logs, config validation) before adding features.

## What 2025/2026 "Standard" Looks Like For This Domain

For real-time collaborative web apps, the mainstream production stack remains:
- Node.js on active LTS line(s)
- Socket.IO/WebSocket transport with multi-node strategy and sticky sessions when scaled horizontally
- PostgreSQL for durable business/history data
- Redis/Valkey for ephemeral coordination and cross-instance state
- Docker-based deployment with CI matrix over active LTS Node versions

This project already matches the core shape. The gap is not stack mismatch; it is production hardening and activation of already-present scaling components.

## Keep / Adopt / Avoid

## Keep

| Decision | Why | Confidence |
|---|---|---|
| Keep Socket.IO transport and event model | Existing domain behavior is already built around room events and acks. Replacing transport is high-risk and low-ROI now. | HIGH |
| Keep PostgreSQL for estimation history | Durable history model is in place and aligned with current product requirements. | HIGH |
| Keep Docker/Compose deployment flow | Existing ops workflow is already Compose-first and production-oriented. | HIGH |
| Keep Jest in this milestone | Current tests are Jest-based; switching runner now is churn without clear milestone value. | MEDIUM |

## Adopt Next (Non-Disruptive)

| Priority | Adopt | Concrete Action | Why Now | Confidence |
|---|---|---|---|---|
| P0 | Node 24 LTS baseline | Update `Dockerfile` to `node:24-alpine`; update CI matrix to `22.x` + `24.x`; drop `18.x` | Node 24 is Active LTS in 2026; current image is still Node 18. | HIGH |
| P0 | Real shared room state path | Wire existing Redis-backed registry path (`src/stores/room-registry-adapter.js`) behind env flag; add tests for cross-instance consistency semantics | Milestone explicitly targets multi-instance resilience; current Redis code is not wired in `index.js`. | HIGH |
| P1 | Socket.IO multi-node contract | Add documented production requirement for sticky sessions + adapter strategy when running multiple instances | Official Socket.IO multi-node guidance requires this; prevents subtle reconnect/session issues. | HIGH |
| P1 | Config contract validation | Add startup validation for required env vars and sane defaults; fail fast on invalid critical config | Prevents partial boot with broken integrations and improves ops reliability. | HIGH |
| P2 | Incremental type-safety in JS | Enable `allowJs` + `checkJs`, add JSDoc types to critical modules first (`room-registry`, socket handlers) | Improves regression resistance without TypeScript rewrite. | HIGH |

## Avoid (This Milestone)

| Avoid | Why | Confidence |
|---|---|---|
| Full framework rewrite (NestJS/Fastify/Next SSR) | Disruptive and not required to solve current risks (auth hardening, resilience, scale path). | HIGH |
| Frontend stack replacement | Current UI is not primary bottleneck; realtime correctness and backend operability are. | HIGH |
| Test framework migration (Jest -> Vitest) now | Limited ROI for backend-focused milestone and adds migration noise during reliability work. | MEDIUM |

## Recommended Target Stack For Next Milestone

- **Runtime:** Node.js 24 LTS (transition matrix: 22 + 24)
- **Realtime:** Socket.IO 4.x (current major line), production multi-node rules documented and tested
- **Ephemeral coordination:** Redis (already in dependencies) as actively wired room-state backing path
- **Persistence:** PostgreSQL via existing `pg` store abstraction
- **Observability:** pino structured logs + stricter health/readiness + startup config validation
- **Testing:** Jest retained; add contract tests around room state sync and reconnect behavior

## Practical Upgrade Sequence (Low-Risk)

1. **Runtime uplift first**
   - Change Docker base image and CI matrix only.
   - Verify test suite and smoke health endpoint.
2. **Activate Redis registry path behind feature flag**
   - Keep default in-memory behavior for local/dev.
   - Enable Redis mode in staging and validate cross-instance room semantics.
3. **Harden operational contracts**
   - Config validation + readiness semantics + logging field consistency.
4. **Add JS type-checking (`checkJs`) for critical modules**
   - Start with room registry and socket handlers, then expand.

## Source-Backed Notes

- Node release schedule indicates Node 24.x is Active LTS and 20/22 are in later lifecycle stages in 2026.
- Socket.IO documentation for multi-node deployment emphasizes sticky sessions and adapter strategy.
- TypeScript docs confirm `allowJs`/`checkJs` as an incremental path for JS codebases without full migration.

## Sources

- Node.js Release WG schedule: https://github.com/nodejs/Release (HIGH)
- Node.js release overview: https://nodejs.org/en/about/releases/ (HIGH)
- Socket.IO multi-node guide: https://socket.io/docs/v4/using-multiple-nodes/ (HIGH)
- Socket.IO Redis adapter docs: https://socket.io/docs/v4/redis-adapter/ (HIGH)
- Socket.IO Redis Streams adapter docs: https://socket.io/docs/v4/redis-streams-adapter/ (HIGH)
- TypeScript `allowJs`: https://www.typescriptlang.org/tsconfig/allowJs.html (HIGH)
- TypeScript `checkJs`: https://www.typescriptlang.org/tsconfig/checkJs.html (HIGH)



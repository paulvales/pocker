# Operations Baseline

## Secrets and environments

- Keep real secrets only in local `.env` files or deployment environment variables.
- Do not commit real `DATABASE_URL`, YouTrack tokens, invite secrets, or future auth credentials.
- `.env` is already gitignored; `.env.example` stays as the only committed template.

## Structured logging

- The server emits structured JSON logs through `createAppLogger`.
- Sensitive fields are redacted when their key matches `token`, `authorization`, `cookie`, `secret`, or `password`.
- Log level is controlled by `POCKER_LOG_LEVEL`.
- Service identity is controlled by `POCKER_SERVICE_NAME`.

## Error monitoring hook

- `createServerApp` accepts an `onError` hook.
- All unexpected HTTP and Socket.IO failures flow through `errorMonitor.capture(...)`.
- The hook receives `{ error, context, capturedAt }`, which makes it safe to forward into Sentry, Datadog, or another monitoring sink without coupling the app to a specific vendor today.

## Audit trail

- Administrative room mutations append audit records into PostgreSQL table `audit_log_events`.
- Current baseline records room creation plus admin state changes such as note updates, task list changes, estimation mode switches, reveal/reset actions, and story point pushes.
- Audit rows include actor, workspace, room, outcome, and metadata for later review.

## Rate limiting and abuse protection

- Socket mutations are protected by in-memory fixed-window rate limiting.
- Baseline scopes cover room creation, joins, admin mutations, votes, and reactions.
- Limits are keyed by actor identity when available, otherwise by forwarded IP or socket address.
- Runtime configuration:
  - `POCKER_RATE_LIMIT_CREATE_ROOM`
  - `POCKER_RATE_LIMIT_CREATE_ROOM_WINDOW_MS`
  - `POCKER_RATE_LIMIT_JOIN`
  - `POCKER_RATE_LIMIT_JOIN_WINDOW_MS`
  - `POCKER_RATE_LIMIT_MUTATION`
  - `POCKER_RATE_LIMIT_MUTATION_WINDOW_MS`
  - `POCKER_RATE_LIMIT_VOTE`
  - `POCKER_RATE_LIMIT_VOTE_WINDOW_MS`
  - `POCKER_RATE_LIMIT_REACTION`
  - `POCKER_RATE_LIMIT_REACTION_WINDOW_MS`

## Security baseline

- HTTP responses now set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and `Cache-Control: no-store`.
- Guest access, invite checks, and admin-seat restrictions remain server-side decisions in the SaaS foundation layer.
- Frontend clients should treat these controls as authoritative server policy, not as UI-only checks.

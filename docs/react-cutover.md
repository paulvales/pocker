# React Cutover

## Canonical frontend

- The server now treats `apps/web/dist/index.html` as the primary application entry.
- `/`, `/history/`, `/settings/`, and valid `/:roomSlug/` routes all render the React shell.
- Legacy HTML endpoints are kept only as redirects:
  - `/index.html` -> `/`
  - `/history.html` -> `/history/`

## Compatibility

- Existing room slug links remain valid.
- Single-segment room links without a trailing slash still redirect to the canonical `/:roomSlug/` form.
- Health, version, API, and Socket.IO routes remain server-owned and do not fall through to the frontend shell.

## Regression baseline

- Server regression suite must confirm:
  - React entry is served by default
  - Canonical redirects still work
  - Room slug routing is preserved
  - History and settings APIs still respond correctly
- Web regression suite must confirm:
  - Home, history, and settings pages render successfully in the React shell
  - Critical room flow keeps working through the React routing layer

## Legacy removal

- Root `index.html` and `history.html` are no longer part of the runtime path.
- Rollback is a code rollback, not a runtime fallback toggle.

# Pocker

## Overview

Pocker is a Scrum Poker application with:

- Node.js backend in `apps/server`
- React frontend in `apps/web`
- Socket.IO realtime room flow
- PostgreSQL persistence for estimate history, audit log, and durable room runtime

The default frontend mode is `react`. The visible UI keeps legacy Fomantic parity, but the runtime is now React.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- PostgreSQL for local or server runtime

## First-Time Setup

Install dependencies:

```sh
npm install
```

Create the env file:

```sh
cp .env.example .env
```

Set at least `DATABASE_URL`. Example for a local PostgreSQL instance:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pocker?sslmode=disable
POCKER_FRONTEND_MODE=react
```

`POCKER_FRONTEND_MODE` supports:

- `react` - default mode, expected for local work and server deployments
- `legacy` - fallback/debug mode only

## Local Development

Use two terminals.

```sh
npm start
```

This starts the backend on `http://localhost:3000`.

In another terminal:

```sh
npm run web:dev
```

This starts Vite on `http://localhost:5173`.
Open `http://localhost:5173`.

Notes:

- Vite proxies `/api` and `/socket.io` to `localhost:3000`
- this is the main local workflow while changing frontend code
- backend still needs `DATABASE_URL`, but frontend tests do not

## Local Production-Like Run

If you want to run the app the same way the server serves it in `react` mode, build the frontend first:

```sh
npm run web:build
npm start
```

Open `http://localhost:3000`.

Important:

- in `react` mode `npm start` serves `apps/web/dist/index.html`
- if `apps/web/dist` is missing, the root page will not render correctly
- this mode is useful for smoke-checking the packaged app before deployment

Health and version endpoints:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/version
```

## Automated Checks

Run all tests:

```sh
npm run test:all
```

Run only backend tests:

```sh
npm test
```

Run only frontend tests:

```sh
npm run web:test
```

Run frontend lint:

```sh
npm run web:lint
```

Run frontend typecheck:

```sh
npm run web:typecheck
```

The automated test suite does not require your local PostgreSQL instance:

- server tests use `pg-mem`
- frontend tests use `vitest` + `jsdom`

## Test Server / Staging

For a test server, use the Docker image / compose flow, not Vite.

Prepare `.env` on the server:

```sh
cp .env.example .env
```

At minimum set:

```env
DATABASE_URL=postgres://user:password@host:port/pocker?sslmode=require
APP_IMAGE=127.0.0.1:5000/pocker
APP_TAG=latest
APP_HOST=test.example.com
POCKER_FRONTEND_MODE=react
```

If you use the local registry flow on the server:

```sh
docker compose -f docker-compose.registry.yml up -d
./scripts/release-local-registry.sh
docker compose up -d
```

If you want the one-command update flow on the server:

```sh
bash ./scripts/server-deploy.sh
```

What this gives you on the test server:

- containerized app behind Traefik from `docker-compose.yml`
- app served by Node on internal port `3000`
- public routing via `APP_HOST`
- React frontend served from the built image, not from a dev server

## Operations Baseline

The server now ships with an operations baseline for SaaS hardening:

- structured JSON logging with secret redaction
- pluggable error monitoring via `createServerApp({ onError })`
- PostgreSQL-backed audit trail for administrative room actions
- socket rate limiting for room creation, joins, mutations, votes, and reactions
- default security headers on HTML, JSON, redirects, and plain-text responses

Environment knobs live in `.env.example`, including `POCKER_LOG_LEVEL`, `POCKER_SERVICE_NAME`, and the `POCKER_RATE_LIMIT_*` settings.
Operational conventions for secrets, monitoring hooks, audit coverage, and abuse protection are documented in [docs/operations-baseline.md](docs/operations-baseline.md).

## Dynamic Rooms

Rooms are created on demand from the UI.

Flow:

1. The creator enters a readable suffix such as `backend-sprint-42`
2. That suffix becomes the room ID itself
3. The browser updates the URL to `/backend-sprint-42/`
4. The creator copies that URL and sends it to the rest of the team

There is no preconfigured room list and no room password layer.

Isolation is enforced on the server:

- all votes, notes, task lists, and estimation mode state are stored per room
- admin-only actions are checked on the server, not only in the UI
- users enter a room only through its unique link

If a room with the same slug is already active, creation is rejected and the user should choose another slug.

If the room becomes empty and the server restarts, the same valid link can still be used again.
The room state will start empty, but the link format remains valid.

## Docker

A `Dockerfile` is provided to build a container image.

Build the image:

```sh
docker build -t pocker .
```

Run the container:

```sh
docker run -p 3000:3000 pocker
```

If you rebuild often during local work, use a fixed container name so Docker does not keep creating random new containers:

```sh
docker build -t pocker-local:dev .
docker rm -f pocker-local
docker run --name pocker-local -p 3000:3000 pocker-local:dev
```

## Local Docker Dev

For local Docker work, prefer the dedicated dev compose file instead of the production-oriented `docker-compose.yml`.

Start or rebuild the local container:

```sh
docker compose -f docker-compose.dev.yml up -d --build
```

Stop it:

```sh
docker compose -f docker-compose.dev.yml down
```

This file:

- builds from the local source tree
- uses a fixed container name `pocker-local`
- publishes `localhost:3000`
- does not require the external `web` network or local registry

For Windows, you can also use the helper script:

```bat
scripts\docker-local-rebuild.bat
```

## Docker Compose

Create your env file:

```sh
cp .env.example .env
```

Start or update the stack:

```sh
docker compose up -d --build
```

Stop the stack:

```sh
docker compose down
```

The compose setup includes:

- `restart: unless-stopped`
- container health checks via `GET /health`
- estimate history storage in PostgreSQL via `DATABASE_URL`
- optional YouTrack variables from `.env`
- app version exposure through the UI footer and `GET /version`
- Traefik labels for `pocker.webpaul.ru`
- external Docker network `web`

This compose file is oriented to the production server behind Traefik, so it uses `expose: 3000` instead of a direct host `ports` mapping.
The production app stack expects the image to come from a local Docker registry on the same server.

If the external Traefik network does not exist yet:

```sh
docker network create web
```

If the root domains should not be routed to this app, remove these labels from `docker-compose.yml`:

- `traefik.http.routers.webpaul-root.rule`
- `traefik.http.routers.webpaul-root.entrypoints`
- `traefik.http.routers.webpaul-root.tls.certresolver`
- `traefik.http.routers.webpaul-root.service`

## Local Registry For DockMon

If you want one-click updates in DockMon without publishing images outside the server, use a private local registry on the same host.

1. Start the local registry once:

```sh
docker compose -f docker-compose.registry.yml up -d
```

2. Configure Docker daemon to allow your local registry.

Example for a registry on `127.0.0.1:5000`:

```json
{
  "insecure-registries": ["127.0.0.1:5000"]
}
```

Usually this lives in `/etc/docker/daemon.json`, then restart Docker:

```sh
sudo systemctl restart docker
```

If DockMon itself runs in a container and cannot access `127.0.0.1:5000`, set `APP_IMAGE` in `.env` to the server IP or DNS name instead, for example `192.168.1.10:5000/pocker`, and use the same host:port in Docker's `insecure-registries`.

3. Set `.env`:

```sh
cp .env.example .env
```

Key values:

- `APP_IMAGE=127.0.0.1:5000/pocker`
- `APP_TAG=latest`

4. Start the application stack:

```sh
docker compose up -d
```

5. On every release, build and push into the local registry:

```sh
./scripts/release-local-registry.sh
```

Then DockMon can detect the new digest for `latest` and update the running app with its normal update button.

If you want a single server-side command without opening DockMon, use:

```sh
bash ./scripts/server-deploy.sh
```

That command will:

- pull the latest git changes with `git pull --ff-only`
- ensure the local registry is running
- build and push the new image into the local registry
- pull the updated image into the app stack
- recreate the `pocker` container

## Versioning

The app version is taken from `package.json` and shown in the footer.

Before a release, bump the version in git:

```sh
npm version patch
```

If your deployment tool supports Compose projects, point it to `docker-compose.yml` and use rebuild/redeploy. That is the simplest path to a one-click update flow.

Then on the server:

```sh
git pull
./scripts/release-local-registry.sh
```

Or, for the full one-command deployment on the server:

```sh
bash ./scripts/server-deploy.sh
```

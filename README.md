# Pocker

## Overview

Pocker is a small Socket.IO server used for a Scrum Poker planning tool. It runs on Node.js and exposes a WebSocket API for clients.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

## Getting Started

Install dependencies:

```sh
npm install
```

Run the server locally:

```sh
npm start
```

The server listens on `process.env.PORT` or `3000` by default.

Health and version endpoints:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/version
```

Run the unit tests:

```sh
npm test
```

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

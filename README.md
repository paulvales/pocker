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

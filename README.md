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

If the external Traefik network does not exist yet:

```sh
docker network create web
```

If the root domains should not be routed to this app, remove these labels from `docker-compose.yml`:

- `traefik.http.routers.webpaul-root.rule`
- `traefik.http.routers.webpaul-root.entrypoints`
- `traefik.http.routers.webpaul-root.tls.certresolver`
- `traefik.http.routers.webpaul-root.service`

## Versioning

The app version is taken from `package.json` and shown in the footer.

For a new release:

```sh
npm version patch
docker compose up -d --build
```

If your deployment tool supports Compose projects, point it to `docker-compose.yml` and use rebuild/redeploy. That is the simplest path to a one-click update flow.

For your server flow this becomes:

```sh
git pull
docker compose up -d --build
```

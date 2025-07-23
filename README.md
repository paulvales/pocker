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

Run tests (currently just a placeholder):

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

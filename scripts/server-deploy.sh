#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

echo "Pulling latest git changes"
git pull --ff-only

echo "Ensuring local registry is running"
docker compose -f docker-compose.registry.yml up -d

echo "Publishing app image to local registry"
sh ./scripts/release-local-registry.sh

echo "Pulling updated app image from local registry"
docker compose pull pocker

echo "Recreating app container"
docker compose up -d pocker

echo "Done."

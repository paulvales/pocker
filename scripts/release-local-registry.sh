#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

IMAGE="${APP_IMAGE:-127.0.0.1:5000/pocker}"
VERSION="${APP_VERSION:-$(node -p "require('./package.json').version")}"
BUILD="${APP_BUILD:-$(git rev-parse --short HEAD 2>/dev/null || printf 'manual')}"

echo "Building ${IMAGE}:${VERSION}"
docker build \
  --build-arg APP_VERSION="${VERSION}" \
  --build-arg APP_BUILD="${BUILD}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  .

echo "Pushing ${IMAGE}:${VERSION}"
docker push "${IMAGE}:${VERSION}"

echo "Pushing ${IMAGE}:latest"
docker push "${IMAGE}:latest"

echo "Done."
echo "Released tags:"
echo "  - ${IMAGE}:${VERSION}"
echo "  - ${IMAGE}:latest"

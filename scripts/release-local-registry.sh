#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"

read_env_value() {
  key="$1"
  file="${2:-.env}"

  [ -f "$file" ] || return 1

  value=$(sed -n "s/^${key}=//p" "$file" | tail -n 1)
  [ -n "$value" ] || return 1

  case "$value" in
    \"*\")
      value=${value#\"}
      value=${value%\"}
      ;;
    \'*\')
      value=${value#\'}
      value=${value%\'}
      ;;
  esac

  printf '%s\n' "$value"
}

ENV_APP_IMAGE=$(read_env_value APP_IMAGE .env || true)
ENV_APP_VERSION=$(read_env_value APP_VERSION .env || true)
ENV_APP_BUILD=$(read_env_value APP_BUILD .env || true)

IMAGE="${APP_IMAGE:-${ENV_APP_IMAGE:-127.0.0.1:5000/pocker}}"
VERSION="${APP_VERSION:-${ENV_APP_VERSION:-$(node -p "require('./package.json').version")}}"
BUILD="${APP_BUILD:-${ENV_APP_BUILD:-$(git rev-parse --short HEAD 2>/dev/null || printf 'manual')}}"

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

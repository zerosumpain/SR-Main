#!/usr/bin/env bash
# Build and activate the Docker-based Webframe sidecar around the atomic web
# release. `prepare` installs configuration, creates the shared credential, and
# builds without changing the running container. `activate` swaps it only after
# the matching web application is live.
set -euo pipefail

MODE="${1:-}"
VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
ENV_FILE="$VPS_DIR/.env"
COMPOSE_FILE="$VPS_DIR/docker-compose.webframe.yml"

case "$MODE" in prepare|activate) ;; *) echo "usage: $0 prepare|activate" >&2; exit 2 ;; esac

if [ "$MODE" = prepare ]; then
  echo "==> Preparing hardened Webframe sidecar..."
  install -d -m 755 "$VPS_DIR/services/webframe"
  rsync -a --delete --delete-excluded \
    --include='/.dockerignore' \
    --include='/Dockerfile' \
    --include='/package.json' \
    --include='/package-lock.json' \
    --include='/server.ts' \
    --include='/tsconfig.json' \
    --include='/seccomp_profile.json' \
    --exclude='*' \
    services/webframe/ "$VPS_DIR/services/webframe/"
  install -m 644 docker-compose.webframe.yml "$COMPOSE_FILE"

  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if ! grep -Eq '^WEBFRAME_SERVICE_TOKEN=.+$' "$ENV_FILE"; then
    # Never print this credential: it authorises browser control and extraction.
    sed -i '/^WEBFRAME_SERVICE_TOKEN=$/d' "$ENV_FILE"
    token="$(openssl rand -hex 32)"
    printf '\nWEBFRAME_SERVICE_TOKEN=%s\n' "$token" >> "$ENV_FILE"
    unset token
  fi
  if ! grep -Eq '^WEBFRAME_SERVICE_URL=.+$' "$ENV_FILE"; then
    sed -i '/^WEBFRAME_SERVICE_URL=$/d' "$ENV_FILE"
    printf 'WEBFRAME_SERVICE_URL=http://127.0.0.1:3303\n' >> "$ENV_FILE"
  fi

  (cd "$VPS_DIR" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build webframe)
  echo "==> Webframe image prepared; running container unchanged."
  exit 0
fi

echo "==> Activating hardened Webframe sidecar..."
(cd "$VPS_DIR" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build webframe)
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3303/health | grep -q '"ok":true'; then
    echo "==> Webframe healthy."
    exit 0
  fi
  sleep 1
done
docker logs --tail 50 webframe >&2 || true
echo "==> ERROR: Webframe did not become healthy." >&2
exit 1

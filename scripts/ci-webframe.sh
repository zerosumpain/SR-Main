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

  sudo touch "$ENV_FILE"
  sudo chmod 600 "$ENV_FILE"
  if ! sudo grep -Eq '^WEBFRAME_SERVICE_TOKEN=.+$' "$ENV_FILE"; then
    # Never print this credential: it authorises browser control and extraction.
    sudo sed -i '/^WEBFRAME_SERVICE_TOKEN=$/d' "$ENV_FILE"
    token="$(openssl rand -hex 32)"
    printf '\nWEBFRAME_SERVICE_TOKEN=%s\n' "$token" | sudo tee -a "$ENV_FILE" >/dev/null
    unset token
  fi
  if ! sudo grep -Eq '^WEBFRAME_SERVICE_URL=.+$' "$ENV_FILE"; then
    sudo sed -i '/^WEBFRAME_SERVICE_URL=$/d' "$ENV_FILE"
    printf 'WEBFRAME_SERVICE_URL=http://127.0.0.1:3303\n' | sudo tee -a "$ENV_FILE" >/dev/null
  fi

  (cd "$VPS_DIR" && sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build webframe)
  echo "==> Webframe image prepared; running container unchanged."
  exit 0
fi

echo "==> Activating hardened Webframe sidecar..."
(cd "$VPS_DIR" && sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build webframe)
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3303/health | grep -q '"ok":true'; then
    echo "==> Webframe healthy."
    exit 0
  fi
  sleep 1
done
sudo docker logs --tail 50 webframe >&2 || true
echo "==> ERROR: Webframe did not become healthy." >&2
exit 1

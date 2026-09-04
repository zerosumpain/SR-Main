#!/usr/bin/env bash
# Build and activate the Docker-based Webframe sidecar around the atomic web
# release. `prepare` installs configuration, creates the shared credential, and
# builds without changing the running container. `activate` swaps it only after
# the matching web application is live.
set -euo pipefail

MODE="${1:-}"
VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SERVICE="${SERVICE:-strange-rambling-svelte}"
WEBFRAME_ENV_FILE="$VPS_DIR/.webframe.env"
COMPOSE_FILE="$VPS_DIR/docker-compose.webframe.yml"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_DROPIN_DIR="$SYSTEMD_DIR/$SERVICE.service.d"
SERVICE_DROPIN="$SERVICE_DROPIN_DIR/20-security-env.conf"

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

  # The runner deliberately sees the application's main .env through a
  # read-only mount. Keep that incident guard intact: Webframe gets a separate,
  # root-owned file shared only with Docker Compose and the app's systemd unit.
  if ! sudo grep -Eq '^WEBFRAME_SERVICE_TOKEN=.+$' "$WEBFRAME_ENV_FILE" 2>/dev/null; then
    webframe_tmp="$(sudo mktemp "$VPS_DIR/.webframe.env.tmp.XXXXXX")"
    trap 'sudo rm -f "${webframe_tmp:-}"' EXIT
    token="$(openssl rand -hex 32)"
    {
      printf 'WEBFRAME_SERVICE_TOKEN=%s\n' "$token"
      printf 'WEBFRAME_SERVICE_URL=http://127.0.0.1:3303\n'
    } | sudo tee "$webframe_tmp" >/dev/null
    sudo chown root:root "$webframe_tmp"
    sudo chmod 600 "$webframe_tmp"
    sudo mv -f "$webframe_tmp" "$WEBFRAME_ENV_FILE"
    webframe_tmp=""
    trap - EXIT
    unset token
  fi
  if ! sudo grep -Eq '^WEBFRAME_SERVICE_URL=.+$' "$WEBFRAME_ENV_FILE"; then
    printf 'WEBFRAME_SERVICE_URL=http://127.0.0.1:3303\n' | sudo tee -a "$WEBFRAME_ENV_FILE" >/dev/null
  fi
  sudo chown root:root "$WEBFRAME_ENV_FILE"
  sudo chmod 600 "$WEBFRAME_ENV_FILE"

  # Loaded on the next app restart, after its historical EnvironmentFile. The
  # final directive strips AUTH_BYPASS even if the immutable legacy file still
  # contains it; current application code ignores it as a second layer.
  sudo install -d -m 755 "$SERVICE_DROPIN_DIR"
  {
    printf '[Service]\n'
    printf 'EnvironmentFile=-%s\n' "$WEBFRAME_ENV_FILE"
    printf 'UnsetEnvironment=AUTH_BYPASS\n'
  } | sudo tee "$SERVICE_DROPIN" >/dev/null
  sudo chmod 644 "$SERVICE_DROPIN"
  sudo systemctl daemon-reload

  (cd "$VPS_DIR" && sudo docker compose --env-file "$WEBFRAME_ENV_FILE" -f "$COMPOSE_FILE" build webframe)
  echo "==> Webframe image prepared; running container unchanged."
  exit 0
fi

echo "==> Activating hardened Webframe sidecar..."
(cd "$VPS_DIR" && sudo docker compose --env-file "$WEBFRAME_ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build webframe)
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

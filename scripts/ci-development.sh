#!/usr/bin/env bash
# Provision only the trusted workspace service. Production .env and data stay intact.
set -euo pipefail
ROOT=/opt/sr-development
SHA="$(git rev-parse HEAD)"
SOURCE="$ROOT/sources/$SHA"
[ "$(id -u johnk)" = 1000 ] || { echo 'Preview workspace ownership requires the configured johnk uid 1000'; exit 1; }
sudo install -d -m 755 "$ROOT" /etc/strange-ramblings
sudo install -d -m 755 -o johnk -g johnk "$ROOT/sources"
if [ ! -f "$SOURCE/node_modules/.sr-dependencies-ready" ]; then
  mkdir -p "$SOURCE"
  git archive HEAD | tar -x -C "$SOURCE"
  # No production environment or credentials reach package lifecycle commands.
  (cd "$SOURCE" && env -i PATH="$PATH" HOME="$HOME" PUBLIC_VAPID_PUBLIC_KEY='' npm ci --no-audit --no-fund)
  touch "$SOURCE/node_modules/.sr-dependencies-ready"
fi
sudo python3 - "$ROOT" "$SOURCE" "$SHA" <<'PY'
from pathlib import Path
import os, secrets, sys
root, source, sha = sys.argv[1:]
config = Path(root, 'compose.env')
old = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line) if config.exists() else {}
token = old.get('BUILDER_WORKSPACE_BROKER_TOKEN') or secrets.token_hex(32)
access = old.get('BUILDER_PREVIEW_ACCESS_SECRET') or secrets.token_hex(32)
values = {'DEVELOPMENT_SOURCE_ROOT': source, 'DEVELOPMENT_IMAGE_REVISION': sha,
          'BUILDER_WORKSPACE_BROKER_TOKEN': token, 'BUILDER_PREVIEW_ACCESS_SECRET': access}
for path, text in [(config, ''.join(f'{k}={v}\n' for k,v in values.items())),
                   (Path('/etc/strange-ramblings/development.env'), f'BUILDER_WORKSPACE_BROKER_URL=http://127.0.0.1:5280\nBUILDER_WORKSPACE_BROKER_TOKEN={token}\n')]:
    temp = path.with_suffix('.partial')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(text)
    os.chmod(temp, 0o600)
    temp.replace(path)
PY
sudo install -m 644 deploy/development/compose.yaml "$ROOT/compose.yaml"
compose=(sudo docker compose --env-file "$ROOT/compose.env" -f "$ROOT/compose.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" build broker
# Replacing the broker while a worker is building can strand its in-flight
# checkpoint. Check live database state immediately before changing containers.
#
# The check alone stopped being enough once unattended runs existed: it is a
# point-in-time read, and autopilot's sweep can start a build in the seconds
# between it passing and the containers being replaced. So take a hold first —
# the sweep looks for this file and stays its hand while it is there — and drop
# it however this script exits.
HOLD=/opt/sr-development/deploy-hold
sudo install -d -m 755 /opt/sr-development
sudo touch "$HOLD"
trap 'sudo rm -f "$HOLD"' EXIT
sudo bash -s -- "$SOURCE" <<'IDLE'
set -euo pipefail
set -a
. /opt/strange-rambling-svelte/.env
set +a
node "$1/scripts/ci-development-idle.mjs"
IDLE
"${compose[@]}" up -d --wait --wait-timeout 180
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5280/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:5280/health >/dev/null
# Prime images while the trusted daemon has network access; candidates never do.
"${compose[@]}" exec -T broker docker pull pgvector/pgvector:pg16 >/dev/null
for service in strange-rambling-svelte jkai-builder; do
  sudo install -d -m 755 "/etc/systemd/system/$service.service.d"
  sudo tee "/etc/systemd/system/$service.service.d/30-development.conf" >/dev/null <<'UNIT'
[Service]
EnvironmentFile=/etc/strange-ramblings/development.env
InaccessiblePaths=-/etc/strange-ramblings/development.env -/opt/sr-development/compose.env
UNIT
done
sudo systemctl daemon-reload

# Add only the dedicated preview hostnames to the existing locally-managed tunnel.
if ! python3 -c 'import yaml' 2>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends python3-yaml
fi
TUNNEL="$(sudo python3 -c 'import yaml; print(yaml.safe_load(open("/etc/cloudflared/config.yml"))["tunnel"])')"
for port in $(seq 5281 5288); do
  stamp="$ROOT/dns-$TUNNEL-$port"
  if ! sudo test -f "$stamp"; then
    sudo -u johnk env HOME=/home/johnk cloudflared tunnel route dns "$TUNNEL" "preview-$port.strangeramblings.com"
    sudo touch "$stamp"
  fi
done
sudo python3 - "$ROOT" "$SHA" <<'PY'
from pathlib import Path
import sys, yaml, shutil
root, sha = sys.argv[1:]
path = Path('/etc/cloudflared/config.yml')
config = yaml.safe_load(path.read_text())
rules = config['ingress']
changed = False
for port in range(5281, 5289):
    hostname = f'preview-{port}.strangeramblings.com'
    existing = next((rule for rule in rules if rule.get('hostname') == hostname), None)
    if existing:
        if existing.get('service') != 'http://127.0.0.1:5289': raise RuntimeError(f'{hostname} already has a different destination')
    else:
        rules.insert(len(rules)-1, {'hostname': hostname, 'service': 'http://127.0.0.1:5289', 'originRequest': {'httpHostHeader': hostname}})
        changed = True
if changed:
    backup = Path(root, f'cloudflared-before-{sha}.yml')
    shutil.copy2(path, backup)
    path.with_suffix('.development-partial').write_text(yaml.safe_dump(config, sort_keys=False))
    Path(root, 'tunnel-change-pending').write_text(str(backup))
PY
if sudo test -f "$ROOT/tunnel-change-pending"; then
  candidate=/etc/cloudflared/config.development-partial
  sudo cloudflared tunnel --config "$candidate" ingress validate
  sudo mv "$candidate" /etc/cloudflared/config.yml
  if ! sudo systemctl restart cloudflared || ! sudo systemctl is-active --quiet cloudflared; then
    backup="$(sudo cat "$ROOT/tunnel-change-pending")"
    sudo cp "$backup" /etc/cloudflared/config.yml
    sudo systemctl restart cloudflared
    exit 1
  fi
  sudo rm "$ROOT/tunnel-change-pending"
fi
for port in $(seq 5281 5288); do
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: preview-$port.strangeramblings.com" http://127.0.0.1:5289/)"
  [ "$status" = 401 ] || { echo "Preview $port did not deny an anonymous request"; exit 1; }
done
echo 'Development broker and protected preview ingress ready; builder activates when idle.'

# Run the expensive isolated-site proof when the preview runtime changes.
RUNTIME_HASH="$(sha256sum scripts/development-*.mjs scripts/development-seccomp.json scripts/local-preview-*.mjs deploy/development/* package-lock.json | sha256sum | cut -d' ' -f1)"
if [ "$(sudo cat "$ROOT/verified-runtime.sha256" 2>/dev/null || true)" != "$RUNTIME_HASH" ]; then
  "${compose[@]}" exec -T broker node /source/scripts/qa/production-development-preview.mjs "$SHA"
  printf '%s\n' "$RUNTIME_HASH" | sudo tee "$ROOT/verified-runtime.sha256" >/dev/null
fi

"${compose[@]}" exec -T broker node --input-type=module <<'PREFLIGHT'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const response = await fetch('http://127.0.0.1:5280/preflight', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}` },
  body: JSON.stringify({ buildId: randomUUID() }), signal: AbortSignal.timeout(115000),
});
const result = await response.json();
assert.ok(response.ok && result.ready, result.error ?? 'Executor preflight failed');
console.log('Production development executor preflight passed.');
PREFLIGHT

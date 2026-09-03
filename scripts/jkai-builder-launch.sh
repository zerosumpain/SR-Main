#!/usr/bin/env bash
# Launch the trusted orchestrator with only the credentials it actually needs.
# Agent/build commands receive a second, non-secret environment allowlist in
# sandbox.ts and pi-runner.ts.
set -euo pipefail

# The service manager loads .env before applying InaccessiblePaths. Do not read
# it here: the file is deliberately absent from this process's mount namespace.
# The final `env -i` below drops every value not named in `allowed`.

keep=(
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  "HOME=/home/johnk"
  "LANG=${LANG:-C.UTF-8}"
  "NODE_ENV=production"
  "NPM_CONFIG_CACHE=/var/cache/jkai-builder/npm"
)

# This list is intentionally explicit. Authentication cookies, OAuth client
# secrets, mail credentials, Home Assistant tokens, WebDAV credentials and
# unrelated integration keys must never enter the builder process.
allowed=(
  DATABASE_URL BUILDER_GATE_DATABASE_URL
  OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_API_KEY GEMINI_API_KEY
  FORGE_GITHUB_TOKEN JKAI_BRIDGE_SECRET
  JKAI_BUILDER_SOCKET JKAI_BUILDS_ROOT JKAI_BUILDS_HOSTMODE JKAI_BUILDER_PROCESS
  JKAI_API_URL PUBLIC_SITE_URL CODEGRAPH_PRECEDENT CODEGRAPH_PUSH
  AZURE_STORAGE_CONNECTION_STRING AZURE_MEDIA_CONTAINER JKAI_MEDIA_ROOT
  JKAI_IMAGE_LIMIT_PER_DAY JKAI_IMAGE_MODEL JKAI_TTS_CHAR_LIMIT_PER_DAY
  JKAI_TTS_MODEL JKAI_TTS_VOICE ELEVENLABS_API_KEY
  LOCAL_AI_PYTHON LOCAL_STT_MODEL LOCAL_STT_TIMEOUT_MS
  LOCAL_TTS_TIMEOUT_MS LOCAL_TTS_VOICE
  SCRAPER_SERVICE_URL SCRAPER_SERVICE_TOKEN MCP_CONFIRM_UNATTENDED
)

for name in "${allowed[@]}"; do
  if [ -n "${!name:-}" ]; then keep+=("$name=${!name}"); fi
done

exec env -i "${keep[@]}" \
  /usr/bin/node /opt/strange-rambling-svelte/packages/jkai-builder/dist/start.js

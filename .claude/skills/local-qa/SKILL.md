---
name: local-qa
description: Use when running strange_rambling_svelte locally — starting a dev server, running checks/builds/tests, headless Playwright QA against the prod build, setting up a git worktree, or applying DB schema changes locally. Also on symptoms: check/build heap OOM, "Could not resolve entry module .svelte-kit/adapter-node", SCRAM/SASL password errors, "column X does not exist" at boot.
---

# Local dev / QA — strange_rambling_svelte

Environment gotchas that otherwise cost debugging time. Do these up front.

## Checks, builds, tests

- `npm run check` AND `npm run build` OOM at the default Node heap. Always prefix: `NODE_OPTIONS=--max-old-space-size=8192`.
- `npm run build` **fails under the Bash sandbox** — the adapter-node packaging step dies with `RollupError: Could not resolve entry module ".svelte-kit/adapter-node/index.js"` (sandbox drops the adapter's fs copy). A clean rebuild does NOT fix it. Run builds with the sandbox disabled.
- After ANY local build, restart the always-on proxy service (its in-memory manifest points at old chunk hashes → scraper endpoints 500): `systemctl --user restart strange-rambling-svelte`. (The CI deploy restarts the VPS service itself; a local build never does.)
- Unit tests: `npm test` (vitest). One file: `npx vitest run tests/lib/workflows/registry-parity.test.ts` (any path works). E2E: `npm run test:e2e` (Playwright 1.60 + chromium installed at `~/.cache/ms-playwright`).

## Dev server

- Port 5173 is held by the always-on `strange-rambling-svelte.service`, so `npm run dev` lands on **5174**. Give John URLs as `http://homeserv:<port>` (he's on the same LAN).

## Running the PROD build locally (headless QA)

```bash
PORT=<p> node --env-file=.env build/index.js
```
- `--env-file` is mandatory — adapter-node doesn't load `.env`, so without it boot crashes with `SASL: client password must be a string`.
- Start it with the shell tool's `run_in_background: true` (a `(cmd &)` subshell gets killed by the sandbox). Stop with the **TaskStop** tool — `pkill`/`ss` exit 144 here.
- The local DB has `policy-engine` public, so anonymous curl/Playwright works locally even where prod is private.

## Git worktrees

Fresh worktrees are missing gitignored secrets. Immediately after `git worktree add`, copy from the main checkout:
```bash
cp ~/strange_rambling_svelte/.env ~/strange_rambling_svelte/keys.json <worktree>/
```
(Without `.env`: DB tests fail with SCRAM password errors. Without `keys.json`: "Z.AI API key not configured".)

## Inspecting the databases

- **Local** (homeserv, port 5433): `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"` — or browse via pgweb at `http://homeserv:8085/pgweb/`.
- **Prod** (VPS — no psql on host, use the docker container):
  ```bash
  ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
    'docker exec $(docker ps --filter name=strange-rambling-app-db --format "{{.Names}}" | head -1) psql -U app -d strange_rambling -c "SELECT 1;"'
  ```
  Read-only queries only unless the task explicitly requires writes; dump first before any destructive statement.

## Schema changes need a LOCAL push too

homeserv has its own Postgres (`localhost:5433`), separate from prod. CI pushes the schema to PROD only (inside `scripts/ci-deploy.sh`). After editing `src/lib/db/schema.ts`, also run:
```bash
CI=1 DATABASE_URL=<value from .env> npx drizzle-kit push --config=drizzle.config.ts --force
```
Skipping this breaks the local boot-migration (`column "X" does not exist`) and the always-on service on restart.

---
name: local-qa
description: Use when running strange_rambling_svelte locally — starting a dev server, running checks/builds/tests, headless Playwright QA against the prod build, setting up a git worktree, or applying DB schema changes locally. Also on symptoms: check/build heap OOM, "Could not resolve entry module .svelte-kit/adapter-node", SCRAM/SASL password errors, "column X does not exist" at boot.
---

# Local dev / QA — strange_rambling_svelte

Environment gotchas that otherwise cost debugging time. Do these up front.

## Checks, builds, tests

### Run the gate on porkserv, not here

`./scripts/gate-remote.sh` (add `--build` for a real adapter-node build). It rsyncs the
tree you are standing in — uncommitted changes included — to porkserv and runs
`gate-concurrent.sh` there.

**Prefer this to running the gate locally.** `gate:check:only` asks for an 8GB heap and
`gate:build` for 6GB, on a homeserv with 7.6GB of RAM in total; earlyoom kills node here
routinely. porkserv has 62GB and four real cores, so both halves run full-size at once.
It is not faster per core — it just finishes, and it leaves the dev box alone while it does.

- The worktree needs **no `node_modules`** — the install happens on porkserv.
- Always runs the **whole** suite (no `.git` is shipped, so `GATE_LEVEL` is never L2).
- Its Postgres is a disposable pgvector container on porkserv, loopback-bound, with the
  schema pushed automatically when `schema.ts` changes. Set up by `~/porkserv/gate.yml`.
- Runs are serialised by `flock`; a second one queues rather than failing.
- This does **not** replace CI, and `gate` must stay on GitHub-hosted runners — SR-Main
  is public and a self-hosted runner taking fork PRs would execute strangers' code.


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

## The `sr-vps` ssh alias (set this up on a fresh box)

The runbooks in this repo say `ssh sr-vps`, never the origin IP. SR-Main is a
PUBLIC repo and the VPS sits behind a cloudflared tunnel, so putting the origin
host, ssh user and key path in a tracked file would undo the one thing the
tunnel is for. Add this to `~/.ssh/config` (values from the password manager or
the Hetzner console):

```
Host sr-vps
  HostName <origin ip>
  User <user>
  IdentityFile ~/.ssh/id_ed25519
```

Verify with `ssh sr-vps hostname` — it answers `strangeserv`.

## Inspecting the databases

- **Local** (homeserv, port 5433): `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"` — or browse via pgweb at `http://homeserv:8085/pgweb/`.
- **Prod** (VPS — no psql on host, use the docker container):
  ```bash
  ssh sr-vps \
    'docker exec $(docker ps --filter name=strange-rambling-app-db --format "{{.Names}}" | head -1) psql -U app -d strange_rambling -c "SELECT 1;"'
  ```
  Read-only queries only unless the task explicitly requires writes; dump first before any destructive statement.

## Schema changes need a LOCAL push too

homeserv has its own Postgres (`localhost:5433`), separate from prod. CI pushes the schema to PROD only (inside `scripts/ci-deploy.sh`). After editing `src/lib/db/schema.ts`, also run:
```bash
CI=1 DATABASE_URL=<value from .env> npx drizzle-kit push --config=drizzle.config.ts --force
```
Skipping this breaks the local boot-migration (`column "X" does not exist`) and the always-on service on restart.

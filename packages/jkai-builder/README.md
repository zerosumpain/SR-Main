# jkai-builder

Sidecar service that owns the JKAI build orchestrator loop, separated from the
SvelteKit web app so deploys of `strange-rambling-svelte` don't kill in-flight
builds. See [`docs/plans/jkai-build-rewrite.md`](../../docs/plans/jkai-build-rewrite.md)
for the full architecture and phasing.

## Phase 1 — current state

This phase is **infrastructure-only**. The service:

- Binds a Unix domain socket at `$XDG_RUNTIME_DIR/jkai-builder.sock` (typically
  `/run/user/1000/jkai-builder.sock`) — no port collision, file-perm ACL.
- Exposes `GET /health` over the socket. Returns `{ ok, activeBuilds, pid, startedAt, uptimeMs }`.
- Runs alongside the SvelteKit app for now — both processes register the
  orchestrator. Phase 2 moves authoritative state here and removes the
  in-process orchestrator from SvelteKit.

## Build + run

The TypeScript entry compiles to `dist/start.js` via esbuild during
`npm run build:builder` (added to root `package.json`).

```bash
# from repo root
npm run build:builder
# then
node packages/jkai-builder/dist/start.js
```

In production, a systemd user service at
`~/.config/systemd/user/jkai-builder.service` runs the dist artifact under
`Restart=always` with linger enabled.

## Probing

```bash
curl --unix-socket /run/user/$(id -u)/jkai-builder.sock http://x/health
# -> {"ok":true,"activeBuilds":0,"pid":12345,"startedAt":"...","uptimeMs":...}
```

## Why a separate package?

A SvelteKit deploy restarts the web process. With the orchestrator in-process,
that meant every deploy killed every running build. The builder runs as its
own systemd unit; web restarts no longer affect it.

The full architectural rationale and the 8-phase migration plan live in
[`docs/plans/jkai-build-rewrite.md`](../../docs/plans/jkai-build-rewrite.md).

# jkai-run-worker (#19 durable run-worker)

Optional, **feature-flagged-off** out-of-process worker that executes workflow
runs from a DB-backed queue. With it enabled, a deploy/restart/OOM of the
SvelteKit web app no longer kills in-flight workflow runs — runs live in the DB
(`workflow_runs` + lease columns) and a separate worker process claims and runs
them.

## Feature flag

Everything is gated on `JKAI_RUN_WORKER`:

- **`JKAI_RUN_WORKER` unset / not `"1"` (DEFAULT):** in-process execution,
  identical to today. The worker, queue, and leader-election code are never
  touched.
- **`JKAI_RUN_WORKER=1`:** the run route + scheduler ENQUEUE runs (status
  `pending`) instead of executing them in-process, and this worker claims them.

## Schema

Adds three **nullable** columns to `workflow_runs`: `claimed_by`, `claimed_at`,
`lease_expires_at`. They are additive (existing rows/queries unaffected). Apply
them manually with `npx drizzle-kit push` — **not** auto-applied.

## Launch

```sh
# 1. Build the bundle (esbuild; aliases $env to the env-shim, like jkai-builder)
node packages/jkai-run-worker/build.mjs

# 2. Run the worker (separate process from the web app)
JKAI_RUN_WORKER=1 DATABASE_URL=postgres://... node packages/jkai-run-worker/dist/start.js
```

The entry sets `JKAI_BUILDER_PROCESS=1` internally so importing `$lib/workflows`
does **not** boot the web app's platform services (WhatsApp socket, scheduler,
reaper). The cron/scheduled lane runs under a pg advisory lock (leader election)
so crons never double-fire across the web + worker processes.

### Tuning (optional env)

- `JKAI_RUN_WORKER_POLL_MS` — queue poll interval (default 1000).
- `JKAI_RUN_WORKER_LEASE_MS` — claim lease duration (default 60000); renewed at
  ~1/3 of this while a run is in flight.
- `JKAI_RUN_WORKER_IN_WEB=1` — (advanced) also host the worker loop inside the
  web process. Off by default; the normal topology runs this package standalone.

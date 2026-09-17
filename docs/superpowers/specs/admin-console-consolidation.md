# /admin console consolidation

Status: in progress (started 2026-09-17)
Branch: `feat/admin-console-consolidation` (one PR per step, not one PR for all seven)

## Why

A 16-agent audit of the console (9 auditors, 4 designers, 3 critics; row counts measured
against production on 2026-09-17) found the console is not one console. It is:

- **5 parallel status systems** — `architecture/topology.ts`, `estate/endpoints.ts`,
  `estate/hosts.ts`, `dependencies/*`, `connectors/probes.ts` — each with its own probe
  implementation and its own definition of "up". `strangeramblings.com` is probed by all
  five with four incompatible definitions. Two of the six architecture-map tiles are string
  literals, so the map cannot go red about the app by construction.
- **7 credential stores** with 4 write paths and **3 independent AES-256-GCM
  implementations** under 3 different master keys. One "API Keys" form writes two stores
  through two endpoints under one Save button.
- **6 readings of `agent_actions.cost_usd`** with 3 definitions of "today" and 2 row
  filters. `/admin/ops/costs` already found and fixed the Node-clock-midnight bug; no other
  reader adopted the fix.
- **3 hand-written estate models**, the authoritative one in a different git repo
  (`~/sr-infra/registry/apps.json`), which SR-Main has never read. 24 of 30 production
  containers are invisible to every admin page.
- **6 activity vocabularies** with no key in common, and **no registry joining activity →
  repository → capability at all**.
- **2 complete logs of the same work** (`claude_sessions` + `claude_session_stages` vs
  `releases` + `release_items`) with no join key.

Full review: https://claude.ai/code/artifact/5bab1b51-82d7-4df0-8d36-834e5bea1fc6

## Measured facts this spec rests on

Queried live against the production database, 2026-09-17:

| Table | Rows |
|---|---|
| `agent_actions` | 33,647 (100% `action_type='llm_call'`) |
| `claude_session_stages` | 5,399 |
| `releases` | 1,130 |
| `claude_sessions` | 295 |
| `release_items` | **90** |
| `heartbeat_actions` | 69 |
| `api_secrets` | 8 |
| `daydream_capabilities` | 3 |
| `integration_credentials` | **0** |
| `agent_activity` | **0** |
| `agent_tasks` | **0** |

## The seven steps

Each step is independently deployable and independently useful. Order is deliberate: the
deletions come first because they make the architecture model smaller and truer to build
against, and step 2 must precede step 7 or the fold inherits a 92%-empty archive.

1. **Close the exposure, fix the defects.** Delete `/api/agent/*`; remove
   `static/jkai-architecture.html`; fix the WhatsApp `res.ok` read; add the ingest lock and
   incremental state write.
2. **Repair the release summariser.** An `ok`-with-zero-items release is unreachable by
   `summarisePending` forever, so 1,040 releases cannot self-heal.
3. **Retire the dead.** Tasks, Ops/Agent, AI/Config, the `?token=` plumbing,
   `integration_credentials` and its page.
4. **Three registries** — credentials, probes, spend — preceded by the Content audit the
   nine auditors did not run.
5. **The generated architecture model**, behind the existing page as a new tab first.
6. **Estate becomes Architecture** — the section, the views, the map repointed, the
   activity ↔ repository join.
7. **Fold the changelog into `/releases`** on pull-request number, with `releases.repo`.

## Decision Log

Every fork that would have been a question. Options considered → chosen → why →
reversibility.

### D1 — Direction of the estate/architecture fold
Options: (a) keep `/admin/estate`, 308 `/admin/ops/architecture` into it, relabel the
section "Architecture"; (b) mint `/admin/architecture/*` and 308 `/admin/estate` into it.
**Chosen: (a).** Both of the repo's completed folds moved *into* the address that already
existed (`/admin/files` → `/drive`, `/admin/ops/releases` → `/releases`). `HostStatusStrip`,
`estate.test.ts:140` and two rationale comments already point at `/admin/estate`. `label`
and `href` are independent fields on `AdminSection`, so the word can read "Architecture"
without moving the URL. Critically, two designers proposed opposite directions and their
redirect maps were mutually destructive — `resolveAdminRedirect` rewrites the suffix of any
prefix match, so shipping (b) would silently 308 every new `/admin/estate/*` page to a URL
nothing creates. Reversible: a redirect-map edit.

### D2 — `EXTRACTED_TRIGGERS` stays hand-declared
Options: (a) derive it from the registry's `queueTriggers`; (b) keep it hand-written and
*report* the mismatch. **Chosen: (b).** The derivation is not byte-identical — it yields
`['policy-analysis','health-sync']` against today's `['policy-analysis']`. The registry
records repo-level intent; the constant records "a worker is actually live and claiming".
Deriving one from the other stops Main's generic worker claiming `health-sync` rows while
no sr-health worker container exists to claim them — the queue would fill with no owner and
no error. The registry may propose; only a human edit changes the claim predicate.
Reversible, but the failure is silent, which is why it is not being taken.

### D3 — Probe-target lockfile placement
Options: (a) `static/probe-targets.json`; (b) `.github/monitored-urls.txt`.
**Chosen: (b).** `static/` is served before hooks run — that is exactly why
`static/jkai-architecture.html` answers 200 anonymously today. (a) would publish the
tailnet address list, internal ports and container names at a public URL with no gate.
Irreversible once indexed, so it is not being taken at all.

### D4 — `integration_credentials` is dropped, not kept empty
Options: (a) drop the table; (b) keep it empty as a migration target. **Chosen: (a).** 0
production rows; its 585-line page manages nothing; its one genuine consumer (the Mapbox
public token) is better served by a row in `api_secrets` with a public-value flag. Keeping
an empty table keeps its page, its probe branch and its canvas picker alive as things to
maintain. Reversible: the table is empty, so recreating it costs nothing.

### D5 — Schema changes are split across deploys, never paired
`drizzle-kit push` reads an added column plus a dropped column on the same table as a
**rename**, which needs a TTY CI does not have; `tablesFilter` filters tables, not columns.
So: add `pull_requests` and the indexes in one deploy, verify the schema actually moved,
and drop `claude_session*.ai_summary` in a separate later push with nothing else in it.
`scripts/claude-changelog/apply-schema.sql` is updated in the same PR as each half — the
"verified by grep" claim that it was unreferenced was false. Not reversible cheaply once CI
hangs, hence the split.

### D6 — Re-ingest safety precedes the schema-version bump
Bumping `SCHEMA_VERSION` invalidates all 180 transcripts (~1 GB of JSONL) at once. The
ingester is a sequential loop with no lock that writes its state file only at the end, on a
15-minute cron, on a box with an OOM history. A run that overruns starts a second copy and
the two clobber each other's state. So the `flock`, the per-POST state write and a
`--limit N` land as their own commit, verified on homeserv, **before** the constant moves.

### D7 — `releases.repo` lands now, extracted repos post later
Options: (a) SR-Main only; (b) add the column now, defaulting to `zerosumpain/SR-Main`;
(c) column plus the five-line POST in all seven extracted repos' `release.yml`.
**Chosen: (b).** One column plus one index; all 1,130 existing rows stay correct on the
default; extracted apps honestly report "no releases recorded" until their CI posts. (c)
touches seven repos' CI in a workstream that is already large. Reversible and additive.

### D8 — The API-call layer gets its own build-time feed
The first draft declared a `calls` edge kind that no feed produced, so the model could list
66 endpoints and 35 pages and never say which page calls which — the precise join the brief
means by "api paths, backend". A fetch is a string, so the import graph and the boundary
gate are both blind to it. A build-time scan for `/api/...` string literals, resolved
against the route manifest, emits `calls` edges with an `unresolved` list rendered as a
finding rather than hidden. Same doctrine as `vite-plugins/route-manifest.mjs`: it travels
inside the build that serves it.

### D9 — The scheduler drift test is scoped to `src/lib/**`, not `hooks.server.ts`
The first draft grepped `hooks.server.ts` alone, which holds **1** of ~26 scheduler call
sites, so it would have passed green forever while the declaration rotted exactly as
`topology.ts` did. A guard that cannot fail is worse than no guard: it reads as coverage.

### D10 — Every deletion is checked against string call sites, not the import graph
`/api/agent/*` needs three coordinated edits in one commit (the `UNTRUSTED_CALL_SITES`
entry, the `CANARIES` entry in `check-public-routes.mjs`, and the `PUBLIC_PATHS` line) or
the gate goes red on a file that no longer exists. `/admin/ops/architecture` is cited by
name on the **public** `/projects/engine-room` study and by the screenshot capture script,
neither of which 404s — so a move there fails silently, with the public page naming a dead
path and the next capture shooting the wrong page under the old caption. Both files ship in
the same commit as the move, plus a test that every tour route resolves after
`resolveAdminRedirect`.

### D11 — `$lib/server/models/usage.ts` is not deleted
The first draft deleted it for a fabricated-zero `computeCost` and a double-counting
`recordConversationUsage`. It also exports `recordBuildUsage`, imported by four jkai build
modules, and is the only writer of the figure `jkai/budget.ts:71` caps a build on. Deleting
it replaces "accrues zero for uncatalogued models" with "accrues nothing for any model" and
the cap never fires. Only `recordConversationUsage` and its three call sites go;
`recordBuildUsage` is fixed to read the provider-reported cost.

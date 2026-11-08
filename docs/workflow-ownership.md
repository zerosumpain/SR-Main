# Workflow ownership after the Main cleanup

SR-Workflows owns execution, queue polling, scheduling, generation, graph verification and approval resumption. Main's workflow tool handlers and runtime entrypoints are clients of its authenticated invoke endpoint. Missing configuration or transport failures fail closed; they never reactivate a local executor or automatically retry a mutation.

Configure Main web, the WhatsApp worker and the builder with:

- `WORKFLOWS_TOOL_INVOKE_URL`: the Workflows gateway's `/api/workflows/tools/invoke` URL.
- `WORKFLOWS_TOOL_INVOKE_HOST`: canonical gateway Host, if required.
- `WORKFLOWS_TOOL_INVOKE_TOKEN`: ordinary workflow tool lane.
- `WORKFLOWS_DESTRUCTIVE_TOOL_INVOKE_TOKEN`: destructive tools and trusted runtime operations. The Workflows receiver calls this setting `WORKFLOWS_INVOKE_DESTRUCTIVE_TOKEN`.

Use deployment secret references, never literal production credentials in Compose or source. The builder launcher preserves these four settings. Tool principal/scope and streaming progress are carried over the existing invoke contract. The reserved `__workflow_runtime_v1` operation is not advertised in the model tool catalogue and requires the owner runtime lane. Start, approval and proof operations run in Workflows; queued starts acknowledge the durable run ID.

Regenerate Main's 25 workflow descriptors (`src/lib/tools/tools/workflows.ts`) from an SR-Workflows checkout with `node scripts/sync-workflow-tool-descriptors.mjs /path/to/SR-Workflows`. This copies metadata, not implementations; the two prose constants the descriptions use (`EXPRESSION_SYNTAX`, `AMEND_OPS_DESCRIPTION`) are copied verbatim from Workflows' sources. Review catalogue changes alongside the owner change.

## Lifecycle and diagnostics

Main no longer runs the legacy Canvas migration, scheduler, reaper or queue worker, and the local engine, node executors, run lifecycle and native workflow backend have been removed. Since 2026-10-02 Main also holds no node definitions, node registry, graph verifier, expression engine or Canvas editing code: the admin tools page reads the visible node catalogue from Workflows (`node_catalogue` runtime operation) and says "unavailable" when it cannot, and the Research Desk keeps its three desk nodes in `$lib/canvas/adapter`. Its event-loop watchdog (`$lib/server/runtime-monitor`) starts in Main's hooks independently of workflow ownership.

The scheduler leader publishes `workflows.worker-status.v1` in the existing `app_settings` JSON column every ten seconds. Main accepts snapshots for 35 seconds. Missing, expired, malformed or unreachable status is unavailable, never a fabricated empty scheduler. Schedule edits remain durable database writes; the owning worker reconciles them within its normal one-minute interval, then publishes its next heartbeat.

## Where Main's former `src/lib/workflows` code went (2026-10-02)

Nothing Main runs lives under `src/lib/workflows` any more. The folder holds three re-export shims for the protected `src/hooks.server.ts` until its next edit.

| Code | Now | Why |
|---|---|---|
| Site tool registry, invoke contract and tool implementations | `$lib/tools` | Main's own MCP server, heartbeat, daydream, scheduled callbacks, self-improvement and the builder bridge call them, and `/api/platform/tools/{catalogue,invoke}` serves them to SR-Jkai-Core and SR-Workflows. |
| WhatsApp, Gmail, Home Assistant, CalDAV, platform boot | `$lib/integrations/{whatsapp,gmail,homeassistant}`, `$lib/integrations/apple-caldav.ts`, `$lib/integrations/platform-boot.ts` | Main-owned integrations: notifications, home presence, Alexa, admin connections and the WhatsApp worker use them. Gmail owner callers use `$lib/integrations/gmail/owner-accounts.ts`. |
| Chat job store, activity, follow-up queue, confirmation gate, tool summary, Core turn client | `$lib/jkai/chat` | Heartbeat, pulse, landing vitals, agent delegation and MCP use them. The follow-up queue's WhatsApp sends go through a sender registered at boot. |
| Residential scraper (runner, credentials vault, profiles, target knowledge, interactive login sessions, Python runners) and headless browser | `$lib/scraper`, `$lib/browser` | Deep Dive's fetch fallback and the admin scraper page use them on homeserv. The homeserv restriction and the service bearer are unchanged. |
| Clients of SR-Workflows (runtime lane, start-run, generate, doctor, event-bus trigger dispatch, trigger ownership, engine probe, owner rows) | `$lib/workflows-client` | Thin clients; Workflows executes. |
| Service roles, event-loop watchdog, leader lock, worker-status reader | `$lib/server/{service-role,runtime-monitor,leader-lock,workflow-worker-status}` | Process-level platform code. |

Retired on 2026-10-02, with no live reader or caller:

- **Node definitions, executors and registry** (`nodes/`, `registry-client.ts`), the graph verifier, mapping, expression engine, schema propagation and fan-in. SR-Workflows owns newer copies.
- **The stealth-scrape chain**: the node executor, saved scraper scripts and their author/runner/store, the site mapper, playbooks and the agent harness, and the six `scraper` site tools. SR-Workflows retired the `stealth-scrape` node, so nothing could run them. Script files already on homeserv are left on disk. `POST /api/scraper/node` and `/api/scraper/script` answer 410 after the same homeserv and bearer (or owner) check, so the public-route snapshot is unchanged; `/api/scraper/playbook` was deleted.
- **Canvas server leftovers in Main** (`canvas/adapter.server`, `amend`, `amend-validate`, `mutate`, `audit`, `audit-diff`) and the fix-proposal builder. Monitors keep their own `canvas:` name allocation.
- **The run-outcome notifier** (`run-notifications.ts`); SR-Workflows sends run outcomes. WhatsApp approvals keep the naming helper.

## Workflow doctor

SR-Workflows owns the workflow doctor since 2026-10-02: triage, lint, regex-first then model diagnosis, the runaway-schedule circuit breaker, whitelisted auto-apply, the `jkai:workflow-doctor` advisory lock, stale-finding resolution and escalation. Its worker runs the night (05:00–05:55 Europe/London, once per London day, with the one-hour idle gate and the homeserv host gate) when `WORKFLOW_DOCTOR_NIGHTLY=1` is set on it, and claims a queued "Run now" at any hour. Run records and findings stay in the `doctor_runs` and `doctor_findings` datastore collections; the three switches stay in `app_settings` (`workflowdoctor.enabled`, `.breaker`, `.autoapply`); the model stays the `doctor` workload (`jkai.workflowdoctor.model`).

Main keeps no doctor logic. `/jkai/develop/doctor` reads the `doctor_overview` runtime operation and strips it for a member; `/api/admin/doctor/{run,toggle,finding}` forward to `doctor_run`, `doctor_toggle` and `doctor_finding` and relay the status code. If Workflows is unreachable the page says so and shows no controls. A finding that needs repo code reaches the improvement backlog through `POST /api/platform/backlog/intake`, which accepts source `doctor` with the same invoke token and dedupe as `trace`, and answers per-idea `outcomes`. Workflows calls it with `JKAI_TOOL_INVOKE_URL` / `JKAI_TOOL_INVOKE_TOKEN`; Main checks that token as `JKAI_INVOKE_TOKEN`.

The `daydream-doctor` and `workflow-review` heartbeat activities were removed. Existing heartbeat rows with those names are skipped as "no handler"; old pulses keep their `/jkai/develop/doctor#run-…` links. `workflow-review` wrote one model review of a single run every 30 minutes into `heartbeat_pulses.details`, which nothing read; the doctor's failure triage and silent-failure detection cover what it looked for, deterministically and across every workflow.

`src/lib/workflowdoctor/engine.ts` remains only as a no-op for the protected `src/hooks.server.ts`. The next hook edit should remove its `startWorkflowDoctor` / `stopWorkflowDoctor` import and calls, then delete the directory.

## Authoring kit decision

Node authoring belongs to SR-Workflows. The Field Study kit was deleted from Main on 2026-10-01, and the Canvas generator panel widgets were removed with the engine on 2026-10-02.

## Release order

Release SR-Workflows' worker and web contract before enabling these Main clients (for the doctor: release SR-Workflows, then Main, then set `WORKFLOW_DOCTOR_NIGHTLY=1` on the Workflows worker so only one doctor runs a night); configure all Main process roles together. Workflows web and worker must share their persisted `WORKFLOW_DYNAMIC_NODES_DIR`, so generated executors reach the queue worker. Existing generated nodes must be available in that owner directory. See SR-Workflows `docs/main-runtime-contract.md` for queue-format compatibility and maintenance. A rollback to an old worker must first drain queued envelope-format runs; removing Main's ownership fallback is intentional.

For the 2026-10-02 folder sort: release SR-Workflows (the `node_catalogue` operation) before Main, or the admin tools page shows workflow nodes as unavailable until it ships; nothing else depends on order. The release copies the scraper's Python runners from `src/lib/scraper/python` (`scripts/ci-release.sh`); homeserv must run a checkout at or after this change before the scraper is next used, because the runners are read from that path at run time.


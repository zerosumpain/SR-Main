# Workflow ownership after the Main cleanup

SR-Workflows owns execution, queue polling, scheduling, generation, graph verification and approval resumption. Main's workflow tool handlers and runtime entrypoints are clients of its authenticated invoke endpoint. Missing configuration or transport failures fail closed; they never reactivate a local executor or automatically retry a mutation.

Configure Main web, the WhatsApp worker and the builder with:

- `WORKFLOWS_TOOL_INVOKE_URL`: the Workflows gateway's `/api/workflows/tools/invoke` URL.
- `WORKFLOWS_TOOL_INVOKE_HOST`: canonical gateway Host, if required.
- `WORKFLOWS_TOOL_INVOKE_TOKEN`: ordinary workflow tool lane.
- `WORKFLOWS_DESTRUCTIVE_TOOL_INVOKE_TOKEN`: destructive tools and trusted runtime operations. The Workflows receiver calls this setting `WORKFLOWS_INVOKE_DESTRUCTIVE_TOKEN`.

Use deployment secret references, never literal production credentials in Compose or source. The builder launcher preserves these four settings. Tool principal/scope and streaming progress are carried over the existing invoke contract. The reserved `__workflow_runtime_v1` operation is not advertised in the model tool catalogue and requires the owner runtime lane. Start, approval and proof operations run in Workflows; queued starts acknowledge the durable run ID.

Regenerate Main's 25 workflow descriptors from an SR-Workflows checkout with `node scripts/sync-workflow-tool-descriptors.mjs /path/to/SR-Workflows`. This copies metadata, not implementations. Review catalogue changes alongside the owner change.

## Lifecycle and diagnostics

Main no longer runs the legacy Canvas migration, scheduler, reaper or queue worker, and the local engine, node executors, run lifecycle and native workflow backend have been removed. Main keeps node definitions (`*.def.ts`, the combined definition files and `registry-client.ts`) for the Research Desk palette and the tools catalogue, plus the helpers its own routes and tools call directly (`template`, `stealth-scrape`, `home-assistant`, `apple-calendar`, `llm-helpers`). Its event-loop watchdog starts in Main's hooks independently of workflow ownership.

The scheduler leader publishes `workflows.worker-status.v1` in the existing `app_settings` JSON column every ten seconds. Main accepts snapshots for 35 seconds. Missing, expired, malformed or unreachable status is unavailable, never a fabricated empty scheduler. Schedule edits remain durable database writes; the owning worker reconciles them within its normal one-minute interval, then publishes its next heartbeat.

## Workflow doctor

SR-Workflows owns the workflow doctor since 2026-10-02: triage, lint, regex-first then model diagnosis, the runaway-schedule circuit breaker, whitelisted auto-apply, the `jkai:workflow-doctor` advisory lock, stale-finding resolution and escalation. Its worker runs the night (05:00–05:55 Europe/London, once per London day, with the one-hour idle gate and the homeserv host gate) when `WORKFLOW_DOCTOR_NIGHTLY=1` is set on it, and claims a queued "Run now" at any hour. Run records and findings stay in the `doctor_runs` and `doctor_findings` datastore collections; the three switches stay in `app_settings` (`workflowdoctor.enabled`, `.breaker`, `.autoapply`); the model stays the `doctor` workload (`jkai.workflowdoctor.model`).

Main keeps no doctor logic. `/jkai/develop/doctor` reads the `doctor_overview` runtime operation and strips it for a member; `/api/admin/doctor/{run,toggle,finding}` forward to `doctor_run`, `doctor_toggle` and `doctor_finding` and relay the status code. If Workflows is unreachable the page says so and shows no controls. A finding that needs repo code reaches the improvement backlog through `POST /api/platform/backlog/intake`, which accepts source `doctor` with the same invoke token and dedupe as `trace`, and answers per-idea `outcomes`. Workflows calls it with `JKAI_TOOL_INVOKE_URL` / `JKAI_TOOL_INVOKE_TOKEN`; Main checks that token as `JKAI_INVOKE_TOKEN`.

The `daydream-doctor` and `workflow-review` heartbeat activities were removed. Existing heartbeat rows with those names are skipped as "no handler"; old pulses keep their `/jkai/develop/doctor#run-…` links. `workflow-review` wrote one model review of a single run every 30 minutes into `heartbeat_pulses.details`, which nothing read; the doctor's failure triage and silent-failure detection cover what it looked for, deterministically and across every workflow.

`src/lib/workflowdoctor/engine.ts` remains only as a no-op for the protected `src/hooks.server.ts`. The next hook edit should remove its `startWorkflowDoctor` / `stopWorkflowDoctor` import and calls, then delete the directory.

## Authoring kit decision

Node authoring belongs to SR-Workflows. The Field Study kit was deleted from Main on 2026-10-01, and the Canvas generator panel widgets were removed with the engine on 2026-10-02.

## Release order

Release SR-Workflows' worker and web contract before enabling these Main clients (for the doctor: release SR-Workflows, then Main, then set `WORKFLOW_DOCTOR_NIGHTLY=1` on the Workflows worker so only one doctor runs a night); configure all Main process roles together. Workflows web and worker must share their persisted `WORKFLOW_DYNAMIC_NODES_DIR`, so generated executors reach the queue worker. Existing generated nodes must be available in that owner directory. See SR-Workflows `docs/main-runtime-contract.md` for queue-format compatibility and maintenance. A rollback to an old worker must first drain queued envelope-format runs; removing Main's ownership fallback is intentional.

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

Main no longer runs the legacy Canvas migration, scheduler, reaper or queue worker. Its event-loop watchdog starts in Main's hooks independently of workflow ownership. Remaining engine helpers and node libraries still support Main research, authoring and other callers and are not a bulk deletion target.

The scheduler leader publishes `workflows.worker-status.v1` in the existing `app_settings` JSON column every ten seconds. Main accepts snapshots for 35 seconds. Missing, expired, malformed or unreachable status is unavailable, never a fabricated empty scheduler. Schedule edits remain durable database writes; the owning worker reconciles them within its normal one-minute interval, then publishes its next heartbeat.

## Authoring kit decision

Keep the Field Study library in Main as the authoring kit prescribed by `CLAUDE.md`. Its appearance in other repositories does not establish exclusive ownership elsewhere. Keep Canvas generator widgets in Main while `node-builder/codegen/panel.ts`, generated imports and node-builder manuals depend on them. Moving either requires changing that authoring contract and its documentation together. This batch makes no move and does not describe either kit as dead code.

## Release order

Release SR-Workflows' worker and web contract before enabling these Main clients; configure all Main process roles together. Workflows web and worker must share their persisted `WORKFLOW_DYNAMIC_NODES_DIR`, so generated executors reach the queue worker. Existing generated nodes must be available in that owner directory. See SR-Workflows `docs/main-runtime-contract.md` for queue-format compatibility and maintenance. A rollback to an old worker must first drain queued envelope-format runs; removing Main's ownership fallback is intentional.

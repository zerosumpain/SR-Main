# Debugging "the workflow stayed silent" (fires fine, no output)

Failure class: the schedule fires on time, runs complete with `status: completed`, zero errors — but the expected WhatsApp/email never arrives. This is NOT the "not firing at all" class (for that see the SKILL.md pitfall "Schedule in-memory registration can go stale" and use `scheduler_status`).

Worked end-to-end on 2026-07-20 (broads-speed sampler/reporter pair: one message over a 2-hour journey, expected ~8).

## First response: offer to drill, don't move on

When the user says a workflow "isn't working despite not failing" — **stop and offer to inspect**. The user has just handed you a free diagnostic signal. Don't acknowledge and move on to the next topic. Reply with something like:

> Want me to dig into the run history and see why it's staying silent? I can inspect the last few executions and trace where the conditional / filter cuts the branch.

Then call `workflow_get_run` on the most recent completed run and walk the `nodeExecutions`, checking each node's `outputData` and which downstream nodes sit at `status: "pending"` (never executed) — that pinpoints the conditional/filter that cut the branch.

This also catches the case where the user *thinks* it's running but the schedule is actually disabled (schedules with `enabled: false` that still show a `lastRunAt` from before the disable date). Cross-reference `schedules[].enabled` with `recentRuns[].startedAt` — if the last run is older than the expected cadence, the schedule may have been disabled or the in-memory runner may have lost it.

## Diagnostic path

1. **Confirm firing.** `workflow_inspect({ id })` → `schedules[].lastRunAt` + `recentRuns`: look for `status: "completed"`, `trigger: "scheduled"` at the expected cadence. If runs are missing or late → it's a scheduler problem instead; switch to `scheduler_status`.
2. **Drill representative runs.** `workflow_get_run({ runId })` → walk `nodeExecutions`. Check each node's `outputData`, and crucially which downstream nodes sit at `status: "pending"` (never executed) — that pinpoints the conditional/filter that cut the branch. (Broads case: the "Save rolling window" node was `pending` on every run because the check node output `onRiver: false`.)
3. **Check shared handoff state.** Pipelines that pass data between workflows via a `database`/data-store record: query the record (`datastore_query` on the collection) and read `updatedAt`. A record untouched since before the incident window proves the upstream writer never wrote. Default/empty content + stale `updatedAt` = the upstream filter is dropping everything.
4. **Verify raw source data against the filter.** When the pipeline filters external telemetry (HA entities, GPS, APIs), fetch the RAW source over the incident window (`ha_get_history` for HA) and evaluate the workflow's filter logic by hand against it. (Broads case: filter wanted 2–12 mph, but the code's m/s→mph conversion was applied to km/h data, inflating readings ~2.2× — every genuine reading landed outside the band. The workflow "worked"; it was correctly filtering out data the buggy conversion had mangled.)
5. **Respect designed silence.** Reporters built as "silent when no data" (conditional → notify only on true) make data starvation invisible: no message ≠ broken engine. Check whether the silence branch fired before assuming a delivery problem.

## Tool param names differ across the family — wrong name reads as "Workflow not found"

| Tool | Param |
|------|-------|
| `workflow_inspect` | `id` |
| `workflow_run` | `id` |
| `workflow_get_run` | `runId` |
| `workflow_get_generation_log` | `workflowId` |
| `scheduler_run_history` | `workflowId` |
| `workflow_update_metadata` / `workflow_delete` | `id` |

A wrong or missing param name does NOT produce a validation error — the call returns `{"success": false, "error": "Workflow not found"}`. If `workflow_list` just showed the workflow, suspect the param name first; confirm with `jkai_extended operation="schema"` before concluding anything is actually missing.

## Getting runIds older than the last 5

`workflow_inspect` returns only the 5 most recent runs. For runs inside an older incident window, use `scheduler_run_history({ workflowId, limit })` to list more, then `workflow_get_run({ runId })` on the ones that matter.

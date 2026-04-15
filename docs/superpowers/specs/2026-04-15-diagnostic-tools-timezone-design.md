# Diagnostic Tools & Timezone-Aware Timestamps

**Date**: 2026-04-15
**Status**: Approved

## Problem

When a scheduled workflow appeared to stop running, jkai couldn't diagnose why — it had no access to scheduler runtime state or system logs. Additionally, timestamps in tool results are raw UTC ISO strings, causing timezone confusion (user is BST, VPS is UTC).

## Design

### Part 1: Diagnostic Tools

New domain module `tools/diagnostics.ts` with 3 tools in category "System Diagnostics":

#### `scheduler_status`
**Purpose**: Compare in-memory cron state with DB state for all schedules.
**Parameters**: `{}` (no params)
**Returns**: Array of schedule entries, each with: scheduleId, workflowId, workflowName, cronExpression, enabled (DB), registered (in-memory), lastRunAt, lastRunAtFormatted, nextFireTime, nextFireTimeFormatted.
**Implementation**: Query `workflowSchedules` joined with `workflows` for names. For each schedule, check if `activeJobs` Map has an entry and get its `nextRun()`. Export a `getActiveJobs()` function from `scheduler.ts` to expose the Map read-only.

#### `scheduler_run_history`
**Purpose**: Recent scheduled runs for a workflow or all workflows.
**Parameters**: `{ workflowId?: string, limit?: number }`
**Returns**: Recent `workflowRuns` where `trigger='scheduled'`, with status, startedAt, completedAt, error, duration, all with formatted timestamps.
**Implementation**: Query `workflowRuns` filtered by trigger, optionally by workflowId, ordered by startedAt desc.

#### `system_logs`
**Purpose**: Read recent systemd journal entries for the app service.
**Parameters**: `{ lines?: number, filter?: string }`
**Returns**: Raw log lines from `journalctl -u strange-rambling-svelte`.
**Implementation**: Shell out via `child_process.exec`. `lines` defaults to 50, capped at 200. `filter` is passed as `--grep` (sanitised to prevent injection). Returns `{ lines: string[], count: number }`.

### Part 2: Timezone-Aware Formatting

New utility `format-time.ts`:

```typescript
export function formatTimestamp(value: string | Date | null): string | null
```

Uses `Intl.DateTimeFormat` with `Europe/London` timezone. Returns e.g. `"08:22 BST, 15 Apr"`. Returns null for null input.

Applied to tool results that include timestamps — tools return both raw ISO and `*Formatted` fields. Key tools to update:
- `workflow_inspect` (run timestamps, schedule timestamps)
- `build_inspect` (iteration timestamps)
- `scheduler_status` (lastRunAt, nextFireTime)
- `scheduler_run_history` (startedAt, completedAt)

### Part 3: Schedule Tool Hot-Reload

`workflow_update_schedule`, `workflow_add_schedule`, and `workflow_remove_schedule` in `tools/workflows.ts` must call `reloadSchedule(scheduleId)` after DB update so in-memory cron state stays in sync.

### Files

- Create: `src/lib/workflows/site-tools/tools/diagnostics.ts`
- Create: `src/lib/workflows/site-tools/format-time.ts`
- Modify: `src/lib/workflows/scheduler.ts` (export `getActiveJobs()`)
- Modify: `src/lib/workflows/site-tools/registry.ts` (add diagnostics import)
- Modify: `src/lib/workflows/site-tools/tools/workflows.ts` (reloadSchedule calls + formatted timestamps)
- Modify: `src/lib/workflows/site-tools/tools/builds.ts` (formatted timestamps)
- Modify: `src/lib/workflows/site-tools/tools/research.ts` (formatted timestamps)
- Modify: `tests/lib/workflows/site-tools/registry.test.ts` (add diagnostics assertions)

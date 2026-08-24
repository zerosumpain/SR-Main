# Testing Cron-Scheduled Workflows on the VPS

When you need to test a production cron workflow that only fires every 6h (or daily, weekly, etc.), you can't just wait for the next schedule — the MCP `workflow_run` tool operates on the homeserv DB, not the VPS production DB where the cron workflow lives.

## The Pattern: Temp Schedule, Run, Restore

### 1. Inspect the current schedule

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \
    \"SELECT config, next_run_at FROM workflow_schedules WHERE workflow_id = '<workflow_id>';\""
```

Note the current cron expression (e.g. `0 */6 * * *`) so you can restore it.

### 2. Change the schedule to every 5 minutes

Update **both** the trigger node config (visual) and the schedule config (scheduler). Both must be consistent or the UI shows stale info.

```sql
UPDATE workflow_nodes
SET config = jsonb_set(config, '{cron}', to_jsonb('*/5 * * * *'::text)),
    label = 'Trigger (*/5 * * * *)'
WHERE workflow_id = '<workflow_id>' AND type = 'trigger';

UPDATE workflow_schedules
SET config = '{"expression": "*/5 * * * *"}'::jsonb,
    next_run_at = NOW() + interval '2 minutes'
WHERE workflow_id = '<workflow_id>';
```

### 3. Restart the service

The scheduler caches schedules in memory at startup — a direct DB mutation is not live until the service restarts.

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "sudo systemctl restart strange-rambling-svelte"
```

**Ask first.** Restarting production is a user-approval action per the escalation ladder.

### 4. Wait for the next tick, then inspect the run

The scheduler fires on the tick boundary (top of each minute for `*/5 * * * *`). Wait until the minute after the `next_run_at` you set, then check journalctl for the run:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "journalctl -u strange-rambling-svelte --since '2 minutes ago' --no-pager -q | grep -i 'scheduler.*run\|<workflow_id>' | tail -5"
```

Grab the run ID from the `[scheduler] Starting run <run_id> for workflow <workflow_id>` line, then inspect per-node execution data:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \
    \"SELECT wn.label, wn.type, ne.status, ne.input_data, ne.output_data, ne.error \
     FROM node_executions ne \
     JOIN workflow_nodes wn ON ne.node_id = wn.id \
     WHERE ne.run_id = '<run_id>' \
     ORDER BY ne.started_at;\""
```

### 5. Restore the original schedule

Once testing is done, set everything back:

```sql
UPDATE workflow_nodes
SET config = jsonb_set(config, '{cron}', to_jsonb('<original_cron>'::text)),
    label = 'Trigger (<original_cron>)'
WHERE workflow_id = '<workflow_id>' AND type = 'trigger';

UPDATE workflow_schedules
SET config = '{"expression": "<original_cron>"}'::jsonb,
    next_run_at = '<original_next_run_at>'
WHERE workflow_id = '<workflow_id>';
```

Then restart again.

## Important Caveats

### The scheduler checks cron, not next_run_at

Setting `next_run_at` to a time in the past does **not** trigger a run. The scheduler calculates the next valid match from the cron expression and only fires when the wall clock matches. This is why you must change the expression itself, not just the timestamp.

### Two restarts, never one

The schedule change requires a restart. The restore requires a restart. There is no way around this — the scheduler is in-memory. Always ask the user before each restart.

### You must update both `workflow_nodes` AND `workflow_schedules`

The trigger node config is the visual representation shown in the canvas UI. The schedule config is what the scheduler actually uses. If they disagree, the canvas shows the wrong schedule but the workflow fires at the wrong time (or not at all). Always update both.

### Edge case: the scheduler may skip a tick

If the restart completes after the `next_run_at` you set (e.g. you set it 2 minutes out but the restart took 3 minutes), the scheduler skips that tick and waits for the next one. Set `next_run_at` to `NOW() + interval '2 minutes'` to give enough margin.

### `node_executions` is your primary debugging tool

Per-node input/output data is available via `node_executions` on the VPS (confirmed working). Do not rely on journalctl for message content — it only has node start/end timing, not payloads. Use the SQL query above to see exactly what the transform, LLM, and WhatsApp nodes produced.
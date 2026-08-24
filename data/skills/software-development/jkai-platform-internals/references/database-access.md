# Database Access Patterns

Direct SQL access to the jkai PostgreSQL databases, bypassing the MCP tool layer. Use when the MCP tools don't show what you expect (e.g. production workflows invisible from homeserv).

## Homeserv (local dev)

```bash
docker exec strange_rambling-app-db-1 psql -U app -d strange_rambling -t -c "SELECT ..."
```

- Container: `strange_rambling-app-db-1`
- Port: 5433 (mapped from container's 5432)
- User: `app`, DB: `stranger_rambling`
- Password: masked as `***` in `.env` — use `docker exec` which authenticates via the container's PG environment vars (no password needed).

## VPS (production)

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \"SELECT ...\""
```

- Container name on VPS: `strange-rambling-app-db-1` (hyphen, not underscore)
- Port: 5432 internal (not exposed externally — must go through SSH + docker exec)
- Same user/DB as homeserv

**Tip:** Wrap the SQL in single quotes inside the SSH command if it contains double quotes, or escape carefully. The pattern above uses escaped double quotes for the psql -c argument.

## Common Queries

### List all workflows with run counts

```sql
SELECT w.name, COUNT(wr.id) as run_count, MAX(wr.started_at) as last_run
FROM workflows w
LEFT JOIN workflow_runs wr ON wr.workflow_id = w.id
GROUP BY w.name
ORDER BY run_count DESC;
```

### Find a workflow by partial name

```sql
SELECT id, name, description FROM workflows
WHERE name ILIKE '%family%' OR name ILIKE '%presence%';
```

### Inspect all nodes + config for a workflow

```sql
SELECT json_agg(json_build_object(
  'id', n.id, 'type', n.type, 'label', n.label,
  'config', n.config, 'position', n.position
))
FROM workflow_nodes n
WHERE n.workflow_id = '<workflow_id>';
```

### Check run history (last N runs)

```sql
SELECT id, status, started_at, completed_at, error
FROM workflow_runs
WHERE workflow_id = '<workflow_id>'
ORDER BY started_at DESC LIMIT 10;
```

### Read data store values

```sql
SELECT key, value, updated_at
FROM workflow_data_store
WHERE workflow_id = '<workflow_id>';
```

### Check active schedules

```sql
SELECT ws.id, ws.type, ws.config, ws.enabled, ws.last_run_at
FROM workflow_schedules ws
JOIN workflows w ON w.id = ws.workflow_id
WHERE ws.enabled = true;
```

### Table schemas (quick reference)

```sql
\d workflow_runs       -- id, workflow_id, status, started_at, completed_at, error, trigger, healing_history
\d workflow_nodes      -- id, workflow_id, type, label, config (jsonb), position
\d workflow_edges      -- id, source_node_id, target_node_id, source_handle, target_handle
\d workflow_schedules  -- id, workflow_id, type, config (jsonb), enabled, last_run_at, next_run_at
\d workflow_data_store -- workflow_id, key, value (jsonb), updated_at
\d orchestrator_chats  -- id, workflow_id, role, content, metadata (jsonb), created_at, conversation_id
\d jkai_conversations  -- id, title, source, whatsapp_phone_number, created_at, updated_at, model_provider, model_id
```

### Additional useful tables

**`orchestrator_chats`** — Canvas chat history. Query by `workflow_id` to find conversations about a workflow, including user instructions and assistant responses about edits/fixes.

```sql
-- Get chat history for a workflow (most recent first)
SELECT role, LEFT(content, 500), created_at
FROM orchestrator_chats
WHERE workflow_id = '<workflow_id>'
ORDER BY created_at DESC
LIMIT 20;
```

**`jkai_conversations`** — User conversations (both web and WhatsApp). The `whatsapp_phone_number` column lets you find all conversations from a specific number.

```sql
-- Find conversations by WhatsApp number or title
SELECT id, title, whatsapp_phone_number
FROM jkai_conversations
WHERE title ILIKE '%family%' OR whatsapp_phone_number = '+44...'
ORDER BY updated_at DESC;
```

### Duration-based run filtering

When investigating VPS workflows, most runs complete in ~200-400ms (no-op: no state changes, LLM not called). Runs where the LLM + side-effect nodes fired take 5-30+ seconds. Filter for "interesting" runs:

```sql
-- Find runs where LLM/side-effects actually fired (duration > 5 seconds)
SELECT id, status, started_at, completed_at,
       EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_sec
FROM workflow_runs
WHERE workflow_id = '<workflow_id>'
  AND (completed_at - started_at) > interval '1 second'
ORDER BY started_at DESC
LIMIT 10;
```

Typical duration signatures:
- **<1s**: No-op run (conditional false, LLM not called, no WhatsApp)
- **5-15s**: LLM called (one person changed state), WhatsApp sent
- **15-30s**: LLM called with complex context (multiple people, geocoding, movement)
- **>30s**: Multiple LLM calls or slow model response

**`node_executions` EXISTS on both homeserv and VPS production.** Query it to inspect per-node input/output data for any run. When you need per-node data for a VPS run:
On homeserv (dev), `node_executions` works identically:
   ```sql
   -- Full execution trace for a single run — homeserv or VPS
   SELECT wn.label, wn.type, ne.status, ne.input_data, ne.output_data, ne.error
   FROM node_executions ne
   JOIN workflow_nodes wn ON ne.node_id = wn.id
   WHERE ne.run_id = '<run_id>'
   ORDER BY ne.started_at;
   ```

This is the primary way to debug "why did the LLM produce X" or "what did the search node return" on VPS. The `output_data` column contains the full node output as jsonb.

**Fallback when node_executions is empty or missing** (shouldn't happen, but just in case):
- `workflow_audit_log` — exists but sparse (only records structural changes like node create/rename, not per-run data)
- `workflow_interactions` — only for pause/resume interactions
- Journalctl logs — `journalctl -u strange-rambling-svelte` shows node start/end with run_id + node_id + duration, but NOT input/output payloads or message content
- `orchestrator_chats` — has canvas chat history (user instructions, assistant replies about edits), but NOT per-run LLM outputs
- **WhatsApp message content is NOT logged in journalctl at any level** — only node start/end timing is recorded

### Reconstructing LLM outputs via node_executions

When you need to know "what did the LLM produce in this run" on VPS, query `node_executions` directly — it has full `output_data` as jsonb:

```sql
-- Get the LLM node's output for a specific run
SELECT ne.output_data->>'response' as llm_response,
       ne.output_data->'usage' as token_usage
FROM node_executions ne
WHERE ne.run_id = '<run_id>' AND ne.node_id = '<llm_node_id>';
```

For comparing outputs across multiple runs (e.g. debugging "why does the briefing always say the same thing"):

```sql
-- Compare Tavily search results across recent runs to spot stale content
SELECT ne.run_id, LEFT(ne.output_data::text, 800) as preview
FROM node_executions ne
JOIN workflow_runs wr ON ne.run_id = wr.id
WHERE wr.workflow_id = '<workflow_id>'
  AND ne.node_id = '<search_node_id>'
ORDER BY ne.started_at DESC LIMIT 5;
```

This is the primary debugging path for VPS runs — no need for journalctl reconstruction or data store inference.

### Inspecting node execution data (VPS)

On the VPS, `node_executions` **does exist** and is the primary debugging tool. Use it to inspect per-node inputs, outputs, and errors for any run. When you also want journalctl timing (which node_executions doesn't provide):

1. **node_executions** (primary) — full input/output per node per run. Example for debugging stale search results:
   ```sql
   -- Check what the Tavily search node returned across recent runs
   SELECT ne.run_id, LEFT(ne.output_data::text, 800) as output_preview
   FROM node_executions ne
   JOIN workflow_runs wr ON ne.run_id = wr.id
   WHERE wr.workflow_id = '<workflow_id>'
     AND ne.node_id = '<search_node_id>'
   ORDER BY ne.started_at DESC LIMIT 5;
   ```
   Compare output previews across runs to spot identical results being returned.

2. **Journalctl log trace** (supplementary) — shows node timing, run_id, node_id. Use alongside node_executions when you need wall-clock duration:
   ```bash
   ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
     "journalctl -u strange-rambling-svelte --since '05:29' --until '05:32' --no-pager -q"
   ```
   Key signals:
   - `whatsapp` node with `duration=0ms` → empty message (LLM returned nothing)
   - `llm-call` node with `duration=15000ms` → model responded (check quality)
   - `code-execute` node with `duration=0ms` → likely no relevant data to process

2. **Node config inspection** — query `workflow_nodes.config` to see what each node expects as input, then trace backward through edges to verify the data path.

3. **Data store inspection** — `workflow_data_store` values show what state was persisted (useful for conditional logic debugging).

On homeserv (dev), `node_executions` works identically:
   ```sql
   -- Full execution trace for a single run — homeserv or VPS
   SELECT wn.label, wn.type, ne.status, ne.input_data, ne.output_data, ne.error
   FROM node_executions ne
   JOIN workflow_nodes wn ON ne.node_id = wn.id
   WHERE ne.run_id = '<run_id>'
   ORDER BY ne.started_at;
   ```

Key: `input_data` shows what the node received (after the engine's Object.assign merge of upstream outputs), and `output_data` shows what it produced. When debugging "why did node X not get field Y", check the upstream node's `output_data` first, then the target node's `input_data`.

### App settings / model configuration

Admin-configured model defaults live in `app_settings`:
```sql
SELECT key, value FROM app_settings WHERE key LIKE '%model%' OR key LIKE '%default%';
```
Known keys:
- `jkai.chat.default_glm_model` — default model for chat (e.g. `{"modelId": "glm-5-turbo"}`)
- `jkai.builder.default_model` — builder model (e.g. `{"modelId": "glm-5.1", "provider": "zai"}`)
- `jkai.chat.alt_openrouter_model` — alternate model via OpenRouter

## Mutating the production database directly — don't

**This is a last resort that needs explicit user approval each time, not a working pattern.**

Copying a `.sql` file to the production box and piping it into `psql` is unreviewed, unlogged,
un-revertable change to live data. There is no diff, no gate, and nothing to roll back to. On
2026-07-24 a session used exactly this pipeline alongside a hand-rolled rsync deploy and left
strangeramblings.com down for 33 hours; the SQL half is what made the state hard to reason about
afterwards, because nothing recorded what had been changed or why.

**Reach for these first — in order:**

1. **Workflow/datastore MCP tools** (`workflow_*`, `datastore_*`, `database` node). They cover
   node config, edges, schedules and data-store values, and every call is logged and attributable.
   They act on whichever instance serves them, so run them against production to change production.
2. **`request_change`** if the change belongs in the repo (schema, seed data, a migration).
   Issue → branch → gate → PR → CI applies `drizzle-kit push` on deploy. Reviewable and revertible.
3. **A read-only query** to confirm what you think is true. Everything above this section is
   read-only and safe; prefer it for diagnosis.

Only if all three genuinely cannot do it, ask the user, explain what you are about to change and
how it would be undone, and then use the pipeline below. Take a dump first
(`docker exec <ctr> pg_dump -U app strange_rambling > backup.sql`) — the vps-ops rule is: before
destructive DB work on the VPS, back up.

```bash
# LAST RESORT — requires explicit approval, and a dump taken first.
scp -i ~/.ssh/id_ed25519 /tmp/migration.sql johnk@157.180.19.38:/tmp/migration.sql
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < /tmp/migration.sql"
```

The pitfalls below are real and worth reading *if* you end up here — they cost hours to find.

### Pitfall: dollar-quoting gets mangled through docker exec

PostgreSQL dollar-quoting (`$$...$$`) does **not** survive the SSH → docker exec → psql pipeline. The `$$` gets consumed by shell quoting layers before reaching psql. The SQL will appear to execute without error (`UPDATE 1`) but the value won't actually change.

**Fix:** Use a Python script to generate SQL with properly single-quote-escaped strings:

```python
import json

with open('/tmp/new-code.js') as f:
    new_code = f.read()

escaped_code = new_code.replace("'", "''")  # PostgreSQL single-quote escape

sql = f"""
DO $update$
DECLARE
    cfg jsonb;
BEGIN
    SELECT config INTO cfg FROM workflow_nodes WHERE id = '<node_id>';
    cfg := jsonb_set(cfg, '{{code}}', to_jsonb('{escaped_code}'::text));
    UPDATE workflow_nodes SET config = cfg WHERE id = '<node_id>';
END $update$;
"""

with open('/tmp/migration.sql', 'w') as f:
    f.write(sql)
```

Note: inside a `DO` block, use `$update$` as the dollar-quote delimiter (not `$$`), and double braces for JSON path literals (`{{code}}` not `{code}`).

### Pitfall: config field is jsonb, not text

When updating `workflow_nodes.config`, remember it's a `jsonb` column. To update a nested field (like `config.code`):

```sql
-- WRONG: treats the string as a jsonb path, not a value
UPDATE workflow_nodes SET config = jsonb_set(config, '{code}', '"my code"');

-- RIGHT: use to_jsonb() to wrap the text properly
DO $update$
DECLARE
    cfg jsonb;
    new_code text := 'actual code here with ''quotes'' escaped';
BEGIN
    SELECT config INTO cfg FROM workflow_nodes WHERE id = '<node_id>';
    cfg := jsonb_set(cfg, '{code}', to_jsonb(new_code));
    UPDATE workflow_nodes SET config = cfg WHERE id = '<node_id>';
END $update$;
```

### Restart after mutation

The scheduler caches enabled schedules in memory at startup, so a direct DB mutation is not live
until the service restarts. That is another reason to prefer the `workflow_*` MCP tools — they go
through the running process, so no restart is needed and there is no window where the DB and the
running config disagree.

If you did mutate directly and a restart is genuinely required, **ask first** — restarting
production is a user-approval action per the escalation ladder in jkai-general. Restart, then poll
the public url until it answers rather than detaching the command, and confirm with
`journalctl -u strange-rambling-svelte` that the scheduler reloaded what you expect. Verifying "the
next scheduled run completes without error" is not enough on its own: a stale in-memory schedule
also completes without error, it just runs the old thing.

### Updating Schedules Directly via SQL (Trigger, Metadata, & next_run_at)

When changing a schedule (e.g., from daily to monthly) via SQL on production, you must align the schedule configuration, the visual visual-trigger node, the next schedule iteration timestamp, AND any parent workflow naming/description metadata to prevent the UI from displaying stale information or executing on out-of-sync schedules.

1. **Visual trigger node**: Update BOTH the `config` JSON (containing `cron`, description, etc.) and the visual `label` on the trigger node.
2. **Scheduler configuration**: Update the `cron` expression in `workflow_schedules.config` AND align the `next_run_at` timestamp. If you omit `next_run_at`, the scheduler might use a stale, pre-calculated timestamp from the database and fire at the old interval first.
3. **Workflow metadata**: Shift the parent workflow's `name` and `description` if they mention the old cadence (e.g., changing `canvas:darlington-daily-crime` to `canvas:darlington-monthly-crime`).

Example atomic SQL block to shift a workflow schedule (e.g. Darlington crime) to monthly on the 1st at 09:00 UTC:

```sql
BEGIN;
-- 1. Update the parent workflow name and description
UPDATE workflows 
SET name = 'canvas:darlington-monthly-crime', 
    description = 'Monthly 1st 9am cron that fetches latest street-level crime data...'
WHERE id = 'def8020c-f4ba-4611-ac48-096c3f1720ae';

-- 2. Update visual trigger node config & label
UPDATE workflow_nodes 
SET config = '{"cron": "0 9 1 * *", "kind": "manual", "description": "Monthly 1st 9am trigger for crime data check"}'::jsonb,
    label = 'Monthly 1st 9am Cron'
WHERE id = 'trigger-be0a0825-1' AND workflow_id = 'def8020c-f4ba-4611-ac48-096c3f1720ae';

-- 3. Update scheduler config & align next_run_at to avoid stale execution timings
UPDATE workflow_schedules 
SET config = '{"cron": "0 9 1 * *"}'::jsonb,
    next_run_at = '2026-08-01 09:00:00+00'
WHERE workflow_id = 'def8020c-f4ba-4611-ac48-096c3f1720ae';

COMMIT;
```

Always restart SvelteKit immediately after running the mutation so the scheduler reloads its in-memory map from the database. Then query the schedule to verify registration and next-run calculations.

### Adding new nodes and edges

When adding new nodes to a VPS workflow via SQL, you must set all required fields:

```sql
BEGIN;

-- Add node
INSERT INTO workflow_nodes (id, workflow_id, type, label, config, position)
VALUES (
  'llm-call-my-analysis',
  '<workflow_id>',
  'llm-call',
  'My analysis',
  '{"model": "glm-5-turbo", "temperature": 0.4, "maxTokens": 512, "systemPrompt": "...", "userPrompt": "..."}'::jsonb,
  '{"x": 1350, "y": 100}'::jsonb
);

-- Wire it in (remove old edge, add new ones)
DELETE FROM workflow_edges WHERE id = '<old_edge_id>';

INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, source_handle, target_handle)
VALUES (
  'edge-new-1', '<workflow_id>',
  '<source_node_id>', 'llm-call-my-analysis',
  'true', NULL  -- source_handle only needed for conditional outputs
);

INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, source_handle, target_handle)
VALUES (
  'edge-new-2', '<workflow_id>',
  'llm-call-my-analysis', '<target_node_id>',
  NULL, NULL
);

COMMIT;
```

### Simpler full-config replacement (when dollar-quoting is overkill)

If you're replacing the entire `config` jsonb for a node (not just one nested field), the simplest approach is to build the config as a JSON object in Python, single-quote-escape it for PostgreSQL, and run a plain UPDATE:

```python
import json

config = {
    "code": "// new code here...",
    "language": "javascript",
    "description": "Updated node",
    "outputSchema": {"message": {"type": "string"}, "departures": {"type": "array"}}
}

config_json = json.dumps(config).replace("'", "''")
sql = f"UPDATE workflow_nodes SET config = '{config_json}'::jsonb WHERE id = '<node_id>';"

with open('/tmp/update.sql', 'w') as f:
    f.write(sql)
```

Then deploy:

```bash
scp -i ~/.ssh/id_ed25519 /tmp/update.sql johnk@157.180.19.38:/tmp/update.sql
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < /tmp/update.sql"
```

This avoids dollar-quoting entirely and works for any config replacement. Use the `DO $update$` + `jsonb_set` approach only when you need to update a single nested key while preserving the rest of the config.

### Multi-node batch updates

When updating several nodes at once, generate all UPDATE statements in one SQL file and deploy in a single round-trip:

```python
import json

def sql_escape(s):
    return s.replace("'", "''")

# Build configs for each node
nodes = {
    "code-execute-xxx": {"code": "...", "language": "javascript", ...},
    "llm-call-xxx": {"model": "glm-5-turbo", "systemPrompt": "...", ...},
    "whatsapp-xxx": {"to": "+44...", "message": "{{input.response}}"},
}

sql_lines = []
for node_id, config in nodes.items():
    config_json = sql_escape(json.dumps(config))
    sql_lines.append(f"UPDATE workflow_nodes SET config = '{config_json}'::jsonb WHERE id = '{node_id}';")

with open('/tmp/update.sql', 'w') as f:
    f.write('\n'.join(sql_lines))
```

Deploy same way. Verify with `SELECT id, config->>'key_name' FROM workflow_nodes WHERE id = '...'` after.

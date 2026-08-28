# Custom Tools — architecture, inspection, and curation

Custom tools are agent-callable site tools created at RUNTIME — mostly by the
self-improve engine (`src/lib/selfimprove/`), optionally by `create_tool`. They
are NOT static repo code and do NOT appear in `src/lib/workflows/site-tools/tools/`.
A grep of the repo for their names returns nothing; don't conclude they don't
exist. This is the map for recognising, inspecting, and (once the surface
lands) retiring them.

## Where they live

- **DB table:** `custom_tools` on the instance the bridge talks to (production).
  Columns (snake_case in DB): `name`, `description`, `toolset`, `enabled`
  (boolean), `parameters` (jsonb), `handler_code`, `run_count` (CUMULATIVE,
  never reset), `error_count`, `last_run_at`, `created_at`.
- **Loader:** `src/lib/workflows/site-tools/custom-tool-loader.ts`
  `loadCustomTools()` — runs ONCE at startup, registers only `enabled=true`
  rows. Disabling in DB alone does NOT unregister from the running process;
  the admin PATCH route handles the live `unregister()`.
- **Admin API:** `PATCH /api/admin/tools/[name]` `{enabled: boolean}` (DB flip +
  live `unregister()` on disable; re-enable needs a process restart) and
  `DELETE /api/admin/tools/[name]` (permanent). UI at `/admin/ai/tools`.

## The bridge gap (as of 2026-08-07)

`create_tool`, `list_custom_tools`, `delete_tool` exist as handlers in
`src/lib/workflows/site-tools/meta-tools.ts` but are wired ONLY into the
general-chat toolset-activation surface (`META_TOOL_DEFINITIONS`) — they are
NOT registered site-tools, so `jkai_extended({operation:'invoke', name:
'list_custom_tools'})` returns `unknown tool`. There is NO bridge-callable way
to list or disable custom tools yet. The fix (in flight at time of writing):
expose `custom_tool_list` + `custom_tool_set_enabled` as registered site-tools
mirroring the admin PATCH logic. Until that lands, curation means either the
admin UI or direct DB mutation (last resort, needs approval + backup).

## Inspection (read-only, safe)

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -c \
   \"SELECT name, description, enabled, run_count, error_count FROM custom_tools \
     WHERE name IN ('<tool1>','<tool2>') ORDER BY name;\""
```

`run_count`/`error_count` are the evidence for "error-prone tool": e.g. the old
`reverse_geocode` had 572 runs / 398 errors (~70% failure) while its documented
replacement `reverse_geocode_osm` exists alongside it — both live at once is a
discovery-friction smell.

## Before disabling any custom tool — check workflow dependencies

A tool-call node or LLM prompt in a workflow may reference the tool by name.
Disabling it then breaks a canvas silently. Check first:

```sql
SELECT wn.workflow_id, w.name, wn.type, wn.label
FROM workflow_nodes wn JOIN workflows w ON w.id = wn.workflow_id
WHERE wn.config::text ILIKE '%<tool_name>%' ORDER BY w.name;
```

False positive to be aware of: a `code-execute` node may re-implement the tool
inline (e.g. sainsbury's-proximity reverse-geocodes via its own Nominatim
`fetch` in the node body) — that string match does NOT depend on the tool, so
verify the match is inside a `tool-call`/`llm-call`/`api-integration` node's
config, not free text in code.

## Verified example (2026-08-07 near-duplicate tool audit)

| Tool | Runs | Errors | Verdict |
|------|------|--------|---------|
| `reverse_geocode` | 572 | 398 (~70%) | superseded by `reverse_geocode_osm` — disable |
| `health_summary` | 0 | 0 | exact duplicate of `health_today_summary` — disable |
| `sausage_generator` | 1 | 1 | joke tool polluting catalogue search — disable |
| `health_today_summary` | 1 | 0 | keeper (used variant) |
| `reverse_geocode_osm` | 6 | 6 | keeper (the documented replacement) |

No workflow referenced any of these (the one ILIKE hit was the inline code-exec
false positive above).
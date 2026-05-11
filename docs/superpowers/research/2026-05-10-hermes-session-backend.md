# Hermes session-backend hook investigation

**Question:** Can a Postgres-backed session store be plugged into Hermes
without forking?

**Hermes tag:** v2026.5.7 (commit 498bfc7bc12a937621b4215312049b1000726df3)

## Findings

### Session storage location

- **Primary file:** `~/hermes-agent/hermes_state.py` (2669 lines).
  - Module-level globals:
    - `DEFAULT_DB_PATH = get_hermes_home() / "state.db"` (line 34) — single hard-coded SQLite file path.
    - `SCHEMA_VERSION = 11` (line 36).
    - `SCHEMA_SQL` (line 38) — `CREATE TABLE IF NOT EXISTS sessions / messages / state_meta` plus indices, with SQLite-specific column types (`REAL`, no native JSONB).
    - `FTS_SQL` and `FTS_TRIGRAM_SQL` (lines 103, 132) — SQLite FTS5 virtual tables and AFTER-INSERT/UPDATE/DELETE triggers (unicode61 + trigram tokenizers; SQLite-only feature).
- **Sole class:** `SessionDB` (line 159) — directly opens `sqlite3.connect(...)` on construction (line 188), sets `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` (lines 201–202), and runs schema bootstrap immediately.
- **Gateway-layer wrapper:** `~/hermes-agent/gateway/session.py` line 662 defines a higher-level `SessionStore` that **also hard-imports `from hermes_state import SessionDB`** (line 682) and falls back to a JSONL file at `sessions.json`. It is *not* an abstraction layer over storage — it is a domain-level cache for gateway session-key → entry mapping that delegates persistence to `SessionDB`.
- **Agent-core wiring:** `~/hermes-agent/run_agent.py` line 963 — `AIAgent.__init__(... session_db=None ...)`. The agent receives the DB by dependency injection rather than constructing it internally. This is the closest thing to a hook (see "Pluggability" below).

### API surface

The constructor injection point gives a *minimal* effective interface — the methods `AIAgent` actually calls on `self._session_db`:

| Method | Source line in `run_agent.py` |
|---|---|
| `get_session_title(session_id)` | 1782, 9482 |
| `create_session(session_id, source, ...)` | 2261, 9491 |
| `append_message(...)` | 4018 |
| `end_session(session_id, end_reason)` | 9485 |
| `get_next_title_in_lineage(...)` | 9502 |
| `set_session_title(...)` | 9503 |
| `update_system_prompt(...)` | 9506 |
| `get_session(session_id)` | 10957 |
| `update_token_counts(...)` | 12130 |

But the rest of the codebase **does not go through this injection point**. The following sites construct `SessionDB()` directly via `from hermes_state import SessionDB`, then call the full surface (FTS5 search, `list_sessions_rich`, `replace_messages`, `resolve_resume_session_id`, `bind_telegram_topic`, `vacuum`, `maybe_auto_prune_and_vacuum`, etc., approximately 70 public/internal methods total — see `hermes_state.py` lines 517–2669):

- `cli.py` (5 sites — lines 2378, 3806, 5310, 6723, 8100)
- `mcp_serve.py` line 74
- `acp_adapter/session.py` line 415
- `tui_gateway/server.py` line 341
- `hermes_cli/main.py` (5 sites — 621, 760, 813, 10168, 10348)
- `hermes_cli/web_server.py` (10 sites)
- `hermes_cli/goals.py` line 145
- `gateway/session.py` line 682
- `gateway/mirror.py` line 167
- `gateway/run.py` (3 sites — 1193, 7325, 10718)
- `gateway/platforms/api_server.py` line 778
- `tools/session_search_tool.py` line 537 (imports `DEFAULT_DB_PATH` directly)

This means the apparent injection point on `AIAgent` is a leaky abstraction: even if you slot a Postgres adapter into `AIAgent`, every other Hermes subsystem (CLI commands, web server, gateway mirror, MCP serve, ACP adapter, TUI gateway, search tool) instantiates the SQLite `SessionDB` independently and reads/writes the SQLite file directly. They would diverge from the agent's view.

### Pluggability

- [x] **Abstract base class / Protocol exists:** **No.** There is no `abc.ABC`, no `typing.Protocol`, and no interface declaration anywhere for session storage. (Hermes *does* use ABCs elsewhere — `agent/memory_provider.py:46`, `agent/context_engine.py:38`, `agent/image_gen_provider.py:51` — so the absence here is a design choice, not an oversight.)
- [x] **Backend registry exists:** **No.** There is a plugin/extension mechanism for memory providers (`~/hermes-agent/plugins/memory/{byterover,hindsight,holographic,honcho,mem0,openviking,retaindb,supermemory}/`), context engines, image generators, and model providers — but no `plugins/session_store/` and no entry-point group for session backends. `pyproject.toml` declares no entry-points group (line 145 only lists package roots).
- [x] **Config-selectable backend:** **No.** No env var or config key picks the backend. The `HERMES_SESSION_*` env vars (`HERMES_SESSION_KEY`, `HERMES_SESSION_PLATFORM`, `HERMES_SESSION_CHAT_ID`, etc., e.g. `tests/conftest.py:170`) are runtime *context* (which platform/chat the session is on), not backend selectors. `DEFAULT_DB_PATH` is settable via the `HERMES_HOME` env var on `get_hermes_home()`, but only the *path* of the SQLite file — not the engine.
- [x] **Methods small enough to override cleanly:** **No.** The class is 2510 lines with ~70 methods that include SQLite-coupled features that have no Postgres analogue:
  - `PRAGMA journal_mode=WAL`, `PRAGMA wal_checkpoint(PASSIVE)`, `PRAGMA foreign_keys=ON` (lines 201–202, 270–272, 290).
  - `BEGIN IMMEDIATE` transaction model with retry-on-`database is locked` (lines 227, 244–251).
  - `_parse_schema_columns` opens an in-memory `sqlite3.connect(":memory:")` to derive column metadata from `SCHEMA_SQL` for declarative ALTER TABLE reconciliation (lines 296–337).
  - `_reconcile_columns` runs `PRAGMA table_info` to diff the live schema against `SCHEMA_SQL` and emits `ALTER TABLE ... ADD COLUMN` (lines 339–381).
  - FTS5 virtual tables with `unicode61` and `trigram` tokenizers, plus AFTER-INSERT/UPDATE/DELETE triggers that maintain the index (lines 103–156). FTS5 is SQLite-only; a Postgres adapter would have to implement the same query semantics on top of `tsvector` + GIN indexes (or pg_trgm for substring/CJK) and re-implement the trigger logic in application code.
  - Schema-version migrations 10 → 11 perform DROP TRIGGER + DROP TABLE + executescript + INSERT … SELECT backfill (lines 423–488), with SQLite-specific syntax (`executescript`).
  - Connection-level state: `self._conn` is a single shared `sqlite3.Connection` with `check_same_thread=False`, which doesn't translate to a Postgres connection (would need a pool).
  - Error-handling on `sqlite3.OperationalError` is sprinkled through ~15 sites (lines 242, 359, 374, 431, 456, 461, 496, 502, 508, 1838, 1880, 2367, 2383, 2406, 2492, 2538) — each would need rewriting against `psycopg.errors`.
- The class is also self-bootstrapping on construction: `SessionDB.__init__` immediately opens the SQLite connection and runs `_init_schema()` (line 204). There is no factory, no lazy connection, and no place to inject a different connection object. To swap backends you would have to change every call site that does `SessionDB()` (≈30 sites listed above) and ship a parallel implementation of every method that the call sites use, including the FTS5 path used by `tools/session_search_tool.py`.

### Verdict

**D-no: Fork required. Lock in option A (dual-store, MCP bridge). No further work in Phase 0.**

A Postgres-backed `SessionDB` substitute is technically possible only via a hostile fork:

1. Introduce an `abc.ABC` for the storage interface and rewrite ~30 direct-import call sites to go through a factory.
2. Reimplement FTS5 (unicode61 + trigram) on Postgres using `tsvector`/`pg_trgm`, including the AFTER-INSERT/UPDATE/DELETE trigger semantics that downstream code (e.g. `tools/session_search_tool.py`) depends on.
3. Reimplement the schema-version migration runner, `_reconcile_columns`, and the in-memory `:memory:` parsing trick with Postgres-equivalent introspection (`information_schema`).
4. Maintain that fork against upstream Hermes (which adds session-DB columns and migrations roughly every minor release — e.g. v11's tool_name/tool_calls FTS reindex, v10's trigram tokenizer addition, plus all the columns added since v8).

That is a multi-week project that creates an indefinite maintenance tax, in service of removing one moving part. The dual-store + MCP bridge in the spec's section 3 is the right call.

### If D-yes — spike

**Not applicable.** Verdict is D-no. No spike performed.

### Decision

We are proceeding with **option A** (Hermes owns its SQLite under `~/.hermes-jkai/state.db`; Postgres remains canonical for jkai's app state; cross-system communication via MCP tool calls), per [the spec's section 3, "State boundary"](../specs/2026-05-10-hermes-replacement-design.md#state-boundary). No spec change required.

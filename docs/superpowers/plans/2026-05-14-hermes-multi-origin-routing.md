# Hermes multi-origin routing — plan

> **Goal:** Let `strangeramblings.com/jkai` route through to the single Hermes instance running on homeserv, while keeping per-origin data correctness (VPS-originated chats write to VPS Postgres; homeserv-originated chats write to homeserv Postgres). No new Hermes install on the VPS; no DB merge; no new public ports on the home router.

> **Phase 0 status:** DONE. See findings below.

## Phase 0 findings (2026-05-14)

Investigation of how chat context flows through Hermes's MCP layer.

1. **Hermes has task-local session contextvars** (`gateway/session_context.py`):
   - `_SESSION_CHAT_ID`, `_SESSION_PLATFORM`, `_SESSION_USER_ID`, `_SESSION_KEY` etc.
   - Set by `gateway/run.py:13086` (`set_session_vars(...)`) before invoking each message handler.
   - Task-local, so concurrent sessions don't collide.
   - Readable from anywhere inside the agent's task via `get_session_env("HERMES_SESSION_CHAT_ID")`.

2. **The MCP HTTP client uses httpx with `event_hooks` support** (`tools/mcp_tool.py:1368`):
   - Today it registers a `response` hook to strip `Authorization` on cross-origin redirects.
   - httpx also supports `request` hooks that run synchronously before the outgoing HTTP request, and can mutate the request (including adding headers).
   - This is the injection point: a request hook reads `_SESSION_CHAT_ID` from contextvars and adds `X-Hermes-Chat-Id` to every outgoing MCP tool call.

3. **Hermes does NOT pass chat_id in MCP `_meta` or in `arguments` natively** — `call_tool(name, arguments=args)` ships only the LLM-supplied args. Without our hook, the MCP server has no way to know which chat originated the call.

**Implication:** The routing proxy can live entirely in SvelteKit. The Hermes side only needs one tiny hook to add the `X-Hermes-Chat-Id` header on outgoing tool calls — implemented as a monkey-patch in our `jkai_platform` plugin, so we don't have to fork Hermes.

## Architecture (revised)

```
                        ┌──────────────────────────────────┐
 USER (prod)            │  VPS  157.180.19.38              │
   │ HTTPS              │   strangeramblings.com           │
   ▼                    │   SvelteKit (port 4173)          │
 ┌────────────┐  POST   │   ├─ /api/workflows/orch/chat ───┼──┐
 │ /jkai page │ ──────▶ │   │  (forwards to homeserv       │  │
 └────────────┘         │   │   Hermes when                │  │
                        │   │   JKAI_HERMES_CANVAS_CHAT=1) │  │
                        │   │                              │  │
                        │   └─ /api/mcp/local              │◀─┼──┐
                        │      (writes to VPS Postgres)    │  │  │
                        └──────────────────────────────────┘  │  │
                                                              │  │ tool call
                                       ┌──────────────────────┘  │ (routed by
                                       │ inbound (Tailscale)     │  proxy
                                       ▼                         │  based on
                        ┌──────────────────────────────────┐     │  X-Hermes-
                        │  HOMESERV  100.64.0.1            │     │  Chat-Id)
                        │                                  │     │
                        │   SvelteKit (port 5173)          │     │
                        │   ├─ /api/mcp  (routing proxy)   │◀────┘
                        │   │   reads X-Hermes-Chat-Id     │
                        │   │   looks up origin in DB      │
                        │   │   forwards to local OR VPS   │
                        │   └─ /api/mcp/local              │
                        │      (writes to homeserv PG)     │
                        │                                  │
                        │   jkai_platform plugin           │
                        │   ├─ /platforms/jkai/msg ────────┤
                        │   │   writes (chat_id, origin)   │
                        │   │   row to hermes_chat_origin  │
                        │   ├─ /platforms/jkai/out         │
                        │   └─ httpx hook on MCP client    │
                        │      injects X-Hermes-Chat-Id    │
                        │      from session contextvar     │
                        │                                  │
                        │   Hermes gateway (single)        │
                        │   mcp_servers.jkai.url:          │
                        │     http://127.0.0.1:5173/api/mcp│
                        │   tool call ─────────────────────┘
                        └──────────────────────────────────┘
```

**Inbound flow (VPS-originated chat):**

1. User POSTs message to VPS `/api/workflows/orchestrator/chat`.
2. VPS (with `JKAI_HERMES_CANVAS_CHAT=1`) forwards inbound to
   `POST https://homeserv.tail668b8c.ts.net:18790/platforms/jkai/msg`
   payload includes `origin: "vps"` and `mcp_url: "https://strangeramblings.com/api/mcp/local"`.
3. `jkai_platform.handle_inbound` writes
   `INSERT INTO hermes_chat_origin (chat_id, origin, mcp_url, ts) ON CONFLICT (chat_id) DO UPDATE`
   to homeserv Postgres.
4. Hermes runs the agent. When it calls a tool, the patched httpx client
   adds `X-Hermes-Chat-Id: <chat_id>` to the outgoing request.
5. Homeserv SvelteKit `/api/mcp` reads the header, queries
   `hermes_chat_origin` for the origin, forwards the JSON-RPC to either
   `http://127.0.0.1:5173/api/mcp/local` (homeserv-local) or
   `https://strangeramblings.com/api/mcp/local` (VPS) — with the bridge bearer.
6. Tool result returns to Hermes.
7. Hermes streams the reply via `/platforms/jkai/out`. VPS is already
   subscribed via the existing SSE channel — streams to user's browser.

**Outbound flow:** unchanged — VPS subscribes to homeserv's
`/platforms/jkai/out` SSE over Tailscale.

**Why this is correct:**

- The chat_id flows from VPS → plugin (records origin) → Hermes (sets
  contextvar) → httpx hook (puts in header) → SvelteKit proxy (looks up
  origin) → right MCP backend.
- The DB read in the proxy is a single-row lookup keyed by primary key,
  cached behind a small LRU. Microseconds.
- Tool writes land in the correct Postgres because the proxy forwarded
  the JSON-RPC to the right host.

**Latency budget per round-trip:**

- VPS → homeserv (Tailscale): ~5-10ms
- Hermes processes + LLM call: 1-3s (unchanged)
- httpx hook: <1ms
- SvelteKit proxy lookup + forward: ~3-5ms
- Tool execution at correct backend: same as today
- Hermes outbound stream → VPS → browser: ~5-10ms

Net added vs. all-on-one-host: ~15-25ms. Imperceptible against multi-
second LLM + tool work.

## Phase 1 — VPS-side forwarding (~3 hr)

The VPS sends chats to homeserv Hermes; subscribes to homeserv's SSE outbound.

**Files:**
- Modify (VPS): `src/lib/jkai/hermes-client.ts` — already exists; baseUrl driven by `HERMES_PLATFORM_URL`
- Modify (VPS): `src/routes/api/workflows/orchestrator/chat/+server.ts` — gate behind `JKAI_HERMES_CANVAS_CHAT=1`, inject `origin: "vps"` and `mcp_url: "https://strangeramblings.com/api/mcp/local"` in the `sendMessage` request
- Add to VPS `.env`:
  - `JKAI_HERMES_CANVAS_CHAT=1`
  - `HERMES_BRIDGE_SECRET=<same as homeserv>`
  - `HERMES_PLATFORM_URL=https://homeserv.tail668b8c.ts.net:18790`
  - `PUBLIC_SITE_URL=https://strangeramblings.com` *(not strictly needed since fallback is the same, but explicit for clarity)*

- [ ] **Step 1.1: Tailscale reachability check**
  - On VPS: `curl -s https://homeserv.tail668b8c.ts.net:18790/platforms/jkai/health`
  - Expected: `{"ok":true,"ts":…}`
  - If fails: check Tailscale ACLs allowing VPS node → homeserv:18790

- [ ] **Step 1.2: Extend `SendMessageRequest` shape**
  - Add `origin: 'vps' | 'homeserv'` and `mcp_url: string` to `SendMessageRequest` in `hermes-client.ts`
  - Forward both fields in the POST body to `/platforms/jkai/msg`

- [ ] **Step 1.3: VPS chat handler injects origin/mcp_url**
  - In `+server.ts`'s `handleWithHermes`, populate `origin: "vps"` and `mcp_url: "https://strangeramblings.com/api/mcp/local"` from env
  - Default `origin: "homeserv"` and `mcp_url: "http://127.0.0.1:5173/api/mcp/local"` when running on homeserv (env-driven; same code path)

- [ ] **Step 1.4: End-to-end smoke (no tools yet)**
  - From VPS browser: send a "hello" chat
  - Tail Hermes logs on homeserv: expect inbound with `origin=vps`
  - Reply streams back to VPS browser

**Exit criterion:** VPS user can chat with Hermes; sees reply; no tool calls exercised yet.

## Phase 2 — Hermes-side header injection (~1 hr)

Monkey-patch from the jkai_platform plugin so every outgoing MCP tool call carries `X-Hermes-Chat-Id` from the session contextvar.

**Files:**
- Add: `~/.hermes-jkai/extensions/jkai_platform/mcp_session_headers.py`
- Modify: `~/.hermes-jkai/extensions/jkai_platform/__init__.py` (apply patch at plugin load)

- [ ] **Step 2.1: Write the request hook**
  - File: `mcp_session_headers.py`
  - Function signature: `async def inject_session_headers(request: httpx.Request) -> None`
  - Body: read `get_session_env("HERMES_SESSION_CHAT_ID")`, if non-empty set `request.headers["X-Hermes-Chat-Id"]` to that value

- [ ] **Step 2.2: Monkey-patch `streamable_http_client` from plugin init**
  ```python
  # __init__.py
  from . import mcp_session_headers
  import tools.mcp_tool as _mcp
  _orig = _mcp.streamable_http_client
  
  def _patched(url, *, http_client, **kw):
      hooks = http_client.event_hooks or {}
      req_hooks = list(hooks.get("request", []))
      if mcp_session_headers.inject_session_headers not in req_hooks:
          req_hooks.append(mcp_session_headers.inject_session_headers)
      http_client.event_hooks = {**hooks, "request": req_hooks}
      return _orig(url, http_client=http_client, **kw)
  
  _mcp.streamable_http_client = _patched
  ```
  - Apply at module import time (plugin gets loaded before MCP servers connect)
  - Patch is idempotent (won't double-append if reloaded)

- [ ] **Step 2.3: Verify header lands on the MCP server**
  - Temporarily add `console.log(event.request.headers.get('x-hermes-chat-id'))` in `src/routes/api/mcp/+server.ts`
  - Restart Hermes (`systemctl --user restart jkai-hermes.service`)
  - Send a homeserv chat that calls a tool
  - Check homeserv SvelteKit logs: should see the chat_id value
  - Remove the temp log

**Exit criterion:** Every MCP tool call hitting homeserv's `/api/mcp` carries `X-Hermes-Chat-Id`.

## Phase 3 — SvelteKit routing proxy + origin table (~4 hr)

Refactor `/api/mcp` on homeserv to be the routing proxy; move the actual tool dispatch to `/api/mcp/local`.

**Files:**
- Move: existing `src/routes/api/mcp/+server.ts` → `src/routes/api/mcp/local/+server.ts` (identical content; just relocate)
- Rewrite: `src/routes/api/mcp/+server.ts` → thin routing proxy
- Add: Drizzle table `hermes_chat_origin` in `src/lib/db/schema.ts`
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py` — on `handle_inbound`, upsert `(chat_id, origin, mcp_url)` to homeserv Postgres

### Schema

- [ ] **Step 3.1: Add `hermes_chat_origin` table**
  ```ts
  export const hermesChatOrigin = pgTable('hermes_chat_origin', {
    chatId: text('chat_id').primaryKey(),
    origin: text('origin').notNull(), // 'vps' | 'homeserv'
    mcpUrl: text('mcp_url').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  });
  ```
  Run `npx drizzle-kit push` to apply.

### Plugin write path

- [ ] **Step 3.2: jkai_platform writes origin on inbound**
  - In `adapter.py` `handle_inbound`, take `origin` and `mcp_url` from the metadata payload (Phase 1 already adds them)
  - Use asyncpg (already a Hermes dep) to upsert to homeserv Postgres
  - Connection string from `HOMESERV_PG_URL` env (or reuse Hermes's PG if it shares one — check)
  - Upsert SQL: `INSERT … ON CONFLICT (chat_id) DO UPDATE SET origin = EXCLUDED.origin, mcp_url = EXCLUDED.mcp_url, updated_at = NOW()`

### SvelteKit routing proxy

- [ ] **Step 3.3: Build the proxy at `src/routes/api/mcp/+server.ts`**
  - On POST:
    1. Verify `Authorization: Bearer ${HERMES_BRIDGE_SECRET}` (same as today)
    2. Read `X-Hermes-Chat-Id` header
    3. If absent → forward to local (`http://127.0.0.1:5173/api/mcp/local`) as default
    4. If present → look up `hermes_chat_origin` row (LRU cache, 1000 entries, 5-min TTL)
    5. Pipe the request body to the chosen URL with the same bearer header
    6. Stream the response back

- [ ] **Step 3.4: Move actual tool dispatch to `/api/mcp/local/+server.ts`**
  - Bit-for-bit copy of the current `/api/mcp/+server.ts` (the JSON-RPC dispatcher)
  - Same auth check (bridge bearer)
  - Same tool registry

- [ ] **Step 3.5: Update Hermes config**
  - `~/.hermes-jkai/config.yaml`: `mcp_servers.jkai.url` stays at `http://127.0.0.1:5173/api/mcp` (no change — it's now the routing proxy)
  - Restart Hermes

- [ ] **Step 3.6: End-to-end test from homeserv**
  - Chat on `homeserv.tail668b8c.ts.net/jkai` → "build me a workflow…"
  - Verify the new row in **homeserv** `workflows` table
  - Verify the canvas URL in the reply uses `homeserv.tail668b8c.ts.net` (PUBLIC_SITE_URL on homeserv)

- [ ] **Step 3.7: End-to-end test from VPS**
  - Chat on `strangeramblings.com/jkai` → "build me a workflow…"
  - Verify the new row in **VPS** `workflows` table
  - Verify the canvas URL uses `strangeramblings.com` (fallback on VPS)
  - Verify NO new row in homeserv `workflows`

**Exit criterion:** Cross-origin data routing works in both directions with no cross-contamination.

## Phase 4 — Deploy & soak (~1 hr)

- [ ] **Step 4.1: Extend `scripts/deploy.sh`** to ensure `JKAI_HERMES_CANVAS_CHAT=1`, `HERMES_BRIDGE_SECRET`, `HERMES_PLATFORM_URL` are present in VPS `.env`. Same pattern as the existing `JKAI_BUILDS_HOSTMODE` check.
- [ ] **Step 4.2: Run `deploy.sh`**
- [ ] **Step 4.3: Confirm on prod**
  - Chat from `strangeramblings.com/jkai` lands in homeserv Hermes logs with `origin=vps`
  - Reply streams back
  - Tool call writes to VPS DB
- [ ] **Step 4.4: 24-hour soak**
  - Watch for: stale chat_id rows (Phase 5 cleanup), Tailscale flaps, Hermes crashes, proxy 5xx
  - Track latency at the proxy via a small histogram metric

## Phase 5 — Cleanup (~1 hr, can defer)

- [ ] **Step 5.1: Add cron to prune `hermes_chat_origin` rows older than 30 days**
- [ ] **Step 5.2: Document the topology in `~/strange_rambling_svelte/CLAUDE.md`** (one paragraph)
- [ ] **Step 5.3: Remove the temp logging stub from Step 2.3 if not already done**

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Hermes on homeserv goes down → /jkai dies on both hosts | VPS chat handler catches the inbound POST failure, returns "jkai temporarily unavailable" cleanly instead of 504 |
| Plugin monkey-patch breaks on Hermes upgrade | Pin Hermes version (already pinned to v2026.5.7); the patch is small enough to re-verify quickly |
| Bridge secret leak (single secret across hosts) | Rotate periodically via deploy.sh; long-term move to per-host signed tokens |
| Tailscale ACL too permissive | Lock homeserv:18790 to VPS Tailscale identity only |
| chat_id missing from a tool call (e.g. cron-triggered, no chat context) | Proxy falls back to local routing; safe default since homeserv hosts all background work today |
| Stale `hermes_chat_origin` row outlives the chat | Daily cron prune at Phase 5; ON CONFLICT DO UPDATE keeps the latest origin if a chat resumes |
| DB connection from the plugin saturates Postgres | Plugin uses a small async pool (asyncpg, max_size=5); upserts are infrequent (one per inbound) |

## Out of scope

- DB consolidation across hosts (separate effort if ever)
- Per-user rate limiting at Hermes layer
- Patching Hermes core (we use a plugin monkey-patch instead)
- Public exposure of homeserv via Caddy proxy (option 2 from the brainstorm — explicitly rejected)
- Second Hermes instance on VPS (option 1 from the brainstorm — explicitly rejected)

## Rollback

If routing breaks badly:
1. Set `JKAI_HERMES_CANVAS_CHAT=0` on VPS `.env`, restart VPS service. VPS reverts to the legacy in-process orchestrator.
2. Restore the previous `src/routes/api/mcp/+server.ts` (which dispatches directly) from git; deploy.
3. Unload the monkey-patch by removing it from `~/.hermes-jkai/extensions/jkai_platform/__init__.py`; restart Hermes.
4. Homeserv chats keep working via the existing Hermes setup.

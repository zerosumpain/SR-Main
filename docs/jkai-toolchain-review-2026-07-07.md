# jkai Toolchain Review — capability, separation, equipping & tool-call efficiency

_2026-07-07. Scope: how the jkai LLM is equipped with tools and calls them; the grouping/structure of the tool system; MCP-vs-direct balance; site-feature coverage. Based on a full read of `src/lib/workflows/site-tools/**`, `src/lib/mcp/**`, `src/lib/jkai/**`, `src/lib/workflows/chat/general-chat.ts`, and the orchestrator paths._

---

## 1. Executive summary

The core design is **sound**: there is **one canonical tool catalog** — the in-memory `site-tools` registry (115 statically-registered tools across 17 toolsets, 24 files) — and every consumer (legacy chat loop, Hermes, pi builder, MCP) ultimately dispatches through the same `executeTool()`. The much-feared "MCP duplicates the registry" problem **does not exist**: the MCP server is a thin, auto-generated projection of the registry. The tiered **toolset-activation** model (start with 5 meta-tools, load domains on demand) is a genuinely good answer to the too-many-tools problem.

The problems are at the **edges and the seams**, and they cluster into five themes:

1. **No prompt caching + intra-turn cache-key churn** — the single biggest efficiency loss. Tool defs and a large system prompt are re-billed every round (up to 50 rounds on a canvas build), and `activate_toolset` mutating the live tool array invalidates any provider prefix-cache mid-turn.
2. **A confirmation gate that is misaligned with real risk** — hardcoded name-list with 2 phantom entries, real production-shipping tools ungated, enforced in only 1 of 3 engines, and bypassable via the scheduler.
3. **Two chat engines, but one has already won.** `JKAI_HERMES_CANVAS_CHAT=1` in the deployed `.env` on **both** homeserv and the VPS (verified 2026-07-07; the `.env.example`=0 and the "OFF by default" code comment are stale relative to the live config), and `jkai-hermes` is active on homeserv and reachable from the VPS over Tailscale. So **Hermes is the live production chat engine**; the ~1,100-line `general-chat.ts` ReAct loop is now the **dormant fallback** (runs only if the flag is `0`). The problem is the codebase still carries and maintains the entire losing engine — every chat feature built twice, plus a telemetry-reconciliation layer (`isBusServedTool`/`sse-adapter`) that exists only to de-dupe the two tool-event streams on the Hermes branch. The opportunity is to *retire* Engine A, gated on first moving the confirmation gate out of it (see §7.1/P0).
4. **Grouping/naming drift** — the `system` toolset is a 3-in-1 junk drawer mislabelled as "Follow-up scheduling"; `node-builder` has no manifest description; `publish_page` and the ephemeral code-exec tools are mis-filed; naming conventions are inconsistent across ~115 tools.
5. **Coverage gaps on the analytical/ops surfaces** — the model can drive its AI-native features (blog, canvas, research, builds, drive-read, Gmail, HA, memory) but is **blind** to `/live` presence, `/monitor` policy-engine data, the DfE/keystone project datasets, `/admin/access`, projects visibility, and general deploy.

None of this needs a rewrite. It needs about a dozen surgical changes, most of them S/M effort. Prioritised roadmap in §8.

---

## 2. How the toolchain works today (the mechanism)

### 2.1 One catalog, many projections

```
tools/*.ts  ──register()──►  tools[]  (registry-internal.ts, module-global singleton)
                                 │
   ┌──────────────┬─────────────┼───────────────┬────────────────────┐
getToolDefinitions  getToolsetDefinitions   getToolsetManifest   executeTool(name,args,ctx)
  (all 115, flat)   (per-toolset, OpenAI fn)  (compact, per-toolset)   (single dispatch)
        │                  │                        │                       ▲
   SITE_TOOL_DEFS      general-chat            jkai_help / MCP        ALL engines call this
   (DEAD: 0 importers)  activation             manifest
```

A `ToolDefinition` = `{ name, description, parameters (JSON-schema), category (display-only), toolset (grouping key), handler, producesLongRunningTask? }`. Each domain module calls `register()` as an import side-effect; `registry.ts` imports all 24 modules, so importing it populates the singleton.

### 2.2 How the model is *equipped* per turn (general chat — the live path)

In `general-chat.ts` the per-turn `activeTools` array is assembled **before round 0**:

- `META_TOOL_DEFINITIONS` (5: `activate_toolset`, `jkai_help`, `create_tool`, `list_custom_tools`, `delete_tool`) — always. These are **not** in the registry; their handlers are dispatched by name.
- `system` toolset (11 tools) — always-on.
- `agent_spawn` — top-level orchestrator turns only.
- `visualise` (5) — always-on.
- **classifier-inferred toolsets** — `inferToolsets(userMessage)` runs 14 regexes and pre-pushes matched toolsets **with no model round-trip**.
- `workflows` (24) — pushed when a canvas `workflowId` is set.

So the common case is ~22 defs (~2–2.6k tokens), not the full 115 (~11–15k). The model can also call `activate_toolset(name)` mid-turn; the handler `push`es that toolset's defs into the live `activeTools` array so they're callable next loop iteration. `create_tool` compiles a model-written JS string into an `AsyncFunction('args','fetch','platform', code)` and registers + persists it live (`platform.call` composes other tools, depth-guarded to 5).

### 2.3 Three engines, one catalog

The name "jkai orchestrator" covers **two unrelated things**, and there are **three tool-calling engines** in total:

| Engine | Where | Tools it uses | Status |
|---|---|---|---|
| **A — legacy in-repo ReAct loop** | `general-chat.ts` (~1100 lines), via `/api/workflows/orchestrator/chat` | site-tools via activation + meta-tools | **dormant fallback** — runs only if `JKAI_HERMES_CANVAS_CHAT=0`; deployed value is `1` on both hosts |
| **B — Hermes external agent** | `hermes-client.ts` → Hermes gateway (single instance on homeserv :18790), calls back via `/api/mcp/local` | same site-tools over **MCP** (as "skills"), + Hermes' own sub-agents/approval/session-store | **LIVE — the production chat engine** (flag=1 on homeserv + VPS; `jkai-hermes` active, reachable VPS→homeserv over Tailscale). VPS forwards turns with `origin=vps`; tool calls route back to `strangeramblings.com/api/mcp/local` |
| **C — pi builder subprocess** | `jkai/orchestrator.ts` (the *builder* state machine) → `pi-runner.ts` | pi's **own native tools** (read/bash/edit/write/grep/find/ls) + a bridge that re-registers site-tools as pi tools via `/api/jkai/tools/manifest`→`/invoke` | live for autonomous builds |

All three converge on `executeTool`, through **four different auth paths**: in-process (A), `HERMES_BRIDGE_SECRET` bearer over MCP (B), `JKAI_BRIDGE_SECRET` HMAC over HTTP (C), plus `mintBridgeToken` for the Hermes message channel.

### 2.4 MCP subsystem

`src/lib/mcp/` is a JSON-RPC (MCP Streamable-HTTP) adapter that exposes the **same registry** to Hermes over one URL. `toolToMcp` maps `def.parameters → inputSchema` with **zero re-declaration**. Consumers are **internal** (Hermes calling back into the site), *not* external Claude Desktop/Code clients. When `JKAI_MCP_META_TOOL=1`, it advertises only 6 "essentials" + a `jkai_extended` meta-tool (list/schema/invoke) to cut the manifest from ~28k → ~3k prompt tokens.

---

## 3. Assessment against the brief

| Question | Verdict | One-line |
|---|---|---|
| **Capability** | Strong on AI-native surfaces, weak on analytical/ops surfaces | 115 tools cover blog/canvas/research/builds/drive-read/Gmail/HA/memory/media well; `/live`, `/monitor`, project datasets, access-control, deploy are uncovered. |
| **Separation** | Catalog separation is excellent; *engine* separation is the liability | One registry, thin MCP adapter = good. But Hermes is now live in prod while the legacy Engine A is still carried + maintained (two meta-tool discovery systems, three auth schemes, a telemetry-reconciliation layer) = dead-weight duplication to retire, not a migration to await. |
| **Equipping mechanism** | Good design, leaky execution | Tiered activation is right; but the hot path front-loads eagerly, over-broad regexes over-activate, and misses (gmail/node-builder) cost 1–3 reasoning round-trips. |
| **Efficiency** | One big miss + several small ones | No app-side prompt caching; `activate_toolset` churns the cache key mid-turn; blunt 32KB result clip with no summarisation. |
| **MCP vs direct balance** | Right split already; the gap is *external* MCP | Registry-canonical + MCP-auto-adapter is correct. In-house reimplements commodity web-fetch/search; Google Calendar is an uncovered gap; no external MCP wired into Hermes. |
| **Feature coverage** | Partial | ~70% of flagship features reachable; the highest-value gaps are analytical/live data the assistant can't read. |

---

## 4. Efficiency findings & fixes

**F1 — No app-side prompt caching `[high]`.** No `cache_control` anywhere in the LLM path. On a 30-round canvas build the same ~11–15k tokens of tool defs + system prompt are transmitted and billed ~30×. → **Add cache breakpoints after the system-prompt+tools block; pre-resolve the turn's full toolset needs once and freeze the `activeTools` array for the whole turn.**

**F2 — `activate_toolset` churns the per-turn cache key `[high]`.** Mid-turn `activeTools.push()` means round N+1's payload differs from round N's, invalidating any provider prefix-cache — the same cache-key-churn class the project has hit before. → Fixed by the freeze in F1 (pre-resolve instead of live-mutate).

**F3 — Over-broad classifier regexes over-activate `[medium]`.** `health` matches bare `run`/`activity`; `blog`/`builds` both match `publish`. "publish my blog post as an app" trips blog+builds+workflows at once. → Narrow with word-boundaries + intent anchoring; add a small eval set.

**F4 — Classifier *misses* cost 1–3 round-trips `[medium]`.** `gmail` (8) and `node-builder` (7) have **no** classifier pattern; the phantom `geo` pattern activates zero defs yet marks itself activated. Each miss = a full extra reasoning round (10–180s on GLM). → Add gmail/node-builder patterns; delete `geo`.

**F5 — Blunt 32KB result clip, no summarisation `[medium]`.** Large results (research reports, `file_read`, scraped HTML) accumulate raw and can silently cross the 160k-char threshold that escalates to the pricier thinking model. → Size-aware summarise: keep head+summary in-context, stash full payload behind a retrievable id.

**F6 — Confirm/enable `JKAI_MCP_META_TOOL=1` on the VPS `[medium]`.** If still off, every Hermes turn prefills the full ~28k-token manifest. Measured ~28k→~3k win, behaviour-transparent.

**F7 — Dead + duplicate projections `[medium]`.** `SITE_TOOL_DEFINITIONS` (all 115) is computed eagerly at module load with **zero importers** (foot-gun). `HA_TOOL_DEFINITIONS` is an exact 5-tool duplicate of the `home` toolset. → Delete the dead export; fold HA defs into the `home` toolset.

**F8 — Activated toolsets are per-request only `[low]`.** A toolset the model deliberately activated in message N is gone in N+1 unless the classifier re-matches. → Persist activated toolsets on the conversation record and seed the next turn.

---

## 5. MCP vs direct-tool balance

**The good news, stated plainly:** the registry *is* the single source of truth and MCP auto-derives from it. Do **not** try to eliminate the MCP server — it carries no tool duplication; it is the transport to Hermes.

The real issues on this axis:

- **B1 — Trust-boundary asymmetry `[high]`.** The confirmation gate is enforced only in Engine A (`general-chat.ts`). The MCP dispatch and pi bridge call `executeTool` directly and never consult it — so `gmail_send`, `publish_page`, `node_builder_commit_and_deploy` fire **ungated over MCP**. → Move the gate to the `executeTool`/registry boundary (a shared pre-dispatch hook), keyed off a per-`ToolDefinition` `destructive` flag.
- **B2 — Flat-secret authority `[high]`.** MCP `tools/call` auth is a single static bearer with no per-tool scoping and self-asserted `workflow_id`. Any secret-holder can invoke all 115 tools. → Derive an allowed-tool set from the token scope (the `mcp/auth` kind model already exists for the outbound direction); scope the pi builder to build-relevant toolsets.
- **B3 — Commodity reimplementation vs the real gap `[medium]`.** In-house `fetch_url` + `research_web_search` (Tavily) duplicate standard web MCP capability, while **Google Calendar** has no in-house equivalent at all. Zero external MCP servers are wired into Hermes. → **Division-of-labour rule:** first-party direct tools for anything bound to the site's own DB/schema (keep these bespoke — no external MCP knows the schema); delegate commodity capabilities (calendar, library-docs) to external MCP servers mounted in Hermes. Keep `gmail_*` bespoke (multi-account OAuth store) but adopt the Gmail MCP's **draft-first** safety pattern.

---

## 6. Grouping & structure

**Verdict: keep the 17-toolset shape and the flat wire-names; fix labels, assignments, and naming — no namespace rewrite.** ~80% of tools already prefix their domain (`blog_`, `workflow_`, `ha_`), so a de-facto namespace exists; formalise the prefix rule instead of introducing dotted `domain.action` names (which OpenAI/MCP function-calling doesn't want anyway).

Findings:
- **`system` is a 3-in-1 junk drawer `[high]`** — 11 tools = follow-up queue (3) + heartbeat (3) + scheduled callbacks (5), advertised only as "Follow-up scheduling". The model is told about ⅓ of the bucket.
- **`node-builder` has no manifest description `[high]`** — shows to the model as the bare slug `node-builder`, and contains the highest-risk tool (`node_builder_commit_and_deploy`).
- **`visualise` smuggles two code-exec meta-tools `[high]`** — `author_ephemeral_tool`/`promote_ephemeral_tool` compile arbitrary JS; `promote_` even defaults promoted tools to `visualise`, self-propagating the mis-scope.
- **`publish_page` mis-filed under `media` `[high]`** — `media` = "downloadable attachments", but `publish_page` ships a public web route.
- **Redundant `category` vs `toolset` `[medium]`** — every tool carries both; `category` is verified-unread by tool-facing code and drifts cosmetically. Delete it; derive display labels from `toolsetDescriptions`.
- **Naming inconsistency across 115 tools `[medium]`** — `noun_verb` dominates but `memory` (`save_memory`), heartbeat/scheduled (`register_heartbeat_action`, `schedule_reply_at`), and `register_hermes_build` break it; `list` placement flips (`workflow_list` vs `list_scheduled_callbacks`).
- **`workflows.ts` is 1979 lines / 24 tools `[medium]`** — 4× the next module. Split along existing seams (crud / graph / schedule / run / authoring), toolset unchanged.
- **Redundant/overlapping tools `[low-med]`** — three canvas-authoring paths (`workflow_build_from_spec` / `workflow_generate` / granular add-node); two async-watch systems (followup vs heartbeat); two web-read paths; three semantic stores (`file_search`/`research_search`/`recall_memories`); three publish paths.

Concrete rename map (ship old names as deprecated aliases for one release — **note: `schedule_tool_call_at` persists a target tool name, so aliases must resolve at fire-time or in-flight scheduled calls break**):

```
save_memory→memory_save   recall_memories→memory_search   forget_memory→memory_forget
register_heartbeat_action→heartbeat_register   complete_heartbeat_action→heartbeat_complete   list_heartbeat_actions→heartbeat_list
schedule_reply_at→schedule_reply   schedule_tool_call_at→schedule_tool_call   cancel_scheduled_callback→schedule_cancel   list_scheduled_callbacks→schedule_list
register_hermes_build→build_register_hermes
```

---

## 7. Capability coverage & safety gaps

### 7.1 The confirmation gate is the sharpest safety issue

`DESTRUCTIVE_TOOLS` (in `confirmation-gate.ts`) is a hardcoded 8-name allowlist:

- **2 phantom entries** — `web_app_publish` and `intel_note_delete` map to **no registered tool**. The gate "protects" tools that don't exist.
- **Real production-shipping tools ungated** — `publish_page`, `build_control(action=publish)`, and `node_builder_commit_and_deploy` (**pushes origin/master + deploys PRODUCTION**) have only a prompt-level "GATED" label. Also ungated: `workflow_run` (fires downstream email/WhatsApp/scrape), `workflow_clear_data_store`, `ha_call_service`, `author_/promote_ephemeral_tool` (arbitrary code exec).
- **Enforced in only 1 of 3 engines** (see B1).
- **Bypass path** — `schedule_tool_call_at` defers a call to *any* registered tool at fire time "with no LLM round", executing outside `isDestructive()`.

→ **Fix first (S effort):** delete the 2 phantom names; add `publish_page` / `build_control(publish)` / `node_builder_commit_and_deploy` / `workflow_clear_data_store` / `scraper_script_save`; route `schedule_tool_call_at` through `isDestructive()` at fire time; then relocate the gate to the `executeTool` boundary as a per-tool `destructive` flag so all engines share it.

### 7.2 Feature coverage — what the model **cannot** reach

| Gap | Impact | What a tool would wrap |
|---|---|---|
| `/live` GPS presence (`/api/live-walk`, `/api/family-presence`) | high | "where am I / are we home" from the site's own store (HA `device_tracker` is a different source) |
| `/monitor` policy-engine live tracking (`/api/policy-engine`) | high | model-vs-real DfE/ONS/World-Bank data |
| Project datasets: data-standard-designer, keystone, dfe-data-estate, broads-pilot, space-lander leaderboard | high | query/summarise substantial project APIs |
| `/admin/access` login allow-list | medium | add/remove/list guests (owner-only, gated) |
| Projects public/private visibility toggle (`/api/projects/visibility`) | medium | exact parallel to the already-tooled `blog_unpublish` |
| General site deploy (`scripts/deploy.sh`) | medium | only `node_builder_commit_and_deploy` deploys, restricted to codegen node paths |
| `/jkai/intel` knowledge base | medium | read/curate the intel graph (a write *node* exists; no chat tool) |
| `/drive` writes (upload/delete/zip), blog cover-image upload | medium | complete the write-half of already-tooled read surfaces |
| Push notifications (`/api/push`), Google Calendar | low-med | ungated lightweight notify channel; calendar via external MCP |

→ **Add a read-only `projects/analytics` toolset** wrapping the highest-value blind spots (`/api/policy-engine`, `/api/live-walk` + `/api/family-presence`, the project data endpoints) — read-only, low-risk, biggest coverage win. Then close the write-half asymmetries (drive write, visibility toggle, blog images) with per-endpoint wrappers, gating the destructive ones.

### 7.3 Duplicate tool catalogs to fold in

- `homeassistant/llm-tools.ts` — **exact** 5-name duplicate of the `home` toolset. Delete; import the registry defs. (zero behavioural risk)
- `orchestrator/tools.ts` — parallel workflow-building DSL (~11 tools). Keep its handlers (genuinely different: builds a draft graph, not `executeTool` dispatch) but source its **schemas** from the registry.
- `blog/assistant/tools.ts` — proposal-emitting inline-editor tools. Share schemas, keep the proposal handlers.

---

## 8. Prioritised roadmap

**P0 — safety (do first, mostly S):**
1. Fix `DESTRUCTIVE_TOOLS`: delete 2 phantom names, add the real prod-shipping tools, close the `schedule_tool_call_at` bypass. _(§7.1)_
2. Move the gate to the `executeTool` boundary as a per-tool `destructive` flag so MCP/pi paths can't bypass it. _(B1, M)_
3. Scope the MCP bearer + pi manifest to a tool subset. _(B2, L)_

**P1 — efficiency (high ROI):**
4. Prompt-cache breakpoints + freeze the per-turn tools array (pre-resolve, stop mid-turn mutation). _(F1/F2, M)_
5. Confirm/enable `JKAI_MCP_META_TOOL=1` on the VPS. _(F6, S)_
6. Tighten classifier regexes; add gmail/node-builder patterns; delete `geo`. _(F3/F4, S)_
7. Size-aware tool-result summarisation + orchestrator result cap. _(F5, M)_

**P2 — structure & coverage (steady cleanup):**
8. Split `system` → `followups`/`heartbeat`/`schedule`; add `node-builder` manifest description; re-file `publish_page` and the ephemeral tools; delete dead `SITE_TOOL_DEFINITIONS`; fold `HA_TOOL_DEFINITIONS`. _(§6/F7, S–M)_
9. Normalise tool names via the rename map + alias shim. _(§6, M)_
10. Split `workflows.ts` along its seams (assert count == 24 after). _(§6, M)_
11. Add the read-only `projects/analytics` toolset (policy-engine, live presence, project datasets). _(§7.2, M)_
12. Close write-half asymmetries (drive write, projects visibility, blog images); add `/admin/access` + `intel` toolsets. _(§7.2, M)_

**P3 — architecture (the flip already happened; finish the cleanup):**
13. **Retire Engine A.** Hermes is already the live prod engine (flag=1 both hosts), so `general-chat.ts` + the site-tools meta-tool discovery + the `isBusServedTool`/`sse-adapter` reconciliation layer are maintained dead weight. Delete them and collapse discovery onto `jkai_extended`. **Hard prerequisite:** P0 #2 must land first — the destructive-action gate lives *only* inside `general-chat.ts`, so deleting it before moving the gate to the `executeTool` boundary would leave publish/deploy/gmail ungated on the (already-live) Hermes path. This is the biggest one-time simplification available. _(§2.3)_
14. Adopt the division-of-labour rule (first-party direct vs delegate-to-MCP); wire Google Calendar via external MCP into Hermes. _(B3)_

---

_Appendix data (full per-tool inventory, 38-feature coverage matrix, per-subsystem maps) in the review workspace._

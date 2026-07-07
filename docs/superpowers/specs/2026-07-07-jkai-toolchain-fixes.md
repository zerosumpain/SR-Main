# Spec — jkai toolchain fixes (autonomous run)

_2026-07-07. Derived from `docs/jkai-toolchain-review-2026-07-07.md`. Full-grade autonomous build: self-approved gates, Decision Log below. Branch `jkai-toolchain-fixes`._

## Governing fact that reshapes the review's ordering

Hermes is the **live** production chat engine (`JKAI_HERMES_CANVAS_CHAT=1` on homeserv + VPS, verified). Therefore `general-chat.ts` (Engine A) is a **dormant fallback**. Consequences:
- The confirmation gate (`DESTRUCTIVE_TOOLS`/`requireConfirmation`) is a per-**job** SSE round-trip that only exists in Engine A → it does **not** protect the live path. A hard "move the gate to executeTool" would need a jobId/waiter the live path has no equivalent for, and would *break* live destructive tools. → Live-safe fix = **declarative `destructive` flag + MCP annotation Hermes can honor + soft skill-level gate**, not a hard block.
- P1 caching/summarization fixes target Engine A's loop → **moot** while Hermes is live. Dropped.
- P3 "delete Engine A" is high-risk on a live system with unverified soak items → **descoped** (foundation delivered so it can be done deliberately later).

## In scope (this run)

**P0 — safety (live-relevant foundation)**
1. Add `destructive?: boolean` to `ToolDefinition`. Flag: `publish_page`, `build_control`, `node_builder_commit_and_deploy`, `workflow_clear_data_store`, `scraper_script_save` + keep existing `workflow_delete`/`build_delete`/`scraper_script_delete`/`gmail_send`/`gmail_reply`/`whatsapp_send`. Make `isDestructive()` registry-driven (single source of truth). Remove phantom `intel_note_delete`/`web_app_publish`. Extend `describeDestructiveAction`.
2. Expose `destructive` as an MCP annotation (`annotations.destructiveHint`) in `toolToMcp` + `jkai_extended.schema` — so the **live Hermes path** can see which tools are destructive.
3. Close the `schedule_tool_call_at` gate-bypass — refuse to defer a destructive tool.
4. Hermes-side (reversible prose in `~/.hermes-jkai/`): add "confirm before calling a tool whose schema marks it destructive" to `jkai-general`/`jkai-utility` skills; refresh stale `system`-toolset prose. Commit repo + restart `jkai-hermes` + verify healthy.

**P1 — efficiency (live-relevant only)**
5. Classifier hygiene: delete phantom `geo`; add `gmail` + `node-builder` patterns; add publish/report terms so `publish_page` stays discoverable after moving toolset.
6. `JKAI_MCP_META_TOOL=1`: enable on homeserv, smoke-test a `jkai_extended` list+invoke, flip VPS iff clean (else log follow-up). Reversible.

**P2 — structure (registry health + live discovery)**
7. Delete dead `SITE_TOOL_DEFINITIONS` export (+ orphan import).
8. Delete dead `HA_TOOL_DEFINITIONS` const (KEEP file + `buildHASystemPromptSection`/`buildEntitySummary`).
9. Add `node-builder` `toolsetDescriptions` entry.
10. Split `system` toolset → `followups`/`heartbeat`/`schedule`. Update the 2 live-critical call sites (`general-chat.ts:686`, `heartbeat/llm.ts:99`) + `registry.ts` descriptions.
11. Reassign `publish_page` media→builds; ephemeral `author_/promote_ephemeral_tool` visualise→`custom-tools` + add `custom-tools` always-on push + update promote default toolset.

**P2 — coverage (additive, immediately usable by live Hermes)**
12. New `site-signals` toolset (`tools/site-signals.ts`): `live_walk_status`, `family_presence_current`, `policy_engine_indicators` — read-only, direct data-layer imports.

## Descoped (logged; follow-ups)
- **Remove `category` field** — ~120 mechanical edits, sed-risk near `jkaiMemories.category`, pure cosmetic. Low value / high churn.
- **Tool renames + alias shims** (`memory_save`, `heartbeat_register`, …) — highest blast radius (persisted `scheduledCallbacks` target-name rows), cosmetic.
- **`workflows.ts` split** (1979 lines) — mechanical, low functional value, risk of dropping a `register()`.
- **Hard-delete Engine A (P3)** — risky on live; foundation (flag+annotation+soft gate) delivered so it can be done deliberately after hard enforcement lands.
- **Hard MCP-layer gate enforcement + bearer/token scoping (P0 #2 full / #3)** — needs an approval round-trip design; risks locking out the live engine. Soft foundation delivered.
- **general-chat caching/result-summarization (P1 #4/#5)** — targets dormant Engine A; moot.
- **Write-coverage tools** (drive write, projects visibility, /admin/access, intel) — need gating decisions; additive follow-up.

## Decision Log
| # | Fork | Options | Chosen | Why | Reversibility |
|---|---|---|---|---|---|
| D1 | Gate on the live path | (a) hard-block destructive at MCP dispatch; (b) declarative flag + MCP annotation + soft skill gate | **b** | (a) needs a jobId/approval round-trip the live path lacks → would break live destructive tools; (b) is additive + honored by Hermes | Fully reversible (metadata + prose) |
| D2 | `build_control` gating granularity | (a) arg-aware (publish-only); (b) coarse `destructive:true` | **b** | static flag can't express arg-conditional; over-gating pause/resume is safe & rare | Reversible |
| D3 | Which side-effecting tools to gate | Gate review's explicit P0 list only, NOT `ha_call_service`/`ha_fire_event`/`gmail_modify_labels`/ephemeral | **Review list only** | HA device toggles are high-frequency ("turn off lights") — gating them wrecks UX; labels are low-stakes/reversible | Reversible (add flag later) |
| D4 | Retire Engine A (P3) | (a) delete now; (b) descope | **b** | live system, unverified soak items, gate lives only there; deliver foundation first | Descoped, not deleted |
| D5 | `category` removal | (a) remove ~120 lines; (b) leave | **b (leave)** | cosmetic; sed-risk near `jkaiMemories.category`; churn ≫ value | Trivially reversible |
| D6 | `JKAI_MCP_META_TOOL` prod flip | (a) flip VPS now; (b) homeserv-first smoke-test then flip iff clean | **b** | live-engine behavior change → verify before prod | Env flag, instant revert |
| D7 | Coverage toolset shape | read-only `site-signals` (3 tools) vs also writes | **read-only only** | additive, zero gating decisions, top coverage win | Reversible |

## Verification plan
- `npm run check` clean (baseline had 0 errors as of `41cf1261`).
- Targeted vitest: confirmation-gate (destructive flag), a new site-signals test, mcp meta-tool still lists.
- Registry count assertion after toolset moves (tool count unchanged).
- Live: enable meta-tool on homeserv, drive one Hermes turn calling a destructive tool → expect a confirmation ask; call `live_walk_status`/`policy_engine_indicators` → expect data.
- Ship via `scripts/deploy.sh`; verify on strangeramblings.com.

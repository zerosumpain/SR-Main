# Spec: GLM-5.2 default + gemini fallback routing, and working LLM cost tracking

**Kick-off:** "The default model should be GLM 5.2 through the z.ai subscription, with a
fallback of gemini 3.1 flash preview through openrouter. I think in a number of cases
we're using openrouter first. Find where LLMs are used across all projects and core site
functionality, what their current setting is, and then fix it. Additionally I want the LLM
cost section in admin to work - currently it's not tracking anything and it should be. Do
this autonomously."

**Grade:** Full autonomy (zero human contact until final report). Decisions logged below.

**Discovery:** exhaustive 8-agent workflow map (`llm-routing-audit`) over the 383-file LLM
surface + a full cost-tracking trace. Results drive the files-to-touch list.

## Findings (current state)

### Routing — the "openrouter first" theory is mostly a misdiagnosis
The z.ai-primary / OpenRouter-fallback architecture is **correct almost everywhere**. The
unified gateway (`getLLMClient`) keeps z.ai as the default provider and only routes
`/`-prefixed ids to OpenRouter; `workflow-gateway` and `deepdive/ai.ts` only fail over to
OpenRouter on a z.ai rate-limit / our-own-timeout. There is **one** genuine openrouter-first
chat-ish site: `file-index/describe.ts` vision (justified — glm vision is 429-gated per
`reference_glm52_agentic_slowness`; embeddings-on-OpenRouter is also legitimate since z.ai
has no embeddings endpoint).

**The real defects** are the *model ids* those correct paths resolve to:
- Every default model resolves to **glm-5.1 / glm-5-turbo — never glm-5.2** (code defaults +
  live DB settings + keys.json all pin glm-5-turbo/glm-5.1).
- The OpenRouter **fallback is `z-ai/glm-5-turbo`** (GLM-via-OpenRouter), not gemini. So the
  "OpenRouter" the user sees during z.ai rate-limits is GLM, not the intended gemini — and in
  the 2026-07-11 outage everything ran on OpenRouter GLM. That is what "using openrouter" means
  here.
- Duplicated across ~8 definition sites (constant + 3 resolver fallbacks + 3 admin-GET
  fallbacks + keys.ts).

### Cost tracking — two disconnected halves
`/admin/ops/costs` reads **only `agent_actions`** (written solely by the external-agent
`POST /api/agent/actions`). The site's own usage is captured via `installUsageCapture` →
`recordLLMCall` → `executionContext` ALS, which is a **no-op outside a workflow node**. So:
- Workflow node usage → `node_executions` (not read by the costs page).
- /jkai chat (Hermes) usage → `jkai_conversations` (not read by the costs page).
- Research / RAG / project-page / blog / intel usage → **dropped entirely** (ALS undefined).
- Streaming calls bypass capture; embeddings are never wrapped.
→ costs page sums an almost-empty table.

## Target state
- Primary default: `provider=zai, model=glm-5.2` (chat, thinking, deep-research, one-shots).
- Agentic paths (autonomous builder, Hermes delegation children, plan-debate): **glm-5-turbo**
  (glm-5.2 is ~4× slower and times out on tool-heavy delegation — documented regression).
- Fallback: `provider=openrouter, model=google/gemini-3.1-flash-lite-preview`.
- Cost: every LLM call durably recorded to `agent_actions (action_type='llm_call')` at the
  single capture chokepoint, so `/admin/ops/costs` reflects real spend.

## Decision Log

| # | Decision | Options → chosen | Why | Reversibility |
|---|---|---|---|---|
| 1 | Fallback slug = `google/gemini-3.1-flash-lite-preview` | no exact `gemini-3.1-flash-preview` on OpenRouter; candidates `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview` | only live id containing all of "3.1"+"flash"+"preview"; cheapest/fastest ($0.25/$1.5 per M), 1M ctx — ideal fallback | HIGH — one setting (`openrouterFallbackModel`) / one const |
| 2 | Agentic paths stay on **glm-5-turbo**, not glm-5.2 | glm-5.2 everywhere (literal) vs carve out agentic | glm-5.2 times out on tool-heavy delegation (`reference_glm52_agentic_slowness`, Hermes child_timeout). Coherent story: agentic=turbo, general=5.2 | HIGH — DB settings / config lines |
| 3 | Hermes chat primary → glm-5.2 (delegation → glm-5-turbo) | keep turbo vs honor "default=5.2" | user explicitly wants glm-5.2 default; Hermes supports a separate `delegation.model`, so simple chat gets 5.2 while delegations stay fast | HIGH — 1 config line; note chat is ~4× slower, flip back if disliked |
| 4 | Add `glm-5.2: ALL` to `capabilities.ts` | omit vs add | without it, glm-5.2 default silently downgrades to TEXT_ONLY → multimodal attachments break (functional regression) | trivial |
| 5 | Cost sink = augment `installUsageCapture` (stream + non-stream) → durable `agent_actions` insert; + targeted Hermes-chat finalize insert | new table + union reads vs augment capture point | single chokepoint covers every SvelteKit gateway call (incl. streaming project/RAG); Hermes is external so needs its own per-turn insert; reuses the table the page already reads (no read-side change) | MED — revert usage-capture.ts / the insert |
| 6 | jkai-research (separate SaaS, last touched Mar, default Qwen3) → **out of scope** | include vs skip | dormant, not in the live stack, its Qwen default is by-design for that product; changing a 4-month-idle repo is the wrong default | n/a — noted for John |
| 7 | Keep `pi-runner` coding agent on `anthropic/claude-sonnet-4.5` via OpenRouter | reroute to z.ai vs leave | it's a code-writing agent (pi CLI), not chat routing; intentionally Claude; usage parsed from pi output | n/a |
| 8 | Vision/audio in `describe.ts` stay on OpenRouter | force z.ai vs leave | glm vision 429-gated; z.ai has no audio input. Left as-is (noted) | n/a |

## Files to touch

**Routing defaults (strange_rambling_svelte):**
1. `src/lib/constants/glm-models.ts` — `DEFAULT_GLM_MODEL_ID` glm-5.1→glm-5.2.
2. `src/lib/server/models/settings.ts` — chat→glm-5.2 (ref const), builder→glm-5-turbo, thinking→glm-5.2.
3. `src/lib/deepdive/keys.ts` — getModel→glm-5.2, getFallbackModel→gemini + comment, getKeysStatus→glm-5.2, wrap getOpenRouterClient in installUsageCapture.
4. `src/lib/server/models/capabilities.ts` — add `glm-5.2: ALL`.
5. `src/lib/jkai/llm-pricing.ts` — add OPENROUTER price row for the gemini fallback.
6. `src/routes/api/admin/models/settings/+server.ts` + `src/routes/admin/ai/models/+page.server.ts` — builder default glm-5.1→glm-5-turbo.
7. `src/routes/api/admin/blog/review-claims/+server.ts` — MODEL_CTX glm-5.1→glm-5.2.
8. `src/lib/workflows/nodes/think.def.ts` + `src/lib/canvas/nodes/panels/ThinkPanel.svelte` — default '' (site default).
9. `src/lib/db/schema.ts` — jkai_conversations.modelId default glm-5.1→glm-5.2 (source-of-truth; DB DEFAULT applied via manual ALTER).

**Cost tracking:**
10. NEW `src/lib/jkai/llm-usage-log.ts` — `recordDurableLLMCall(record, source)` fire-and-forget `agent_actions` insert.
11. `src/lib/jkai/usage-capture.ts` — call it from captureUsage (non-stream) + add safe streaming capture (Proxy passthrough, forces include_usage).
12. `src/routes/api/workflows/orchestrator/chat/+server.ts` — per-turn `agent_actions` insert for Hermes chat at the existing finalize block.

**Config / data (not in the code deploy):**
13. DB `app_settings` (VPS + local): chat→glm-5.2, builder→{zai,glm-5-turbo}.
14. `keys.json` (VPS + local): zaiModel→glm-5.2, openrouterFallbackModel→gemini.
15. Hermes `~/.hermes-jkai/config.yaml`: model.default→glm-5.2, delegation.model→glm-5-turbo, fallback_model.model→gemini. Commit to homeserv-hermes-jkai; restart Hermes.

## Verification
- `npm run check` clean (NODE_OPTIONS heap bump).
- After deploy: `curl` a streamed project chat (e.g. data-spine) → still streams; grep prod logs for no errors.
- Query `agent_actions` on VPS after driving one chat + one workflow/research call → rows with action_type='llm_call', correct provider/model/cost appear.
- Load `/admin/ops/costs` → non-zero totals + by-model breakdown showing glm-5.2 / gemini.
- Confirm fallback id resolves (already grep-verified live on OpenRouter catalogue).

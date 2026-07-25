# Model routing: open-weight bias, cost priority, and one site default

**Date:** 2026-07-25
**Kick-off:** John — "there's functionality to auto detect query types and choose a model automatically — I want to change and improve that. Currently it defaults to gpt but I want it to bias open weight models. Currently selections are not prioritising cost. Additionally the model picker modal needs to be more functional. I want the user to be able to override the default model [from] that modal, as well as override the automated model selection models by task type. The default model should be the one any llm task uses across the whole site."
**Grade:** Full autonomy after one batched design round ("Do the rest autonomously I'm going to sleep").
**Supersedes policy in:** `2026-07-20-query-adaptive-model-routing-design.md` (the harness stays; the selection policy reverses).

## Problem

The nightly selector picked `openai/gpt-5.6-sol` ($11.25/1M blended, closed weights) for
three of four profiles. That was the *designed* outcome of the previous brief ("don't over
bias cost"), enforced by three anti-cheap guards: a quality floor expressed as an
**agentic-index percentile of the eligible pool**, a hard `PRICE_WEIGHT_CAP = 0.25`, and
log-scaled price. John has now reversed the stance: bias open-weight models, prioritise cost.

## Why the obvious fix is wrong

Simply raising the price weight was simulated against the live catalogue
(`selectForProfile` over all 338 catalogue rows). With the percentile floor left in place,
**every profile collapses onto the single cheapest model that clears the floor**
(`tencent/hy3-preview`, agentic 31, $0.10/1M) — general, tool and rag all converge and
query-adaptive routing stops adapting. A percentile floor is a *relative* gate: it always
admits the same fraction of a catalogue full of weak-but-cheap models, so price then decides
among mediocrity.

## Design: a capability band

Replace the percentile floor with an **absolute floor expressed as a fraction of the best
agentic index in the catalogue** (`qualityFloorFrac`), then let cost decide *within* that
band, plus a multiplicative open-weight bonus.

- `floor = qualityFloorFrac[profile] × max(agenticIndex over the whole catalogue)`
- Open-weight signal = OpenRouter's `raw.hugging_face_id` being present (150/338 models
  today). Costs nothing — already stored in `openrouter_models.raw`.
- `finalScore = hybridScore × (1 − k + 2k·successRate) × (1 + openWeightBonus if open)`

Simulated picks (live catalogue, 2026-07-25) with frac general 0.60 / tool 0.65 / rag 0.50 /
agentic 0.75, price cap 0.5, open bonus 0.15:

| Profile | Before | After | Δ cost |
|---|---|---|---|
| general | openai/gpt-5.6-sol · ai 54 · $11.25 | **deepseek/deepseek-v4-pro** · ai 36 · $0.54 | 20.8× cheaper |
| tool | openai/gpt-5.6-sol · ai 54 · $11.25 | **deepseek/deepseek-v4-pro** · ai 36 · $0.54 | 20.8× cheaper |
| rag | openai/gpt-oss-120b · ai 13 · $0.07 | **tencent/hy3-preview** · ai 31 · $0.10 | ~same, 2.4× quality |
| agentic | openai/gpt-5.6-sol · ai 54 · $11.25 | **z-ai/glm-5.2** · ai 43 · $1.72 | 6.5× cheaper |

All four picks are open-weight, profiles stay differentiated, and the agentic profile keeps
the strongest open model rather than the cheapest one.

## Overrides (new)

Two override layers, both writable from the /jkai model picker:

1. **Site default** — `jkai.chat.default_model`. Already the single value behind
   `resolveDefaultModel('chat')`, which every site-wide LLM task resolves (deep research,
   workflow LLM nodes, project-page chats, briefing, self-improve, orchestrator, new
   conversations). Now settable from the picker, not just `/admin/ai/models`.
2. **Per-profile pins** — `jkai.routing.overrides` (new app_settings key). A pinned profile
   wins over the nightly assignment. Resolution order becomes
   **override → nightly assignment → site default**. The nightly run still records what it
   *would* have chosen, so the dashboard can show "auto: X · pinned: Y".

Picker UX: an "apply to" chip row (`this chat` · `site default` · `general` · `tool` · `rag`
· `agentic`); tapping a model row applies it to the active chip. `this chat` keeps the old
behaviour exactly. Chips show what is currently pinned, and profile chips carry a clear (×).

## One default for everything

The builder carve-out (`jkai.builder.default_model` = `z-ai/glm-5-turbo`, created because the
flagship timed out on tool-heavy delegation) is **removed** at John's explicit direction:
`resolveDefaultModel('builder')` now returns the site default, the code constant
`DEFAULT_AGENTIC_MODEL_ID` aliases `DEFAULT_CHAT_MODEL_ID`, and the "Builder" action is
removed from the `/admin/ai/models` table so nothing advertises a setting that no longer
has an effect.

## Site default value

John's rule: *"the general profile winner where the cost is equal to or cheaper than deepseek
v4 flash but the performance is better, otherwise use that model."* Query over the catalogue
for tools-capable models at ≤ $0.123/1M blended with agentic index > 31.1 returns **nothing**
(best is `tencent/hy3-preview` at ai 30.7 — cheaper but weaker). Therefore the site default
becomes **`deepseek/deepseek-v4-flash`** (agentic 31.1, $0.098 in / $0.196 out, 1M context,
open weights) — down from `google/gemini-3.5-flash` ($1.50/$9.00, closed), a **27× cut** on
blended price for every site-wide LLM task.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Quality gate shape | percentile of pool (status quo) · fraction of best-in-catalogue · fixed absolute index | **fraction of best** | Percentile collapses all profiles onto one cheap model (simulated); a fixed index rots as the catalogue's ceiling moves | Yes — one dashboard field |
| 2 | Open-weight bias strength | soft bonus · hard open-only filter | **soft bonus 0.15, `openWeightsOnly` available and default off** | Simulation showed the bonus alone yields open-weight picks on all four profiles; the hard filter shrinks the agentic pool to 1 candidate with no fallback if a model regresses or delists | Yes — dashboard toggle |
| 3 | `PRICE_WEIGHT_CAP` | keep 0.25 · raise to 0.5 · remove | **raise to 0.5** | Cost is now a first-class objective, but an uncapped price weight plus any floor still degenerates to cheapest-viable | Yes — constant |
| 4 | Open-weight signal | `hugging_face_id` presence · maintain a hand-curated vendor list | **`hugging_face_id`** | Already in `raw`, refreshed with the catalogue, no maintenance; a vendor list rots | Yes |
| 5 | Builder default | keep the carve-out · collapse | **collapse** (John's call; I flagged the delegation-timeout risk) | Explicit instruction: one default for every LLM task | Yes — re-add the key |
| 6 | Multimodal safety | accept that a text-only default rejects attachments · capability-guard the resolve path | **capability guard** | `deepseek-v4-flash` is text→text, so a bare collapse would make /jkai reject images/PDFs. When a query has attachments and the resolved model can't take them, routing falls back to a capable model | Yes |
| 7 | Where the picker writes | reuse owner-gated `/api/admin/models/settings` · new `/api/jkai/routing/overrides` | **new endpoint** handling both writes | One round-trip for the modal, and it needs a GET for the auto/pinned/effective picture anyway; /jkai and /api/jkai are already owner-only in `hooks.server.ts` | Yes |
| 8 | rag quality floor | keep it lowest (speed-first, status quo) | **frac 0.50** | The old 40th-percentile floor let agentic-index 13 win; 0.50-of-best keeps speed-first intent while lifting the quality floor to ~ai 27 | Yes |

## Files touched

**Policy:** `src/lib/routing/{types,scoring,select,events,resolve}.ts`, `select.test.ts`,
`src/routes/api/admin/models/routing/config/+server.ts`
**Overrides:** `src/routes/api/jkai/routing/overrides/+server.ts` (new)
**Picker:** `src/lib/components/jkai/OpenRouterModelPicker.svelte`, `ChatArea.svelte`,
`src/routes/api/admin/models/openrouter/+server.ts` (openWeights + openOnly)
**Collapse:** `src/lib/server/models/settings.ts`, `src/lib/constants/default-models.ts`,
`src/lib/jkai/planner.ts`, `src/routes/api/admin/models/settings/+server.ts`,
`src/lib/components/admin/OpenRouterModelBrowser.svelte`, `/admin/ai/models` page
**Dashboard:** `src/routes/admin/ai/model-routing/+page.{server.ts,svelte}`
**Site-default coverage gap:** `src/lib/components/drive/RagChatPanel.svelte` (+ `/drive`
page + server) initialised from the code constant instead of the site default

## Verification

1. `npx vitest run src/lib/routing` — band floor, open bonus, open-only, price cap, success bias.
2. `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — zero new errors.
3. Re-selection against the live catalogue produces the table above (`POST /api/admin/models/routing/run`).
4. Live: `/jkai` picker pins a profile → `GET /api/jkai/routing/overrides` reflects it;
   `/admin/ai/model-routing` shows pinned vs auto; site default visible at `/admin/ai/models`.
5. Live `curl` of `strangeramblings.com` routes after deploy.

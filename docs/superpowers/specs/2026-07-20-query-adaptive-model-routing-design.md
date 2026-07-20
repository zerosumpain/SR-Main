# Query-Adaptive Model Routing — Design

**Goal:** Automatically pick the best OpenRouter model for each `/jkai` query by *profile* (tool-heavy, RAG-fast, agentic, general). Per-profile picks are chosen overnight by a cost-aware algorithm that must **not over-bias cheapness**, confirmed over WhatsApp, and continuously improved by a first-time-correct success loop. A dashboard tracks all of it.

**Status:** built 2026-07-20. Ships enabled, inert until first selection run (falls back to the current `jkai.chat.default_model`).

## Precedents (copied, not invented)
- Nightly cron + host gate + kill switch + WhatsApp + datastore persist → `$lib/briefing/` and `$lib/selfimprove/`.
- Model scoring (blended price, AA `agentic_index`, log-price, min-max norm, `-1` sentinel, tools-only) → `src/routes/api/admin/models/openrouter/+server.ts`.
- Catalogue refresh → `refreshOpenRouterCatalogue()` in `$lib/server/models/openrouter-catalogue.ts`.
- Request-time classification with no LLM call → `inferToolsets()` in `$lib/workflows/site-tools/keyword-classifier.ts`.
- Apply-a-model-to-a-conversation → the existing `switchModel()` in `ChatArea.svelte` (PATCH conversation + silent `/model` to Hermes). The client reuses it, so the orchestrator chat route is **untouched**.
- 👍/👎 feedback → `$lib/briefing/feedback.ts`.
- Dashboard shell → `/admin/ai/improvement`.

## Profiles
`general` (default chat) · `tool` (multi-tool actions: home/gmail/scraper/apis/datastore/web/workflows) · `rag` (@files/@knowledge/@research, retrieval — optimise tokens/sec) · `agentic` (delegation / canvas / build).

## Classification (request time, zero extra LLM latency)
`classifyQuery({ message, workflowId, mode, hasAttachments })`:
- `workflowId` or `mode ∈ {generate,modify}` → **agentic**.
- else on `inferToolsets(message)`: contains `agents` (delegate/team) → **agentic**; contains `files|knowledge|research` and few action tools → **rag**; contains ≥1 action toolset → **tool**; else → **general**.
Runs once per conversation (first message only); self-corrects via the success loop.

## Overnight selection (`04:00 Europe/London`)
1. `refreshOpenRouterCatalogue()` for fresh price/quality/throughput.
2. Candidate filter: `tools` supported (orchestrator needs it), has `agenticIndex`, `blendedPerM` in `(0, priceCeiling]`, `contextLength ≥ 32k`.
3. **Quality floor** — keep only candidates at/above a per-profile percentile of `agenticIndex` (general 45 · tool 60 · rag 40 · agentic 65). *This is the primary anti-cheap guard: a weak-but-cheap model can never win.*
4. Hybrid score with **capped price weight (≤0.25)** and log-scaled price:
   | profile | wq (quality) | wp (price) | wt (speed) |
   |---|---|---|---|
   | general | 0.45 | 0.25 | 0.30 |
   | tool | 0.55 | 0.15 | 0.30 |
   | rag | 0.30 | 0.20 | 0.50 |
   | agentic | 0.60 | 0.15 | 0.25 |
5. **Success bias** — multiply by `0.8 + 0.4 · wilsonLower(profile, model)`; unrated models get a neutral prior (~0.7) so they're still explored.
6. Pick argmax; persist assignments + full candidate/why breakdown; WhatsApp the four picks.

Anti-cost-bias is enforced three ways at once: quality-floor gate, capped+log-scaled price weight, and speed/quality-led weights. All tunable on the dashboard.

## Success loop ("correct first time")
- Explicit: 👍/👎 under the first assistant reply → `correctFirstTime` on the conversation's routing event.
- (Follow-up) implicit tool-error / rapid-rephrase signal — deferred; explicit vote is the v1 signal.
- `wilsonLower(correct, total)` per `(profile, model)` feeds step 5.

## Storage (datastore — no schema migration)
- `app_settings`: `jkai.routing.enabled`, `jkai.routing.assignments` (the fast read path, `getSetting`-cached), `jkai.routing.config` (weights/floors/ceiling).
- collections: `model-routing-runs` (selection history), `model-routing-events` (per-conversation decision + outcome).

## Files
CREATE `src/lib/routing/{types,classify,scoring,select,success,events,resolve,run,engine}.ts` + `select.test.ts`;
`src/routes/api/jkai/routing/{resolve,feedback}/+server.ts`;
`src/routes/api/admin/models/routing/{run,config}/+server.ts`;
`src/routes/admin/ai/model-routing/{+page.server.ts,+page.svelte}`.
MODIFY `src/hooks.server.ts` (register), `src/lib/components/jkai/ChatArea.svelte` (resolve-before-send + thumbs), `/admin/ai` index link.

## Verification
`npm run check` clean; `select.test.ts` proves the three anti-cheap guards; deploy; POST run → WhatsApp received + assignments populated; Playwright drives the dashboard + a routed first message picks the profile model.

## Decision Log
- **Client-triggered apply (reuse `switchModel`) vs server chat-route edits** → client. *Why:* the orchestrator chat route is a 1000-line hot path with a live Hermes branch; reusing the battle-tested manual-switch path is far lower risk and needs no route changes. *Reversible.*
- **Heuristic classifier vs per-query LLM classifier** → heuristic. *Why:* John is latency-sensitive; classification runs once per conversation and self-corrects via the success loop. *Reversible* (can add an LLM classifier later).
- **Ship enabled (inert) + one seed run vs default-off** → enabled + seed. *Why:* fulfils the ask; empty assignments fall back to the current default so deploy changes nothing until the seed run populates picks (and sends the confirming WhatsApp). *Reversible* (kill switch on the dashboard).
- **Success signal = explicit 👍/👎 (v1)** vs implicit heuristics → explicit first. *Why:* clean signal, no edits to the chat hot path; implicit tool-error/rephrase is a logged follow-up. *Reversible.*
- **Canvas/workflow (Hermes) agentic routing** → deferred. *Why:* canvas chats don't use the per-conversation model picker; the `agentic` profile still applies to web `/jkai` delegation queries via the client path. Logged follow-up.
- **Datastore vs new Drizzle table** → datastore. *Why:* matches briefing/selfimprove, avoids a drizzle-kit push and the known unique-drift gotcha; single-user volume aggregates fine in JS.
- **Price ceiling default $30/M blended, quality-floor percentiles, capped price weight 0.25** → chosen defaults; all dashboard-tunable.

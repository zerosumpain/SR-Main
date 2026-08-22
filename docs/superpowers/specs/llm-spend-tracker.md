# LLM spend tracker — total coverage, analysis, and inline model switching

**Status:** built autonomously 2026-08-22. Kick-off: "I want to make sure the llm
spend tracker covers absolutely everything… charts, highest spending, cost
reduction ideas, model routes… From the same page, I want to be able to switch
the model that's running an activity to another model. do this autonomously."

Grade: **Full autonomy** — no questions, decisions logged below.

## The problem, in three parts

### 1. The ledger does not cover everything

`/admin/ops/costs` reads `agent_actions` where `action_type = 'llm_call'`. Three
classes of real spend never reach that table, and a fourth reaches it
unattributable:

| Gap | Why | Evidence |
|---|---|---|
| **Embeddings** | `installUsageCapture` wraps `chat.completions.create` only — its own docstring says "Embeddings are not intercepted". RAG, Drive file embeddings and the knowledge index all bill through `client.embeddings.create`. | `src/lib/jkai/usage-capture.ts`, `src/lib/rag/embed.ts` |
| **Image generation** | The canvas `generate_image` tool `fetch`es `https://openrouter.ai/api/v1/images/generations` directly — no SDK client, so no wrapper. | `src/lib/workflows/site-tools/tools/media-generate-image.ts:59` |
| **Hermes** | The engine is a separate Python runtime on the same OpenRouter key. Only its /jkai *chat* turns are back-filled into the ledger; WhatsApp DMs, canvas chats, delegation children and its auxiliary models are not. | `src/lib/models/workloads.ts` header — 439 uncounted OpenRouter calls in 7 days |
| **Attribution** | 877 of 1,047 local `llm_call` rows carry `source='gateway'` — an undifferentiated bucket worth $4.43 of $5.99. You can see what the site spent, not what spent it. | live query, 2026-08-22 |

### 2. There is nothing to reconcile against

Nothing on the page says whether the ledger is *complete*. OpenRouter's
`/api/v1/activity` needs a management key (403 with the inference key — verified
2026-08-22), but two authoritative figures are reachable:

- `GET /api/v1/key` → `usage_daily`, `usage_weekly`, `usage_monthly`, `usage`
  (lifetime) for **this key**, which Hermes shares (`~/.hermes-jkai/.env` holds
  the same `sk-or-v1-56e8…`). So key usage covers site + Hermes.
- `GET /api/v1/credits` → account lifetime `total_usage` across **all** keys.

Live at the time of writing: account $79.17, this key $59.30 — so ~$19.87 sits on
other/retired keys. Both numbers belong on the page.

### 3. Model routes are on a different page from the spend

`$lib/models/workloads.ts` already names all 15 LLM roles and
`POST /api/jkai/models/workloads` already switches them — but only from the
`/jkai` chat picker's Workloads tab. The page that shows what a role *costs* has
no way to change what it *runs on*.

## What gets built

**Coverage**
- `$lib/jkai/activity-context.ts` — an ambient activity id on `AsyncLocalStorage`,
  modelled exactly on `$lib/deepdive/meter.ts`'s research-session store. Each
  workload call site wraps its LLM call in `withActivity('<workload id>', …)`, so
  the ledger row records *which role* spent the money, not just "gateway".
- `installUsageCapture` also wraps `embeddings.create`.
- The image tool records its own row (priced per image from the catalogue).

**Reconciliation**
- `$lib/server/models/openrouter-usage.ts` — cached, never-throws reader for
  `/api/v1/key`, alongside the existing `/credits` reader.
- The page shows billed vs recorded per window and names the gap.

**Analysis** (`$lib/costs/analysis.ts`, pure + unit-tested)
- daily spend series, split by activity;
- top spenders by model, by activity, by session;
- savings opportunities: for each activity, the cheapest catalogue model that
  still satisfies the workload's `requires` capability and clears a quality
  floor, with the annualised saving at current volume;
- waste signals: unpriced calls, zero-output calls, cache-read ratio.

**Switching**
- `WorkloadModelSwitch.svelte` — a compact price-annotated `<select>` on each
  activity row, POSTing to the existing `/api/jkai/models/workloads` (site +
  Hermes scopes) or `/api/admin/models/settings` (the site default).

## Decision log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Attribution mechanism | (a) thread a param through ~160 call sites; (b) `AsyncLocalStorage` ambient id; (c) `enterWith` inside the resolver | **(b)** | Exact precedent in `deepdive/meter.ts`, which exists for the identical problem ("the spend was in the ledger and unattributable"). (c) is one line but leaks the tag into every later call in the same request, which mis-attributes rather than under-attributes — a wrong number is worse than a missing one. | Yes — delete the wrapper, tags go null. |
| Reconciliation source | (a) `/api/v1/activity`; (b) `/api/v1/key` + `/credits`; (c) none | **(b)** | (a) 403s without a management key, verified. (b) is authoritative for the same key Hermes uses. | Yes |
| Backfill old rows | rewrite historic `source='gateway'` rows | **No** | Nothing in the row says which role made it; a guess written into a ledger is a lie with a timestamp. Tagging starts at deploy; the page says so. | n/a |
| Charts | (a) a chart library; (b) CSS/SVG bars like `/admin/ops/tool-usage` | **(b)** | Precedent, no new dependency, works in both themes with existing tokens. | Yes |
| Switcher UI | (a) reuse `OpenRouterModelPicker` overlay; (b) inline select | **(b)** | The picker is a full-screen chat overlay with chat-specific targets. An inline price-annotated select keeps the cost context visible while choosing — which is the point of doing it on this page. | Yes |
| Hermes rows | show read-only vs switchable | **Switchable** | `POST /api/jkai/models/workloads` already handles the hermes scope end-to-end (config set + restart). Excluding them would leave the largest uncounted spender unmanageable from the page. | Yes |

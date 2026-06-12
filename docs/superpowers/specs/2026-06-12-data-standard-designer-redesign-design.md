# Data Standard Designer — UX redesign

**Date:** 2026-06-12
**Route:** `/projects/data-standard-designer` (in `~/strange_rambling_svelte`)
**Status:** Design approved (John approved nav, brief, schema, crosswalk directions via visual companion; delegated registry + method + execution autonomously).

## Problem

The tool works but is too complex and the flow doesn't read. Specific failures (John's words):

1. UI too complex overall; onboarding fine but the flow doesn't make sense.
2. The **Brief** page is too dense — asks a lot, shows a lot, in the wrong order (advanced legal/burden questions before you've seen a field).
3. The **Schema** tab gives blank boxes; it should provide **guidance & specification** (formats, regex where applicable).
4. The **Crosswalk** (Review) is a spreadsheet of text; it should be a **visual relationship map**.
5. The **nav** mixes flow steps and tools in one undifferentiated strip.
6. The **Registry** surfaces articles that might mention standards; it should be an **LLM search for actual standards**.
7. The **Method** page is a wall of text; the **value offer** isn't clear.

Prior v5/v6 "declutter" passes trimmed at the margins but didn't change the information architecture. This redesign changes the IA.

## Principles

- **Make the path obvious.** Separate the linear flow from the tools you dip into.
- **Ask only what the engine needs; defer depth.** Refinement raises the score, it doesn't block the start.
- **Teach.** Every field has a knowable spec — hand it over instead of an empty box.
- **Show relationships, don't list them.**
- **Search for standards, not articles.**
- **Lead with the value.**

## Non-goals / invariants

- **Do not** change the scoring math (`engine.ts` score functions), the exporters, the legal-basis content, the synthetic-data generator semantics, or the registry DB schema / discovery cron. Reuse them.
- **Keep every existing route resolving** (`brief schema interoperability impact publish legal validate portal method` + the two `/api` + `/assist`). This is a re-skin + re-flow + additive intelligence, not a teardown.
- SR design system only (canonical tokens, Archivo Black / DM Sans / JetBrains Mono). Reuse the existing `.dsd-*` global helpers in `+layout.svelte`.
- Watch the known Svelte 5 traps: no `$state` on interval/handle read inside an `$effect`-called fn ([[feedback_svelte5_state_in_effect_loop]]); hoist prop reads + `untrack()` when syncing props→state ([[feedback_svelte5_effect_proxy_churn]]). GLM assist calls keep `thinking:{type:'disabled'}` + `max_tokens≥6000` ([[feedback_glm_reasoning_tokens]]).

---

## Workstream 1 — Information architecture & navigation

**Decision: "Pipeline + Tools menu" (Option A).**

`+layout.svelte` top bar, restructured:

- **Top row:** `← Projects` · `⌗ Data Standard Designer` (brand) · …spacer… · `Examples ▾` · `Tools ▾` · `About` · Analyst/Architect toggle.
  - Remove the always-on **design-score chip** from the chrome. The score belongs to the Review step; surface it there and as a small inline number on the stepper's Review node, not in the global header.
  - `?` help stays (small), opens existing `Onboarding`.
- **Main nav line = a 4-step progress stepper** and nothing else:
  - `① Brief → ② Schema → ③ Review → ④ Publish`, with per-step state: **done** (✓, if that step's data exists), **current** (active route), **upcoming** (dimmed). Connector lines between nodes.
  - "Done" heuristics: Brief done = `brief.name && brief.purpose`; Schema done = `fields.length > 0`; Review = visited or fields present; Publish never "done".
  - Review node carries the small overall score.
- **`Tools ▾` menu** (single dropdown, same pattern as `Examples ▾`): **Registry** (find standards) · **Test data** (`/validate`) · **Legal basis** (`/legal`). These are the dip-into surfaces.
- **`About`** → `/method` (renamed "Method" → "About" in the UI; route stays `method`).
- **Legal basis** also remains reachable inline from the Brief's legal block (already wired) — that is its primary entry point.

`ReviewTabs.svelte` (Interoperability + Impact sub-tabs) stays as-is for step ③.

New small component: `Stepper.svelte` (presentational; reads `app` + `$page` for active/done state).

**Files:** `+layout.svelte` (rework top bar + nav), new `components/Stepper.svelte`, new `components/ToolsMenu.svelte` (or inline). `+page.svelte` "The flow" section + tools line updated to match labels.

---

## Workstream 2 — The Brief (essentials first)

**Decision: "Essentials first, depth on demand" (Option A).**

Rebuild `brief/+page.svelte` as: **on-ramps → essentials → optional depth → rail**, all on one scannable page.

**On-ramps (top):**
- Keep the AI panel ("Describe your dataset in plain English → draft / revise") — unchanged behaviour, kept prominent.
- Inline "or start from an example ▾" using `PRESETS` (so users don't have to find the header menu).

**The essentials (always visible, short):**
- Standard **name** + **domain** (one row).
- **Purpose** (one line).
- **What's in it?** — the three characteristic toggles (Personal / Special-category / About children). These drive assurance + the legal prompt.

**Optional depth (collapsed `<details>`-style blocks, each labelled with the score lever it moves):**
- **Who provides & uses it** — providers + consumers. Provider editor **simplifies**: default shows **name + sector** only; `ownership / burden-sensitivity / systems-held / existing-standards` move behind a per-provider **"add detail ▾"** expander. Consumers stay name + use.
- **Legal basis to share** — the existing personal-data legal block (A/B/C check + registry link). Only meaningfully shown once "Personal data" is on.
- **Interoperability ambition & geography** — the interop segment + geographic coverage.

Each collapsed block shows a one-line summary when closed (count / chips), and a subtle "+N to adoption / assurance" hint to motivate opening it.

**Live engine rail:** keep the right-hand `rail` (identifiers / standards / format-collection-frequency) — it is the "see the engine react" payoff and co-visibility is the reason we chose A over a wizard.

Primary CTA unchanged: **Build the schema →**.

**Files:** `brief/+page.svelte` (restructure; extract the provider editor into `components/ProviderEditor.svelte` to keep the page lean and isolate the "add detail" disclosure). No state/type changes — same `Brief` shape, same `app` methods.

---

## Workstream 3 — The Schema (guidance & specification)

**Decision: field **spec inspector** on the right (Option A) + a field-spec knowledge layer.**

**New knowledge layer — `lib/fieldSpec.ts`** (pure, deterministic, the load-bearing addition):
- `specForField(field): FieldSpec` returning `{ recommendedFormat, pattern (regex string | null), example, rule, permissibleHint }`.
- Grounded two ways:
  - **By identifier** — when `field.identifier` is set, return that identifier's canonical format + regex + example + caveat. Source the patterns from the same rules the synth generator already encodes (NHS number 10-digit mod-11, UPN, UPRN, GSS `^[A-Z]\d{8}$`, URN, UKPRN, ULN, postcode, ODS) — extract them into shared constants so `fieldSpec.ts` and `synth.ts` agree. Reuse `IDENTIFIERS[].format` text for the human format line.
  - **By type** — sensible defaults when no identifier: `date`→ISO 8601 `^\d{4}-\d{2}-\d{2}$` e.g. `2018-09-01`; `datetime`→ISO 8601 with time; `email`/`string` heuristics by name (postcode, phone, url); `enum`/`array`→point at codelist permissible values; `currency`→2dp; `boolean`→true/false.
- No regex is auto-applied silently — it's **offered** with an "apply" action that writes to `field.format`.

**Right rail becomes a contextual inspector** in `schema/+page.svelte`:
- When a field is **selected** (click row), the rail shows **`FieldInspector.svelte`** for that field: name/title, the **Spec block** (recommended type, format, pattern chip with **Apply**, example, rule, permissible values for codelists), provenance (identifier / from-standard), PII/SC, and a **live "Published as →"** preview (the JSON-Schema fragment this field will emit — reuse the exporter's per-field logic).
- When **no** field is selected, the rail shows the existing **score strip + unused-identifier suggestions** (current behaviour).
- Selection state: add `app.selectedFieldId` (`$state<string|null>`), set on row click, cleared on delete.

`FieldRow.svelte` slims: the inline expandable detail is replaced by selecting → inspector (keep a compact inline summary line: type, flags, "reuses X"). Architect mode auto-selects/expands as today. Analyst mode keeps the plain-language note.

**Files:** new `lib/fieldSpec.ts`, new `components/FieldInspector.svelte`, refactor `schema/+page.svelte` (rail switches inspector⇄score) + `components/FieldRow.svelte` (slim, selectable), `appState.svelte.ts` (`selectedFieldId` + setter). Extract identifier regex constants shared with `lib/synth.ts`.

---

## Workstream 4 — The Crosswalk (relationship map)

**Decision: radial hub-and-spoke hero (A) + bipartite toggle (B) + inner cross-links + 2nd-order neighbours.** (John: "Both — show neighbours and inner cross-links.")

**New graph builder — `engine.ts` `crosswalkGraph(fields)`** (pure), returning:
- `center` — "Your standard".
- `inner: { standard, linkCount, vias: string[], identifierColorKey }[]` — standards your fields directly join (from the existing `crosswalk()` `shares-identifier` + `reuses-field-from` edges, grouped by standard). Thickness = `linkCount`; colour keyed by the dominant shared identifier.
- `crossLinks: { a, b, nature, note }[]` — relationships **between inner standards**, from `RELATIONSHIPS` (both directions) + `connectsTo`, where both endpoints are inner.
- `secondOrder: { standard, throughInner, via }[]` — standards reachable one hop out: `connectsTo` / `RELATIONSHIPS` targets of inner standards that are **not** themselves inner. De-duped; framed as reach/opportunity.

**New component — `components/CrosswalkMap.svelte`:**
- **Radial view (default):** centre node; inner ring laid out on a circle (deterministic angle by index); **solid coloured spokes** centre→inner (stroke-width ∝ linkCount, colour by identifier); **thin grey arcs** for `crossLinks`; **dashed dimmed** inner→secondOrder, with smaller dimmed outer nodes.
- **Toggles:** `Cross-links` and `Wider network (2nd-order)` independent (both off = clean hub-and-spoke). View switch **Radial ⇄ Bipartite**.
- **Bipartite view:** your fields (left) ↔ standards (right), curved links = direct joins only.
- **Interaction:** click a node → the existing per-standard field-level edge list (the current `grouped` data) expands in a panel **below** the map; click a 2nd-order node → "align with this to connect" hint (+ deep-link to explore it via `app.openStandard`).
- SVG, no new deps. Legend strip explaining the three edge weights. Responsive `viewBox`; degrades to the existing grouped list under a small breakpoint or when `inner` is empty.

`interoperability/+page.svelte`: replace the `xwalk` grid with `<CrosswalkMap/>` as the hero; keep "Standards to align with" and "Identifiers in play" below; keep the grouped text list as the click-to-drill detail.

**Files:** `engine.ts` (`crosswalkGraph` + exported colour-key helper), new `components/CrosswalkMap.svelte`, `interoperability/+page.svelte`.

---

## Workstream 5 — The Registry (LLM standards search)

**Decision: reframe `/portal` around an LLM search for standards; demote the article feed.**

The discovery pipeline already classifies entries with `isStandard` + `kind` (`data-standard|data-dictionary|metadata|api-standard|identifier|guidance|other`) — the data is fine; the **presentation** treats everything as an undifferentiated link feed.

**New endpoint — `find-standards` mode in `assist/+server.ts`** (reuse the rate-limit + `getOpenAIClient`/`getModel` + `thinking:disabled` + JSON-object pattern):
- Input: `{ mode:'find-standards', query }`.
- Candidate retrieval (server, deterministic, no hallucinated existence): keyword/score match the **grounded `CATALOG`** (64 real standards: name/owner/dataCovered/sector) **+** registry entries where `isStandard` / `kind ∈ {data-standard,data-dictionary,metadata,api-standard,identifier}` — capped (~40 candidates).
- LLM **selects + ranks + explains** only from the supplied candidates (ids/urls echoed back; validated server-side like the other modes). Returns `{ standards: [{ source:'catalog'|'registry', refId, name, owner, covers, why, ingestable }], note }`.
- The LLM never invents standards — same grounding discipline as discovery (classify/select only).

**`portal/+page.svelte` restructure:**
- **Hero = the search:** "Find standards for…" box → results render as **real standard cards**: catalog hits use `StandardCard` (explore drawer + ingest actions already exist); registry hits link to source with kind/confidence + an "is this a standard?" badge.
- **Browsable catalog** (moved here from Method): the filterable `CATALOG` grid, so the Registry is the one place to *find* standards (grounded + emerging).
- **Demote the feed:** source-health + the raw discovered-entries feed move **below**, collapsed by default, **filtered to actual standards** (hide `other`/`guidance` unless "show everything"). Watches panel stays. Refresh button stays.

**Files:** `assist/+server.ts` (+`find-standards`), `portal/+page.svelte` (search hero + catalog grid + demoted feed), reuse `StandardCard.svelte` / `StandardDetail.svelte`.

---

## Workstream 6 — Method → About (value offer)

**Decision: lead with the value offer; keep grounding as collapsible reference.**

Rebuild `method/+page.svelte` (route unchanged, nav label "About"):
- **Hero = the value offer** (the "why", scannable): a tight headline + 3–4 value cards with concrete outcomes —
  1. *Joinable data* — reuse identifiers/codelists instead of reinventing, so your data links without fragile matching.
  2. *Know it's good before you publish* — live interoperability / assurance / adoption scoring with the reasons.
  3. *Publication-grade outputs* — JSON Schema, Frictionless, CSVW, DCAT-AP **+ an evidence pack** citing the standards used.
  4. *Grounded, not guessed* — every recommendation traces to a real catalogue (N standards, N identifiers, N methods).
- **How it works** — keep the 4-step strip, tightened.
- **Grounding & reference** (collapsed `<details>` sections): the standards-catalog browse **moves to the Registry** (workstream 5); keep here the **identifiers** reference, **design methods** by category, and **provenance**. These read as "what it's built on", below the value offer, not as the page's body.

**Files:** `method/+page.svelte`.

---

## Component inventory

**New:** `Stepper.svelte`, `ProviderEditor.svelte`, `FieldInspector.svelte`, `CrosswalkMap.svelte`, `lib/fieldSpec.ts`.
**Changed:** `+layout.svelte`, `+page.svelte`, `brief/+page.svelte`, `schema/+page.svelte`, `components/FieldRow.svelte`, `interoperability/+page.svelte`, `portal/+page.svelte`, `method/+page.svelte`, `assist/+server.ts`, `lib/engine.ts` (`crosswalkGraph`), `lib/appState.svelte.ts` (`selectedFieldId`), `lib/synth.ts` (export shared identifier regex constants).
**Unchanged:** exporters, scores, legal-basis content, codelists, presets, discovery cron + DB schema, `/api/*`, `/validate`, `/legal`.

## Risks & mitigations

- **Shared `app` store churn** — all pages read one store; keep additions additive (`selectedFieldId`), avoid effect/proxy churn per the cited memories.
- **SVG layout density** (crosswalk) — cap inner nodes (top ~8 by linkCount) and 2nd-order (top ~6), with "+N more" affordance; both extra layers behind toggles so default is clean.
- **LLM grounding** — `find-standards` selects only from server-supplied candidates; validate returned ids/urls against the candidate set before rendering (no invented standards).
- **Build/deploy** — `npm run check` needs `NODE_OPTIONS=--max-old-space-size=8192`; build/deploy run with the Bash sandbox disabled ([[reference_svelte_dev_env]]). Deploy via `scripts/deploy.sh` after push, then verify live ([[feedback_always_deploy]]).

## Acceptance

- Nav shows a 4-step stepper + a single `Tools ▾`; no score chip in the chrome; Method labelled About.
- Brief fits the essentials on one screen with advanced context collapsed; provider editor defaults to name + sector.
- Selecting a schema field shows a spec inspector with an apply-able regex/format, example, rule, and a published-spec preview; identifiers auto-fill their canonical spec.
- Review shows a radial relationship map with working Cross-links + Wider-network toggles, a Radial⇄Bipartite switch, and click-to-drill; the old grouped list survives as the drill-down.
- Registry leads with an LLM "find standards for X" search returning real catalog/registry standards (not news links); the article feed is demoted + filtered to standards.
- About leads with a clear value offer; the reference material is collapsed beneath it.
- Every pre-existing route still resolves; scores/exports unchanged in value.

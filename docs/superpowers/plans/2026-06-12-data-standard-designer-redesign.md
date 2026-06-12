# Data Standard Designer UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-flow and re-skin `/projects/data-standard-designer` to fix 7 complexity/flow issues without changing the scoring engine, exporters, or DB schema.

**Architecture:** Additive intelligence + IA change. New pure modules (`fieldSpec.ts`, `engine.crosswalkGraph`) and new presentational components; existing routes/state/exporters reused. One shared Svelte 5 rune store (`app`). SR design tokens only.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, inline SVG (no new deps), existing OpenAI-compatible LLM gateway (`getOpenAIClient`/`getModel`).

**Verification per task:** `NODE_OPTIONS=--max-old-space-size=8192 npm run check` (typecheck) must stay clean for touched files; final task runs `npm run build` (sandbox disabled) + dev smoke on `http://homeserv:<port>` + deploy. Reference: [[reference_svelte_dev_env]].

**Spec:** `docs/superpowers/specs/2026-06-12-data-standard-designer-redesign-design.md`.

---

### Task 1 — Field-spec knowledge layer (`lib/fieldSpec.ts`)

**Files:**
- Create: `src/routes/projects/data-standard-designer/lib/fieldSpec.ts`
- Modify: `src/routes/projects/data-standard-designer/lib/synth.ts` (export the identifier regex constants it already encodes, so fieldSpec and synth agree)

- [ ] **Step 1: Extract shared identifier patterns.** In `synth.ts`, find the validators/generators for NHS number (10-digit mod-11), UPN, UPRN, GSS, URN, UKPRN, ULN, postcode, ODS. Export a `const IDENTIFIER_PATTERNS: Record<string,{ pattern: string; example: string; rule: string }>` keyed by identifier id (the `IDENTIFIERS[].id` values). Reuse existing literals; do not change generation behaviour.
- [ ] **Step 2: Write `specForField`.**

```ts
import type { Field, FieldType } from './types';
import { identifierById } from './knowledge';
import { codelistById } from './codelists';
import { IDENTIFIER_PATTERNS } from './synth';

export interface FieldSpec {
  recommendedFormat: string;        // human: "ISO 8601 (YYYY-MM-DD)"
  pattern: string | null;           // applyable regex, or null
  example: string;
  rule: string;                     // plain-language validation rule
  permissible?: { code: string; label: string }[]; // for codelist fields
  caveat?: string;
}

const TYPE_DEFAULTS: Partial<Record<FieldType, Omit<FieldSpec,'caveat'|'permissible'>>> = {
  date:     { recommendedFormat: 'ISO 8601 (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2018-09-01', rule: 'A calendar date; not in the future for a DOB.' },
  datetime: { recommendedFormat: 'ISO 8601 date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:\\d{2})?$', example: '2024-09-01T09:30:00Z', rule: 'Timestamp with timezone.' },
  integer:  { recommendedFormat: 'Whole number', pattern: '^-?\\d+$', example: '42', rule: 'No decimal point.' },
  number:   { recommendedFormat: 'Decimal', pattern: null, example: '3.14', rule: 'Decimal allowed.' },
  boolean:  { recommendedFormat: 'true / false', pattern: '^(true|false)$', example: 'true', rule: 'Boolean only.' },
  currency: { recommendedFormat: 'Decimal, 2dp, GBP', pattern: '^-?\\d+\\.\\d{2}$', example: '1250.00', rule: 'Two decimal places; record the currency once at dataset level.' },
};

// name-heuristic patterns when there is no identifier and type is string
const NAME_HINTS: { test: RegExp; spec: Omit<FieldSpec,'caveat'|'permissible'> }[] = [
  { test: /post_?code/, spec: { recommendedFormat: 'UK postcode', pattern: '^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$', example: 'SW1A 1AA', rule: 'Uppercase; single space before the inward code.' } },
  { test: /email/,      spec: { recommendedFormat: 'Email address', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', example: 'name@example.gov.uk', rule: 'One address per value.' } },
  { test: /url|website/,spec: { recommendedFormat: 'URL', pattern: '^https?://', example: 'https://www.gov.uk', rule: 'Absolute http(s) URL.' } },
];

export function specForField(field: Field): FieldSpec {
  if (field.identifier) {
    const idef = identifierById(field.identifier);
    const p = IDENTIFIER_PATTERNS[field.identifier];
    if (p) return { recommendedFormat: idef?.format || 'Identifier', pattern: p.pattern, example: p.example, rule: p.rule, caveat: idef?.caveat };
    if (idef) return { recommendedFormat: idef.format, pattern: null, example: '', rule: `Reuses ${idef.name}.`, caveat: idef.caveat };
  }
  if ((field.type === 'enum' || field.type === 'array') && field.codelistId) {
    const cl = codelistById(field.codelistId);
    if (cl) return { recommendedFormat: `Codelist: ${cl.name}`, pattern: null, example: cl.values[0]?.code ?? '', rule: 'Value must be one of the permissible codes.', permissible: cl.values.slice(0, 24).map(v => ({ code: v.code, label: v.label })) };
  }
  const td = TYPE_DEFAULTS[field.type];
  if (td) return { ...td };
  if (field.type === 'string') {
    const hit = NAME_HINTS.find(h => h.test.test(field.name));
    if (hit) return { ...hit.spec };
  }
  return { recommendedFormat: 'Free text', pattern: null, example: '', rule: 'No structural constraint — consider a codelist or pattern if values are constrained.' };
}
```

- [ ] **Step 3: Sanity-check the module** (node-free, via check). Run `NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -i fieldspec || echo "fieldSpec clean"`. Expected: clean. Confirm `specForField` returns a regex for a `date` field and for an `nhs-number` identifier field by reading the code path.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(dsd): field-spec knowledge layer (format/regex/example per type+identifier)"`

---

### Task 2 — Crosswalk graph builder (`engine.crosswalkGraph`)

**Files:**
- Modify: `src/routes/projects/data-standard-designer/lib/engine.ts` (add `crosswalkGraph` + colour-key helper; reuse `crosswalk()`, `RELATIONSHIPS`, `connectsTo`)

- [ ] **Step 1: Add types + builder.** Import `RELATIONSHIPS` from knowledge. Add:

```ts
export interface CrosswalkGraph {
  inner: { id: string; name: string; linkCount: number; vias: string[]; colorKey: string }[];
  crossLinks: { a: string; b: string; nature: string; note?: string }[];
  secondOrder: { id: string; name: string; throughId: string; throughName: string; via: string }[];
}

export function crosswalkGraph(fields: Field[]): CrosswalkGraph {
  const edges = crosswalk(fields);                       // existing
  const innerMap = new Map<string, { id: string; name: string; vias: Set<string>; ids: Set<string> }>();
  for (const e of edges) {
    if (!innerMap.has(e.standardId)) innerMap.set(e.standardId, { id: e.standardId, name: e.standardName, vias: new Set(), ids: new Set() });
    innerMap.get(e.standardId)!.vias.add(e.via);
  }
  // dominant identifier per inner standard → colour key (use first shared identifier via)
  const inner = [...innerMap.values()]
    .map(v => ({ id: v.id, name: v.name, linkCount: edges.filter(e => e.standardId === v.id).length, vias: [...v.vias], colorKey: [...v.vias][0] || v.id }))
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 8);
  const innerIds = new Set(inner.map(i => i.id));

  const crossLinks: CrosswalkGraph['crossLinks'] = [];
  const seenCL = new Set<string>();
  const relEdges = [
    ...RELATIONSHIPS.map(r => ({ a: r.from, b: r.to, nature: r.nature, note: r.note })),
    ...inner.flatMap(i => (standardById(i.id)?.connectsTo || []).map(to => ({ a: i.id, b: to, nature: 'connects-to' as string, note: undefined }))),
  ];
  for (const r of relEdges) {
    if (innerIds.has(r.a) && innerIds.has(r.b) && r.a !== r.b) {
      const k = [r.a, r.b].sort().join('|');
      if (!seenCL.has(k)) { seenCL.add(k); crossLinks.push(r); }
    }
  }

  const secondOrder: CrosswalkGraph['secondOrder'] = [];
  const seenSO = new Set<string>();
  for (const i of inner) {
    const neighbours = [
      ...(standardById(i.id)?.connectsTo || []),
      ...RELATIONSHIPS.filter(r => r.from === i.id).map(r => r.to),
      ...RELATIONSHIPS.filter(r => r.to === i.id).map(r => r.from),
    ];
    for (const nid of neighbours) {
      if (innerIds.has(nid) || nid === i.id) continue;
      const s = standardById(nid);
      if (!s || seenSO.has(nid)) continue;
      seenSO.add(nid);
      secondOrder.push({ id: nid, name: s.name, throughId: i.id, throughName: i.name, via: i.name });
    }
  }
  return { inner, crossLinks, secondOrder: secondOrder.slice(0, 6) };
}
```

- [ ] **Step 2: Verify typecheck.** `NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | grep -i engine.ts || echo "engine clean"`. Expected: clean.
- [ ] **Step 3: Commit.** `git commit -am "feat(dsd): crosswalkGraph — inner ring, cross-links, 2nd-order neighbours"`

---

### Task 3 — Nav / IA: stepper + Tools menu (`+layout.svelte`, `+page.svelte`)

**Files:**
- Create: `src/routes/projects/data-standard-designer/components/Stepper.svelte`
- Modify: `src/routes/projects/data-standard-designer/+layout.svelte`, `.../+page.svelte`

- [ ] **Step 1: Stepper.svelte** — presentational. Props: none (reads `app` + `$page`). Renders 4 nodes Brief/Schema/Review/Publish with done/current/upcoming state per spec heuristics (`brief.name && brief.purpose`; `fields.length`; review = active or fields; publish never done). Review node shows `app.overall` as a small number. Connector lines between nodes. Uses `.dsd-*` tokens.
- [ ] **Step 2: Rework `+layout.svelte` top bar.** Top row: back · brand · spacer · `Examples ▾` · `Tools ▾` (Registry→portal, Test data→validate, Legal basis→legal) · `About`→method · Analyst/Architect toggle · `?`. Remove the `dsd-score-chip` block. Replace `<nav class="dsd-nav">…PRIMARY/SECONDARY…</nav>` with `<Stepper/>`. Keep `Onboarding` + `StandardDetail` mounts, footer, persistence effect, all global `.dsd-*` styles.
- [ ] **Step 3: Update `+page.svelte`.** "The flow" 4 cards keep labels Brief/Schema/Review/Publish. Replace the `.tools-line` to reference Registry/Test data/Legal basis + About to match the new menu. No logic change.
- [ ] **Step 4: Verify + smoke.** `npm run check` clean for these files; visually confirm nav shows a stepper + Tools menu, no score chip.
- [ ] **Step 5: Commit.** `git commit -am "feat(dsd): pipeline stepper nav + Tools menu, demote Method→About"`

---

### Task 4 — Brief essentials-first (`brief/+page.svelte`, `ProviderEditor.svelte`)

**Files:**
- Create: `src/routes/projects/data-standard-designer/components/ProviderEditor.svelte`
- Modify: `.../brief/+page.svelte`

- [ ] **Step 1: ProviderEditor.svelte** — takes the provider list region out of brief. Default per-provider row = name + sector. `ownership / burdenSensitivity / systemsHeld / existingStandards` behind a per-provider `add detail ▾` toggle (local `$state` Set of open ids). Reuses `app.addProvider/updateProvider/removeProvider`, `CATALOG`, `standardById`. Same markup/classes as today, just reorganised.
- [ ] **Step 2: Restructure brief page.** Order: (a) AI panel + inline "start from example ▾" (PRESETS), (b) ESSENTIALS block: name+domain row, purpose, the 3 characteristic toggles, (c) collapsed depth blocks — "Who provides & uses it" (ProviderEditor + consumers), "Legal basis to share" (existing legal block, shown when `containsPersonalData`), "Interoperability ambition & geography" (interop seg + geo). Each closed block shows a one-line summary + a "+N to score" hint. (d) keep the live `rail`. (e) CTA "Build the schema →".
- [ ] **Step 3: Verify + smoke.** `npm run check` clean; brief renders essentials with advanced collapsed; AI + presets + rail still work.
- [ ] **Step 4: Commit.** `git commit -am "feat(dsd): essentials-first brief with progressive disclosure + slim provider editor"`

---

### Task 5 — Schema spec inspector (`FieldInspector.svelte`, `schema/+page.svelte`, `FieldRow.svelte`, `appState`)

**Files:**
- Create: `src/routes/projects/data-standard-designer/components/FieldInspector.svelte`
- Modify: `.../schema/+page.svelte`, `.../components/FieldRow.svelte`, `.../lib/appState.svelte.ts`

- [ ] **Step 1: appState** — add `selectedFieldId = $state<string | null>(null)`, `selectField(id)`, and clear it inside `removeField`. Keep additive (no effect churn).
- [ ] **Step 2: FieldInspector.svelte** — props `{ field }`. Calls `specForField(field)`. Sections: identity (name/title), **Spec** (recommendedFormat, `pattern` chip + **Apply** button → `app.updateField(field.id,{format: pattern})`, example, rule, permissible values), provenance selects (identifier / from-standard, moved from FieldRow detail), PII/SC flags, and a **"Published as →"** preview computing the JSON-Schema fragment for this field (reuse the per-field mapping from `exporters.ts`; if not exported, inline a minimal `{type, format, enum?}` preview). Caveat line when present.
- [ ] **Step 3: schema rail switches.** In `schema/+page.svelte` rail: `{#if app.selectedFieldId}` → `<FieldInspector field={selected}/>` (with a "× close" / "back to scores"), `{:else}` existing score-strip + unused-identifier suggestions. `const selected = $derived(app.fields.find(f => f.id === app.selectedFieldId))`.
- [ ] **Step 4: FieldRow selectable + slim.** Clicking the row body calls `app.selectField(field.id)`; add `class:selected`. Replace the in-row expandable detail with a compact summary line (type · flags · "reuses X"); architect mode auto-selects on focus. Keep add/move/delete actions. Keep analyst note.
- [ ] **Step 5: Verify + smoke.** `npm run check` clean; selecting a field shows the inspector with an apply-able regex; an identifier field auto-shows its canonical spec; published-as preview renders.
- [ ] **Step 6: Commit.** `git commit -am "feat(dsd): schema field inspector with regex/format guidance + published-spec preview"`

---

### Task 6 — Crosswalk relationship map (`CrosswalkMap.svelte`, `interoperability/+page.svelte`)

**Files:**
- Create: `src/routes/projects/data-standard-designer/components/CrosswalkMap.svelte`
- Modify: `.../interoperability/+page.svelte`

- [ ] **Step 1: CrosswalkMap.svelte** — reads `app.crosswalkGraph` (add a `$derived` `crosswalkGraph = $derived.by(() => crosswalkGraph(this.fields))` to appState, mirroring `crosswalkEdges`). Local `$state` toggles: `showCrossLinks=false`, `showWider=false`, `view:'radial'|'bipartite'='radial'`, `openNodeId:string|null`. Radial: centre node; inner nodes on a circle (angle = `i/inner.length*2π`); solid coloured spokes (stroke-width ∝ linkCount, colour from `colorKey` via a small hash→palette helper); thin grey arcs for crossLinks (when on); dashed dimmed inner→secondOrder + outer nodes (when on). Bipartite: fields left / inner standards right, curved links for direct joins. Legend strip. Clicking a node sets `openNodeId` → renders the grouped field-level edges (reuse the `grouped` logic from the page) in a panel below; clicking a 2nd-order node shows "align to connect" + `app.openStandard(id)`. Responsive `viewBox`; if `inner.length===0`, render the existing empty-state message.
- [ ] **Step 2: Wire into interoperability page.** Replace the `.xwalk` grid hero with `<CrosswalkMap/>`. Keep ReviewTabs, the score/stat cards, "Standards to align with", "Identifiers in play", and CTA. The grouped text list becomes the map's drill-down (moved into the component or passed in).
- [ ] **Step 3: Verify + smoke.** `npm run check` clean; map renders with toggles working, drill-down on click, bipartite switch, graceful empty state.
- [ ] **Step 4: Commit.** `git commit -am "feat(dsd): radial crosswalk relationship map (cross-links + 2nd-order, bipartite toggle)"`

---

### Task 7 — Registry LLM standards-search (`assist/+server.ts`, `portal/+page.svelte`)

**Files:**
- Modify: `.../assist/+server.ts` (add `find-standards` mode), `.../portal/+page.svelte`

- [ ] **Step 1: `find-standards` endpoint mode.** In `assist/+server.ts`, add a branch: build candidate list server-side = scored `CATALOG` matches (name/owner/dataCovered/sector vs query tokens) + `data.snapshot` standard-type entries are not available here, so accept candidate registry entries passed in the request body (`body.registryCandidates`, pre-filtered client-side to `isStandard`/standard kinds) — OR query the catalog only if none supplied. Cap ~40. System prompt: "Select and rank ONLY from these candidates the standards that answer the query; never invent. Return STRICT JSON {standards:[{refId,source,name,owner,covers,why,ingestable}], note}." Keep `temperature:0.3, max_tokens:6000, thinking:disabled, response_format json_object`. Validate returned `refId`s against the candidate set before returning.
- [ ] **Step 2: Portal search hero.** In `portal/+page.svelte`: add a top **"Find standards for…"** search box → POSTs `{mode:'find-standards', query, registryCandidates}` (candidates = `entries` filtered to `isStandard`/standard kinds, mapped to `{refId:url, name:title, owner:publisher, covers:summary, kind}`) plus catalog handled server-side. Render results as cards: catalog hits use `StandardCard`; registry hits link to `url` with kind/confidence badges. Loading/error states like the brief AI panel.
- [ ] **Step 3: Browsable catalog + demote feed.** Add the filterable `CATALOG` grid (moved from method) under the search. Move source-health + the raw entries feed into a collapsed `<details>` "Discovery feed & source health", default-filtered to standard kinds (toggle "show everything"). Keep watches + refresh.
- [ ] **Step 4: Verify + smoke.** `npm run check` clean; searching returns real standards (catalog + registry), not news links; feed demoted/collapsed.
- [ ] **Step 5: Commit.** `git commit -am "feat(dsd): registry LLM standards-search + browsable catalog, demote article feed"`

---

### Task 8 — About (value offer) (`method/+page.svelte`)

**Files:**
- Modify: `.../method/+page.svelte`

- [ ] **Step 1: Value-offer hero.** Replace the lede-heavy top with a headline + 3–4 value cards (joinable data / score-before-publish / publication-grade exports + evidence pack / grounded-not-guessed with live `CATALOG.length` etc.).
- [ ] **Step 2: Keep how-it-works tight; collapse reference.** Keep the 4-step strip. Move the standards-catalog browse OUT (now in Registry). Wrap identifiers + design-methods + provenance in collapsed `<details>` "What it's built on". 
- [ ] **Step 3: Verify + commit.** `npm run check` clean. `git commit -am "feat(dsd): About page leads with value offer, reference collapsed"`

---

### Task 9 — Full verify, deploy, live-check

- [ ] **Step 1: Typecheck whole project.** `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — resolve any new errors in touched files.
- [ ] **Step 2: Build (sandbox disabled).** `npm run build` — fix any adapter/build errors; suspect stale `.svelte-kit/output` first.
- [ ] **Step 3: Dev smoke.** Run a dev server on a free port (NOT 5173), click through Brief→Schema→Review→Publish + Registry + About; confirm every route resolves and the acceptance criteria.
- [ ] **Step 4: Deploy.** `git push` then `~/strange_rambling_svelte/scripts/deploy.sh`. Re-seed registry cron if needed (`POST /api/data-standard-designer/seed-workflows`).
- [ ] **Step 5: Verify live.** curl/fetch the deployed route; confirm the new nav/stepper asset is live ([[feedback_always_deploy]]).

---

## Self-review

- **Spec coverage:** WS1→T3, WS2→T4, WS3→T1+T5, WS4→T2+T6, WS5→T7, WS6→T8, verify/deploy→T9. All covered.
- **Type consistency:** `specForField`/`FieldSpec`, `crosswalkGraph`/`CrosswalkGraph`, `app.selectedFieldId`/`selectField`, `app.crosswalkGraph` derived — names consistent across tasks.
- **No fabricated test harness:** verification uses the repo's real `check`/`build`/smoke, per plan header.
- **Risk:** `exporters.ts` per-field mapping may not be individually exported (T5 step 2) — fallback inline preview specified. `synth.ts` pattern extraction (T1) must not change generation — only export constants.

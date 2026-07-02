# Keystone Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, this session) — isolated content tasks may be dispatched to subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Keystone into a one-stop shop for writing a DfE data strategy: commitments explorer, in-product WYSIWYG strategy author with automated verification, simplified journey, and all gap-analysis features scoring >30/100.

**Architecture:** New `/commitments` and `/author` routes inside `src/routes/projects/dfe-data-strategy/`, backed by new pure-TS datasets (`lib/commitments.ts`, `lib/orgs.ts`, `lib/author/*`) and one new SSE endpoint (`author/review/+server.ts`). Nav + briefing restructured around Understand → Write → Track. No DB changes; localStorage persistence via a dedicated author rune store.

**Tech Stack:** SvelteKit + Svelte 5 runes, hand-rolled SVG viz, Vitest, Z.AI via `$lib/deepdive/keys` (Keystone's existing transport), BM25 RAG in `lib/retrieval.server.ts`.

## Global Constraints

- Design language: Fraunces (headings) / DM Sans (body) / JetBrains Mono (labels); `.pe-route/.pe-h1/.pe-h2/.pe-lede/.pe-prose/.pe-card/.pe-next/.pe-eyebrow` helpers; warm paper palette; origin colours `#2f6155` (cross-gov), `#8a2d3a` (dfe-policy), `#2f6f97` (partners).
- Svelte 5 gotchas (from memory): never `$state` an internal handle read inside a `$effect`-called function; hoist prop reads + `untrack()` when syncing props→state; no standalone route-level `import './x.css'`.
- LLM calls: `getOpenAIClient()/getModel()` from `$lib/deepdive/keys`, `thinking: {type:'disabled'}`, `max_tokens ≥ 3000`, strict-JSON validated server-side, SSE streaming with immediate first byte (copy `/consider` pattern).
- All copy English; no political stance; personal-project disclaimers preserved.
- `npm run check` needs `NODE_OPTIONS=--max-old-space-size=8192`; build/deploy with sandbox disabled.
- Every dataset record: source URLs + confidence; every enum value validated by a dataset integrity test.

---

### Task A1: Commitment + org types and empty datasets

**Files:** Modify `lib/types.ts` (append). Create `lib/orgs.ts`, `lib/commitments.ts` (types wired, placeholder-free structure, data filled in B1). Test: `lib/__tests__/commitments.test.ts` (integrity suite, initially against whatever data exists).

**Interfaces (produced, used by all later tasks):**
```ts
// types.ts additions
export type DocType = 'white-paper'|'act'|'bill'|'strategy'|'action-plan'|'review'|'consultation'|'roadmap'|'framework'|'guidance'|'blog'|'evidence';
export type DocStatus = 'published'|'enacted'|'in-passage'|'in-consultation'|'announced';
export type CommitmentTheme = 'identifiers'|'data-sharing'|'new-service'|'register'|'standards'|'ai'|'analytics'|'infrastructure'|'safeguarding'|'accountability'|'workforce'|'funding';
export type CommitmentStatus = 'statutory-duty'|'legislated-not-commenced'|'in-delivery'|'announced'|'proposed'|'consulting';
export type DfeRole = 'owner'|'deliverer'|'partner'|'complier';
export interface PolicyDocument { id: string; title: string; shortName: string; type: DocType; publisher: string; date: string; url: string; oneLiner: string; status: DocStatus }
export interface DataFlow { from: string; to: string; what: string }
export interface Commitment { id: string; docId: string; title: string; what: string; quote?: string; theme: CommitmentTheme; status: CommitmentStatus; timeframe?: string; timeframeDate?: string; dfeRole: DfeRole; flows: DataFlow[]; newServices: string[]; identifiers: string[]; standards: string[]; partners: string[]; strategyImplication: string; eli5?: string; capabilityIds: string[]; pressureIds?: string[]; aliases: string[]; confidence: ConfidenceLevel; sourceUrls: string[] }
// orgs.ts
export interface Org { id: string; name: string; short: string; group: 'dfe'|'alb'|'delivery'|'department'|'centre'|'public'|'research'; ring: 0|1|2|3; angle: number }
export const ORGS: Org[]; export const ORG_BY_ID: Record<string, Org>;
// commitments.ts
export const DOCUMENTS: PolicyDocument[]; export const COMMITMENTS: Commitment[];
export const DOCUMENTS_BY_ID, COMMITMENTS_BY_DOC, THEME_META: Record<CommitmentTheme,{label:string;color:string}>, STATUS_META: Record<CommitmentStatus,{label:string;short:string;rank:number}>, ROLE_META.
```
Integrity tests: unique ids; every `docId` in DOCUMENTS; every flow `from/to` in ORGS; every `capabilityIds` in CAPABILITY_IDS; every `pressureIds` in PRESSURES; non-empty sourceUrls; valid enum values; `timeframeDate` matches `/^\d{4}-\d{2}$/` when present.

- [ ] Steps: write integrity test → types → org registry (~20 orgs w/ radial layout) → skeleton datasets → tests pass → commit.

### Task A2: Author engine (pure modules, TDD)

**Files:** Create `lib/author/templates.ts`, `lib/author/sanitize.ts`, `lib/author/serialize.ts`, `lib/author/coverage.ts`, `lib/author/heuristics.ts`. Test: `lib/author/__tests__/author.test.ts`.

**Interfaces (produced):**
```ts
// templates.ts
export interface SectionTemplate { id: string; title: string; guidance: string; prompts: string[]; exemplar?: string; heuristics: HeuristicId[] }
export const SECTION_TEMPLATES: SectionTemplate[]; export function newDoc(): StrategyDoc;
export interface StrategySection { id: string; templateId: string|null; title: string; html: string }
export interface StrategyDoc { title: string; sections: StrategySection[]; updatedAt: number }
// sanitize.ts
export function sanitizeHtml(html: string): string  // allowlist p,br,b,strong,i,em,u,h3,h4,ul,ol,li,a[href http(s)],blockquote; strips attrs/styles/scripts
// serialize.ts
export function htmlToMarkdown(html: string): string; export function markdownToHtml(md: string): string; export function htmlToText(html: string): string;
// coverage.ts
export type CoverageLevel = 'addressed'|'touched'|'missing';
export interface CoverageHit { id: string; kind: 'commitment'|'pressure'|'capability'; level: CoverageLevel; hits: string[]; sectionIds: string[] }
export function runCoverage(doc: StrategyDoc): { items: CoverageHit[]; gaps: CoverageHit[]; statutoryGaps: CoverageHit[]; score: number }
// heuristics.ts
export type HeuristicId = 'substance'|'dates'|'owner'|'measurable'|'evidence'|'plain-english';
export interface HeuristicResult { id: HeuristicId; pass: boolean; note: string }
export function runHeuristics(section: StrategySection, template: SectionTemplate|null): HeuristicResult[]
```
Test cases: sanitize strips `<script>`, styles, keeps allowlist + hrefs; md⇄html round-trips headings/lists/links/bold; coverage matches aliases case-insensitively at word boundaries, requires ≥2 distinct aliases for 'addressed', 1 for 'touched'; statutory gaps ranked first; heuristics detect years, `%`/numbers, owner-words ("accountable", "owner", "SRO", "responsible"), links/citations, ≥80-word substance.

- [ ] Steps: failing tests → implement each module minimal → pass → commit.

### Task A3: Journey components + nav restructure + briefing router

**Files:** Create `components/TakeawayBar.svelte`, `components/NextStep.svelte`. Modify `components/SectionNav.svelte` (groups: Understand / Write / Track / Reference; add Commitments + Author), `+page.svelte` (briefing → router with 3 mode cards + suggested path + headline stats), layout footer link additions.

**Interfaces:** `TakeawayBar` props `{ takeaway: string; takeawayEli5?: string; chips?: {n: string; label: string; href?: string}[]; drill?: {label: string; href: string}[] }`. `NextStep` props `{ links: {label: string; href: string; kind?: 'primary'|'ghost'}[] }`.

- [ ] Steps: components → nav regroup (labels: Landscape, Commitments, Influence map, Frameworks, Legislation, DfE in context, Sector voices | Author, Policy builder, ◆ Workbench, ◆ Upload | Intel radar | How it works) → briefing rebuild → visual check on dev server → commit.

### Task B1: Synthesize research → commitments dataset (+ verify)

**Files:** Modify `lib/commitments.ts` (fill DOCUMENTS + COMMITMENTS from the 8 research JSONs in scratchpad/research/), `lib/orgs.ts` (final org list), `lib/sources.ts` (append new SourceRefs). Integrity tests from A1 must pass.

Process: read all research JSONs → dedupe/merge (same commitment reported by 2 slices) → normalize ids (`doc:` prefixes none; kebab) → map themes/status to enums → attach capabilityIds + pressureIds + aliases by hand per commitment → verification subagent pass on the riskiest/lowest-confidence claims → freeze. Target 60–90 commitments, every one with strategyImplication + eli5.

- [ ] Steps: merge script/manual synthesis → verification pass (subagent, spot-check ~15 riskiest against live URLs) → tests → commit.

### Task B2: Best-practice → author guidance + rubric + comparators

**Files:** Modify `lib/author/templates.ts` (final guidance/prompts per section from best-practice.json). Create `lib/author/rubric.ts` (`export const RUBRIC: {sectionCriteria: Record<string,string[]>; documentCriteria: string[]; failureModes: string[]}` for the LLM review), `lib/comparators.ts` (`export interface Comparator { id; title; org; date; url; sections: string[]; strengths: string[]; weaknesses: string[]; lesson: string }` + data).

- [ ] Steps: synthesize → tests (comparator integrity: unique ids, urls) → commit.

### Task C1: Commitments explorer route

**Files:** Create `commitments/+page.svelte`, `components/commitments/CommitFilters.svelte`, `CommitShelf.svelte`, `CommitTimeline.svelte`, `FlowMap.svelte`, `CommitDemand.svelte`, `CommitDrawer.svelte`, shared `lib/commitmentsFilter.svelte.ts` (rune store: lens, filters, selection, `filtered` derived).

Invoke dataviz + frontend-design skills before building. Lenses: Shelf / Timeline / Flow map / Demand; persistent filter row + stat band; right detail drawer (pattern: ask-dock). SVG hand-rolled; FlowMap radial (DfE centre, rings by org group; edge width ∝ commitment count; click edge/node filters list). Timeline horizontal 2024→2030+, colour=theme, glyph=status, undated bucket. Demand: stacked bars per capability area + must-answer list (statutory + in-delivery, sorted).

- [ ] Steps: store → page shell + filters + stat band → shelf → timeline → flow map → demand → drawer → cross-link (landscape footer, briefing) → visual check → commit.

### Task C2: RAG + method + glossary integration

**Files:** Modify `lib/retrieval.server.ts` (index commitments + comparators chunks), `method/+page.svelte` (document the commitments sweep, confidence taxonomy, feature-scoring table), `chat/+server.ts` system prompt mention. Create `lib/glossary.ts` (~25 terms: data spine, GIAC, LEO, UPN, ULN, DUAA, NPD, EES, IDS, One Login…) + `components/Term.svelte` (dotted-underline hover tooltip).

- [ ] Steps: corpus chunks → glossary + Term → method page sections → commit.

### Task D1: Author store + Draft tab

**Files:** Create `lib/author/authorState.svelte.ts` (rune store `author`: `doc: StrategyDoc`, `active: sectionId`, `tab: 'draft'|'verify'|'plan'|'export'`, snapshots list, roadmap+risks+measures state, localStorage persistence keys `keystone-author-v1`, `keystone-author-snaps-v1`, `keystone-author-plan-v1`; mutations addSection/removeSection/renameSection/moveSection/setHtml/snapshot/restore). Create `author/+page.svelte` (workspace shell + tabs), `components/author/SectionEditor.svelte` (contenteditable + toolbar B/I/H/•/1./link/quote/clear via execCommand, paste→sanitizeHtml, input→debounced setHtml), `components/author/GuidancePanel.svelte` (template guidance, prompts, comparator exemplars, insert-starter buttons: diagnostic brief → markdownToHtml, commitment implications for section, drafted policies), `components/author/SectionRail.svelte` (section list, status dots, add/reorder).

- [ ] Steps: store → page shell → rail → editor (test typing/paste manually via dev server) → guidance panel → autosave verify (reload persists) → commit. **Done + browser-verified (typing, autosave, insert-starter).**

### Task D2: Verify tab + /review endpoint

**Files:** Create `author/review/+server.ts` (SSE; request `{title, sections:[{id,title,text}], scenario:{name, posturesSummary}, focus?: sectionId}`; response events status/tick/result; result `{sections: [{id, score, verdict, strengths[], weaknesses[], suggestions[]}], document: {score, verdict, contradictions[], topFixes[], missingComponents[]}}` validated + clamped like `/consider`; grounded in `retrieve()` + RUBRIC + commitments must-answer list). Create `components/author/VerifyPanel.svelte` (runs coverage + heuristics instantly; deep-review button streams), `components/author/CoverageMatrix.svelte` (commitments×sections grid, colour by level, click→drawer/gap), `components/author/GapList.svelte` (statutory gaps first, each with "insert starter" action).

- [ ] Steps: endpoint (validate function unit-testable in `lib/author/reviewValidate.ts` + test) → VerifyPanel deterministic parts → matrix + gap list → deep review wiring → manual SSE test via curl → commit.

### Task D3: Plan tab (roadmap + risks + measures + stakeholders)

**Files:** Create `lib/author/plan.ts` (`export interface Milestone {id; title; quarter; owner; sectionId?; commitmentId?}`, `export interface Risk {id; title; likelihood: 1-5; impact: 1-5; mitigation; sectionId?}`, `export interface Measure {id; name; source; sectionId?; baseline?; target?}` + `suggestMilestones(doc, coverage)` from commitment timeframes + `suggestRisks(coverage, tensions)` + `MEASURE_LIBRARY` (~30 real DfE series w/ EES/collection sources)), `components/author/PlanPanel.svelte` (roadmap quarter-grid timeline + add/edit; risk matrix 5×5; measures picker per section; stakeholder checklist from STAKEHOLDERS with consult-status). Test: suggestMilestones/suggestRisks in author.test.ts.

- [ ] Steps: plan.ts + tests → PlanPanel UI → commit.

### Task D4: Export tab + snapshots + publish preview

**Files:** Create `components/author/ExportPanel.svelte` (typographic preview render of the doc — print CSS `@media print`; download .md via htmlToMarkdown, .docx via POST `/projects/dfe-data-strategy/synth?export=docx`, JSON export/import w/ validation; snapshot list: name/save/restore/delete + coarse diff (per-section word delta)). Modify `lib/author/serialize.ts` if gaps found.

- [ ] Steps: serializeDoc → panel → manual export tests (md, docx, json round-trip) → commit.

### Task E1: Headline-first pass on Understand pages + workbench CTA

**Files:** Modify `landscape/+page.svelte`, `strategies/+page.svelte`, `frameworks/+page.svelte`, `legislation/+page.svelte`, `dfe/+page.svelte`, `sector/+page.svelte`: add `TakeawayBar` under masthead (one impactful sentence + stat chips + drill anchors), wrap the long matrices in "Show all N" reveals, standardize `NextStep` foot strip following journey order. Modify `workbench/+page.svelte`: add "→ Draft the strategy in the Author" CTA. Modify `intel` page: link commitments.

- [ ] Steps: per page (takeaway copy written fresh per page from its data) → visual check → commit.

### Task E2: Feature-gap scoring finalization

**Files:** Create `docs/keystone-feature-gap-analysis.md` (final scored table w/ per-criterion scores + rationale + build status). Modify `method/+page.svelte` (scoring table summary). Anything scoring >30 not yet built gets built here (expected: intel-watches for commitments — add commitment keywords to `WATCHES` in `lib/intel.server.ts`).

- [ ] Steps: finalize scores → build stragglers → docs → commit.

### Task F1: QA + deploy + verify

- [ ] `npx vitest run src/routes/projects/dfe-data-strategy`.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npm run check`.
- [ ] Full `npx vitest run`.
- [ ] Playwright/browser pass on dev server: briefing, commitments (all 4 lenses), author (all 4 tabs), nav mobile menu.
- [ ] Merge `keystone-upgrade` → master, push.
- [ ] Build + deploy (sandbox disabled): `~/strange_rambling_svelte/scripts/deploy.sh`.
- [ ] Verify live: curl `https://strangeramblings.com/projects/dfe-data-strategy/commitments` + `/author` (200 + content).
- [ ] Update memory (`project_keystone_data_strategy.md`), write delivery report for John.

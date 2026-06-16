# Keystone — a DfE data-strategy workbench

**Spec date:** 2026-06-16
**Route slug:** `dfe-data-strategy` (sibling to `dfe-data-estate`)
**Status:** approved direction (brainstorming), building autonomously
**Author:** John Kelly (built with Claude Code)

---

## 1. What it is

Keystone is a research-grounded decision-support tool that helps a DfE data-strategy lead **understand the pressures** acting on the department's use of data — from across government, from DfE's own policy agenda, and from its delivery partners — and **shape a strategy that can deliver against all of them**. It wears the policy-engine's clothes (the warm-brutalist "Field Study" presentation, the rune-backed app state, bespoke SVG charts, the Research/ELI5 narrative toggle, a project-bound "Ask the model" RAG) but the engine models **strategy choices**, not pupil outcomes.

It is **not** a numeric forecaster. It is a **strategy-design workbench**: a transparent, evidence-weighted *rubric* that scores how well a chosen strategy covers the pressures, advances data maturity, and respects legal & delivery feasibility — and flags the tensions a strategy must resolve.

### Approved decisions (from brainstorming)
- **Core model:** strategy-design workbench (not a numeric sim).
- **Primary deliverable:** an *interactive diagnostic* (on-screen). Export is secondary.
- **Visibility:** public research landscape + private (owner-only) workbench.
- **Uploads:** Office artefacts extracted server-side and synthesised through the standard LLM gateway (no special local-only handling); workbench is auth-gated and uploaded content is never added to the public RAG corpus (hygiene).
- **Levers:** *both* posture toggles **and** allocation sliders.

## 2. Goals & non-goals

**Goals**
- Give the lead a single surface to see the **landscape of pressures** and test **strategic trade-offs**.
- Ground everything in real UK-government and corporate sources (cited, confidence-rated).
- Mirror the policy-engine's look, feel and interaction patterns.
- Integrate **deeply with the policy-engine** as a source of DfE-specific data pressures and conclusions.
- Let the lead **upload their own Office artefacts** (existing strategy drafts, audits, data maps) and synthesise them into the diagnostic.

**Non-goals**
- No numeric forecasting of outcomes/£ over time.
- No persistence of uploaded content to any shared/indexed store.
- No claim to be an official DfE position (personal project disclaimer, as policy-engine).

## 3. Information architecture

Mirrors the policy-engine shell: sticky masthead, in-flow sticky **levers** sidebar (spine → peek → full drawer), a scenario bar, `SectionNav`, an "Ask the model" FAB.

**Public landscape (research-grounded Field Studies):**
- `/` — **Briefing**: the question ("What would it actually take for DfE to deliver on data?"), the thesis, routes into the studies and the workbench.
- `/landscape` — *The view from above*: cross-government data ambitions & pressures (National Data Strategy, the CDDO/DSIT digital-and-data roadmap, AI Opportunities, ONS IDS, interoperability/"once-only").
- `/legislation` — *Legal foundations & gateways*: the 3-layer legal registry (data-protection basis / legal power-gateway / governance).
- `/frameworks` — *What good looks like*: UK-gov frameworks (DMA for Government, Government Data Quality Framework, Data Ethics Framework, ATRS) vs corporate canon (DAMA-DMBOK, DCAM, CDMC, data mesh) — "what should already exist".
- `/dfe` — *DfE in context*: the estate (links `dfe-data-estate`), the partner web, the consistent child identifier / data spine (links policy-engine `/monitor`, `/jigsaw`), NPD.
- `/method` — how the alignment engine scores; sources; confidence ratings; the trace viewer.

**Private workbench (owner-only):**
- `/workbench` — the interactive diagnostic (pressures + maturity + levers + alignment & tensions + recommended focus + export).
- `/workbench/upload` — Office-artefact upload & synthesis.

**Endpoints:**
- `POST /projects/dfe-data-strategy/chat` — project-bound RAG (BM25 over the research corpus), SSE stream, same pattern as policy-engine.
- `POST /projects/dfe-data-strategy/synth` — extract + synthesise an uploaded artefact (owner-only).

## 4. Conceptual model

1. **Pressures library** (`pressures.ts`) — research-cited pressures the strategy must answer to, each tagged by **origin** (`cross-government` | `dfe-policy` | `partners`), with `severity`, `urgency`, the **capability areas** it stresses, and a source citation. ~24–30 entries.
2. **Maturity dimensions** (`maturity.ts`) — the *Data Maturity Assessment for Government* dimensions, each with a corporate crosswalk (DAMA/DCAM). The lead sets **current** and **target** level (1–5) per dimension.
3. **Capability areas** (`capabilities.ts`) — 6–8 investment categories (governance, platform & infrastructure, skills & literacy, interoperability & standards, data quality, ethics & trust, partner data-sharing). These are the allocation buckets and the join between pressures and levers.
4. **Levers** (`postures.ts` + allocation) —
   - *Posture axes* (−1…+1 sliders): centralise↔federate, build↔buy, open-by-default↔secure-by-default, standardise-now↔iterate, platform-led↔capability-led, deliver-in-house↔partner-led, etc.
   - *Allocation sliders* (0…100, normalised): share of finite effort across the capability areas.
5. **Alignment engine** (`engine.ts`) — deterministic, transparent rubric. See §5.
6. **Scenarios/presets** (`scenarios.ts`) — "Status quo", "Centralised platform-first", "Federated standards-first", "AI-ambition-led", "Trust & governance-first" + user-saved + A/B compare. Permalink-encoded (`#s=`), localStorage-persisted.

## 5. The alignment engine (the rubric)

Pure function `runAlignment(state): AlignmentResult`. Deterministic; client-side; traceable. Inputs: `{ postures, allocation, maturityCurrent, maturityTarget }`. Computes:

- **Capability strength** `cap[area] ∈ [0,1]`: from allocation share (concave-saturating, so over-funding one area has diminishing returns) modulated by posture multipliers (e.g. `centralise` boosts `platform`, dampens `partner-sharing`; `open-by-default` boosts `interoperability`, raises a governance/legal cost).
- **Pressure coverage** `cov[pressure] ∈ [0,1]`: weighted mean of `cap[area]` over the pressure's `demands[]`, weighted by `severity`. The headline is `Σ severity·cov / Σ severity` (overall coverage), plus per-origin coverage.
- **Maturity progress**: for each dimension, an estimate of advancement toward `target` driven by the capability areas that feed it (with a gap penalty if the target is set far above current and under-resourced).
- **Tensions** (`Tension[]`): rule-based flags where posture/allocation choices conflict — e.g. *open-by-default* while a confidentiality-bound pressure is high; *centralise* while *partner-led* is high (incoherent operating model); expanding partner data-sharing while **governance** and **ethics & trust** are under-funded (a legal/feasibility tension, cross-referenced to the legislation registry); *standardise-now* with low skills allocation (capacity to deliver). Each tension has severity, an explanation, the inputs that triggered it, and a suggested resolution.
- **Legal/feasibility checks**: surfaces the legislation registry items implicated by the chosen posture (e.g. cross-org sharing → DEA 2017 gateway + UK GDPR Art 6 basis + DPIA/governance).
- **Recommended focus**: the unaddressed pressures with the highest `severity·(1−cov)` and the maturity dimensions with the biggest under-resourced gaps.
- **Trace**: every headline value can be decomposed to its contributing terms + citation (the policy-engine trace pattern), rendered on `/method` and in a `TraceViewer`.

All coefficients live in a small `params.ts` with provenance notes; nothing is a black box.

## 6. Data model (`types.ts`, abridged)

```ts
type Origin = 'cross-government' | 'dfe-policy' | 'partners';
type LegalLayer = 'protection-basis' | 'legal-gateway' | 'governance';
type Confidence = 'high' | 'medium' | 'low' | 'assumption';

interface Pressure { id; title; origin: Origin; description; demands: string[];
  severity: number; urgency: number; sourceName; sourceUrl; confidence: Confidence;
  policyEngineRef?: string; /* deep link into policy-engine field study */ }
interface MaturityDimension { id; name; description; govSource; corporateCrosswalk }
interface CapabilityArea { id; name; description }
interface PostureAxis { id; leftLabel; rightLabel; description; tension;
  affects: { area: string; weight: number }[] }
interface Legislation { id; name; citation; layer: LegalLayer; summary; relevance; sourceUrl }
interface Framework { id; name; type: 'uk-gov' | 'corporate'; summary; keyElements: string[]; sourceUrl }
interface StrategyState { postures: Record<string, number>; allocation: Record<string, number>;
  maturityCurrent: Record<string, number>; maturityTarget: Record<string, number> }
interface AlignmentResult { overallCoverage; coverageByOrigin; coverage: Record<string,number>;
  capability: Record<string,number>; maturityProgress: Record<string,number>;
  tensions: Tension[]; legalImplicated: string[]; focus: FocusItem[] }
```

## 7. Reuse map

| New file | Source | Treatment |
|---|---|---|
| `+layout.svelte`, design tokens, `pe-*` global classes | policy-engine `+layout.svelte` | copy + adapt (rename brand, levers semantics) |
| `appState.svelte.ts` | policy-engine | rewrite for StrategyState; keep scenario-identity + compare + persistence patterns |
| `scenarios.ts` (encode/decode/saved) | policy-engine | adapt |
| `retrieval.server.ts` + `corpusIndex.json` | policy-engine | copy retrieval; new corpus from research + page prose; new synonym map |
| `chat/+server.ts` | policy-engine | copy; new system prompt + project key |
| `StoryMasthead`, `StorySection`, `SectionNav`, `NarrativeToggle`, `ConfidenceBadge`, `Scorecard` | policy-engine components | copy ~verbatim |
| `LeverDrawer`, `PeekRail`, `ScenarioSelector` | policy-engine | adapt to posture+allocation levers |
| live estate strip | `dfe-data-estate/lib/live.server.ts` | reuse pattern (optional, on `/dfe`) |
| upload/synth | `$lib/jkai/extract` (`extractText`, `synthesize`) | call directly |
| export | `$lib/jkai/extract` `synthesize('markdown'→'docx'/'pdf')` | reuse |

Domain-new components: `PressureMatrix`, `PressureCard`, `MaturityRadar`, `AllocationDial`, `PostureSlider`, `AlignmentView`, `CoverageBars`, `TensionList`, `RecommendedFocus`, `TraceViewer`, `UploadSynth`, `LegalRegistry`, `FrameworkGrid`, `AskModel`.

## 8. Deep policy-engine integration (explicit requirement)

- **Pressures sourced from the policy engine:** DfE-policy pressures (the consistent child identifier & data spine, the "similar schools" algorithm, daily attendance data, SEND/EHCP data, NEET tracking, multi-agency safeguarding data-sharing) each carry a `policyEngineRef` deep-linking the relevant policy-engine field study (`/monitor`, `/jigsaw`, `/send`, `/neet`, `/attendance`).
- **A "From the Policy Engine" panel** on `/dfe` and in the workbench surfaces the policy-engine's data-related conclusions as direct inputs to the strategy.
- **RAG corpus** includes condensed summaries of the policy-engine's data/monitoring field studies, so "Ask the model" can answer cross-project questions.
- **Cross-links** in the masthead/footer and inline prose to `/projects/policy-engine` and `/projects/dfe-data-estate`.

## 9. Visibility & security

- Public pages call `requireProjectPublic('dfe-data-strategy', event)` (public by default; owner can toggle private).
- `/workbench/**` additionally require a signed-in session (`locals.auth()`) → 404 for the public even when the project key is public. Owner-only.
- `synth` endpoint: owner-only (session required) + per-IP rate limit.
- Uploaded content lives only in client workbench state for the session; never written to `corpusIndex.json`.

## 10. Rich feature list (capabilities)

**Public landscape**
1. Briefing masthead with the strategic question + thesis + data asks.
2. Pressures landscape — the full pressures library grouped by origin, filterable, severity/urgency badges, each cited + confidence-rated.
3. Cross-government landscape narrative (National Data Strategy missions/pillars, CDDO/DSIT roadmap, AI Opportunities, ONS IDS).
4. Legal registry — interactive 3-layer (protection-basis / legal-gateway / governance) browser with citations.
5. Frameworks gallery — UK-gov vs corporate, side-by-side, with key elements + crosswalk.
6. DfE-in-context map — partner web + estate + the data spine, deep-linked to policy-engine & dfe-data-estate.
7. Research/ELI5 narrative toggle site-wide.
8. "Ask the model" RAG over the research corpus (cited, scoped, SSE-streamed).
9. Method page with the rubric explained + sources list + trace viewer.

**Private workbench (the diagnostic)**
10. Posture toggles (strategic stance sliders) with live consequence/citation tooltips.
11. Allocation dial — split finite effort across capability areas (normalised, with a remaining-budget read).
12. Maturity self-assessment — current vs target per DMA-for-Government dimension (radar + bars).
13. Alignment view — overall + per-origin pressure coverage, animated on every lever change.
14. Per-pressure coverage bars with "why" (which capability areas drive it).
15. Tension detector — flags incoherent/under-resourced/illegal-risk combinations, each with explanation + suggested resolution.
16. Legal-implication panel — which legislation registry items the current posture triggers.
17. Recommended focus — the highest-leverage unaddressed pressures + maturity gaps.
18. Scenario presets (5 defensible stances) + save/load custom + **A/B compare** (two strategies side by side).
19. Permalink encoding of the full strategy state (shareable `#s=` link) + localStorage persistence.
20. Trace viewer — decompose any headline score to its terms + sources.
21. **Upload & synthesise** Office artefacts (.docx/.xlsx/.pdf/.md/.csv) → extracted, LLM-synthesised into: a summary, detected maturity signals, detected pressures the document already addresses, and suggested posture/allocation nudges the lead can apply.
22. Export the diagnostic as a board-ready brief (markdown → DOCX/PDF via `synthesize`).
23. Owner-only privacy; uploaded content stays in-session.

## 11. Tech & file layout

SvelteKit + Svelte 5 runes (no external state lib). Bespoke SVG (no chart lib). Global CSS + scoped styles, warm-brutalist tokens (Fraunces / DM Sans / JetBrains Mono). LLM via `getOpenAIClient`/`getModel` (`$lib/deepdive/keys`), GLM-5.1, `thinking: disabled`. All under `src/routes/projects/dfe-data-strategy/` with `lib/`, `components/`, route dirs, `chat/`, `synth/`.

## 12. Phasing

- **Phase 1 (this build):** foundation (types, engine, data, appState, scenarios, layout, tokens, reused components) → public landscape pages (data-driven, grounded by the research workflow) → private workbench (pressures, maturity, posture+allocation levers, alignment + tensions + focus, scenarios + A/B, trace) → upload/synthesis → RAG chat → export → link on `/projects` → deploy + verify live.
- **Later (optional):** live estate signal strip on `/dfe`; discovery-style "watch" for new data-strategy publications (reusing data-standard-designer's cron pattern); richer DOCX export with the evidence pack.

## 13. Verification

- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` clean (or no new errors).
- Build succeeds (sandbox disabled at adapter-node step).
- Deploy via `scripts/deploy.sh`; verify the live route on `strangeramblings.com/projects/dfe-data-strategy`.
- Confirm landscape public + workbench 404s for the public (owner sees it signed in).

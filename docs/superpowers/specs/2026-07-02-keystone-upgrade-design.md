# Keystone upgrade — commitments explorer, strategy author, UX overhaul

**Date:** 2026-07-02 · **Status:** approved (autonomous build authorized by John's brief)
**Route:** `/projects/dfe-data-strategy` · **Repo:** `strange_rambling_svelte` · **Branch:** `keystone-upgrade`

## 1. Goal

Turn Keystone from a *landscape + diagnostic* tool into a **one-stop shop for writing a DfE data strategy**. Four workstreams from John's brief:

1. **Commitments explorer** — a thorough analysis of the white-paper landscape (DfE + cross-government, 2024→mid-2026), presented in a graphical, appealing interface where a user can explore each commitment and interpret what it means for the data strategy (new services, new data flows, new partner relationships — e.g. the data spine).
2. **Strategy authoring** — write the data strategy *in the product*: an interactive WYSIWYG editor with automated verification (do the policies make sense, what is addressed, where are the gaps).
3. **UX simplification** — the journey is confusing; simplify views, make each section's headline message impactful with drill-down.
4. **Feature gap analysis** — thorough, scored /100; design and build everything scoring >30.

Constraints: keep the Keystone design language (Fraunces / DM Sans / JetBrains Mono, warm-brutalist paper, `.pe-*` helpers, hand-rolled SVG viz); no new DB tables (client-side persistence like the rest of Keystone); all LLM calls through the existing Z.AI transport used by Keystone's endpoints; public pages stay public, owner-only stays 404-gated.

## 2. Information architecture (the simplified journey)

The confusing flat list of 11 tabs becomes a journey with four verbs:

```
Briefing (start here — a router, not a wall of text)
UNDERSTAND   Landscape · Commitments (NEW) · Influence map · Frameworks · Legislation · DfE in context · Sector voices
WRITE        Author (NEW) · Policy builder · ◆ Workbench · ◆ Upload   (◆ = owner-only)
TRACK        Intel radar
REFERENCE    How it works
```

- `SectionNav` regrouped with these labels (desktop tab groups + mobile menu groups).
- **Briefing rebuilt as a router**: one impactful headline, then three big mode cards (Understand / Write / Track), each with a headline stat, one-line promise, and links into its sections. A "suggested path" strip (1 Understand the landscape → 2 Draft in the Author → 3 Verify & track).
- **Headline-first sections**: every Understand page keeps `StoryMasthead` but gains a `TakeawayBar` — ONE big takeaway sentence + 2–4 stat chips + drill-down anchor links. Long matrices (27-pressure grid, 12-framework grid, 33 voices) collapse behind "Show all N" reveals so the first screen is the message, not the table.
- **NextStep strip** standardized at every page foot: "Next: …" links following the journey order.

## 3. Commitments explorer — `/commitments` ("The commitments ledger")

### Data
`lib/commitments.ts` — new dataset, synthesized from a 9-agent research sweep (2026-07-02) of the 2024→2026 white-paper landscape and verified against gov.uk / legislation.gov.uk primary sources. Target ≈60–90 commitments across ≈25–35 documents.

```ts
interface PolicyDocument { id; title; shortName; type: DocType; publisher; date: 'YYYY-MM'; url; oneLiner; status: DocStatus }
interface Commitment {
  id; docId; title;
  what: string; quote?: string;             // plain-English + short verbatim quote
  theme: CommitmentTheme;                    // identifiers|data-sharing|new-service|register|standards|ai|analytics|infrastructure|safeguarding|accountability|workforce|funding
  status: CommitmentStatus;                  // statutory-duty|legislated-not-commenced|in-delivery|announced|proposed|consulting
  timeframe?: string; timeframeDate?: 'YYYY-MM';  // for the timeline
  dfeRole: 'owner'|'deliverer'|'partner'|'complier';
  flows: { from: OrgId; to: OrgId; what: string }[];   // the new data flows this creates
  newServices: string[]; identifiers: string[]; standards: string[]; partners: string[];
  strategyImplication: string; eli5?: string;
  capabilityIds: CapabilityId[];             // ties into the existing engine's 8 capability areas
  pressureIds?: string[];                    // ties into the existing 27 pressures
  aliases: string[];                         // for the Author coverage matcher
  confidence: ConfidenceLevel; sourceUrls: string[];
}
```
`ORGS` — a small registry of organisations for the flow map (DfE centre; ALBs; schools/trusts; LAs; DSIT; DWP; DHSC/NHS; HMRC; Home Office; MoJ; MHCLG; ONS; parents/public; researchers…), each with a ring/angle for layout.

### UI (one route, four lenses + a persistent detail drawer)
- **Header**: headline stat band (N commitments · M documents · X new data flows · Y statutory duties) + filter row (theme, status, DfE role, document, text search) that applies across all lenses.
- **Shelf** — the white-paper shelf: document cards (spine-like, grouped by publisher/type) with commitment counts; click → its commitments.
- **Timeline** — horizontal 2024→2030 timeline; commitments plotted at `timeframeDate`, colour = theme, glyph = status; undated bucket at the end. Reveals the delivery wall (what must land when).
- **Flow map** — the marquee viz: organisations as nodes (DfE-centred radial layout), each commitment's `flows` as directed edges; edge weight = number of commitments creating that flow; click an edge or node → the commitments behind it. This is the "new connections between partners" picture.
- **Demand** — what it all means for the strategy: commitments aggregated per capability area (stacked by status) next to the engine's existing pressure-demand; the auto-generated **must-answer list** (every statutory duty + in-delivery commitment with its `strategyImplication`).
- **Detail drawer** (right dock, like Ask-the-model): full commitment record — what, quote, source links, flows, services/identifiers/standards, implicated capabilities & pressures, "what this means for the strategy", confidence badge.

### Integration
- Commitments join the RAG corpus (`retrieval.server.ts`) so Ask-the-model and the Policy builder ground on them.
- `sources.ts` extended with the new primary sources.
- Method page documents the research sweep + confidence taxonomy.

## 4. Author workspace — `/author` ("Write the strategy")

Public (state client-side in localStorage, like the rest of Keystone; LLM endpoints public + rate-limited like `/consider`).

### Document model
```ts
interface StrategySection { id; title; guidance; prompts: string[]; html: string }
interface StrategyDoc { title; sections: StrategySection[]; updatedAt }
```
Seeded from `SECTION_TEMPLATES` (≈14 sections from the best-practice research: vision; principles; users & needs; commitments & obligations; architecture & platforms; standards & interoperability; identifiers; quality; governance & ownership; legal basis; ethics & public trust; workforce & culture; analytics & AI; open data & research; security; funding; delivery roadmap; measurement). Sections can be added/removed/renamed/reordered.

### Workspace tabs
- **Draft** — sectioned WYSIWYG editor: contenteditable per section with a small toolbar (B / I / H / • / 1. / link / quote / clear), paste-sanitized to an allowlist; per-section guidance panel ("a strong section answers…", prompts, and *insert starter text* from Keystone: the diagnostic brief, commitment implications, drafted policies); word counts; autosave (debounced) to `keystone-author-v1`.
- **Verify** — the automated verification suite:
  1. *Coverage sweep* (deterministic, instant): alias-matching of draft text against commitments + pressures + capabilities → addressed / touched / missing, with statutory-duty gaps ranked first. Rendered as a gap list + a commitments×draft coverage matrix.
  2. *Completeness heuristics* (deterministic): per-section checks derived from best-practice criteria (enough substance, has dates, names an owner, has a measurable number, cites evidence).
  3. *Deep review* (`/review` SSE endpoint): LLM reviews the whole draft against the best-practice rubric + the RAG corpus + the current workbench posture; returns per-section scores /100, strengths, weaknesses, concrete suggestions, and document-level contradictions + top-3 fixes. Validated server-side like `/consider`.
- **Plan** — delivery roadmap builder (milestones: title, quarter, owner, linked section/commitment; timeline render; seeded suggestions from commitment deadlines) + risk register (auto-draft candidates from unresolved tensions and coverage gaps; editable) + measures picker (success measures library per section, drawn from existing DfE collections/statistics).
- **Export** — clean typographic preview (print-ready), download .md / .docx (reuse `/synth?export=docx`), JSON export/import, snapshots (named local versions with restore + rough diff counts).

### Engine
`lib/author/` — pure, unit-tested modules: `templates.ts`, `sanitize.ts` (allowlist), `serialize.ts` (html⇄markdown), `coverage.ts` (alias matcher), `heuristics.ts` (completeness), `measures.ts`, `roadmap.ts`. New endpoint `author/review/+server.ts` (SSE, Z.AI, strict-JSON validated).

## 5. Feature gap analysis (framework)

Score = 0.40·impact-on-strategy-quality + 0.25·differentiation (does anything else do this for a DfE author?) + 0.20·feasibility-today + 0.15·fit-with-Keystone. Score >30 ⇒ design & build. Final scored table lives in the delivery report + method page; preliminary set (finalized after research lands):

| Feature | Prelim. | Verdict |
|---|---|---|
| Commitments explorer (4 lenses + drawer) | 95 | build (core ask) |
| WYSIWYG author + verification suite | 94 | build (core ask) |
| Commitment×draft coverage matrix | 86 | build (Verify) |
| LLM deep review vs best-practice rubric | 84 | build (Verify) |
| Delivery roadmap builder | 68 | build (Plan) |
| Comparator library (how MoJ/DHSC/DfT structured theirs, per-section exemplars) | 66 | build (Author guidance panel) |
| Measures/KPI picker | 64 | build (Plan) |
| Risk register generator | 58 | build (Plan) |
| Extend RAG + Ask-the-model over commitments | 55 | build |
| Stakeholder/consultation mapper | 52 | build light (Plan) |
| Version snapshots + restore | 48 | build (Export) |
| Intel radar ↔ commitments watches | 44 | build light |
| Print-ready publish preview | 42 | build (Export) |
| Glossary of DfE data terms (hover tooltips) | 38 | build light |
| Consultation-response analyzer | 25 | skip |
| Multi-user comments | 20 | skip (no team auth model) |

## 6. Testing & rollout

- Vitest: dataset integrity (unique ids, valid docId/capabilityIds/pressureIds refs, URLs present, enum values), author engine (coverage matcher, heuristics, sanitize, html⇄md round-trip), org registry refs in flows.
- `npm run check` (NODE_OPTIONS=--max-old-space-size=8192), `npm run test`, build with sandbox disabled, deploy via `scripts/deploy.sh`, verify live with curl + screenshot. Merge `keystone-upgrade` → master before deploy.
- No schema changes; no cron changes (intel watches are data-only).

## 7. Risks

- **Research accuracy**: commitments are policy claims — every record carries confidence + source URLs; verification pass before dataset freeze; low-confidence items rendered with the existing `ConfidenceBadge`.
- **contenteditable quirks**: keep the toolbar minimal, sanitize aggressively, autosave defensively; JSON export is the escape hatch.
- **Bundle size**: datasets are plain TS modules code-split per route; the flow map is hand-rolled SVG (no new deps).

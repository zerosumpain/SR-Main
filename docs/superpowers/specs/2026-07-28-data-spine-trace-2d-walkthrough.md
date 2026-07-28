# The Data Spine — "Trace a request": a 2-D, layered, animated walkthrough

**Date:** 2026-07-28
**Route:** `/projects/data-spine/trace` (PRIVATE, inherits the data-spine layout gate)
**Grade:** Full autonomous (kick-off: "do this autonomously")
**Primary audience:** a Permanent Secretary — must open at ELI5 and descend to engineering detail without losing the thread.

---

## 1. The brief, restated

The existing 3-D federation simulator (`/federation/sim`) is beautiful but complicated. Keep it. Add a
**second, complementary visualisation** that:

1. Portrays the complexity of information transfer **stage by stage** — commission, ledger update,
   school consent, MIS calculation, DfE aggregation, answer.
2. Is **2-D and animated**.
3. Uses libraries that make it **simple**, not clever.
4. Lets a user **peel back layers** behind each scenario: physical, networking, storage, compute,
   analytical, practical.
5. Shows **how much time actually passes** — a pre-agreed non-PII conversation vs the flow of time
   needed to consent to a *new type* of request.
6. Demonstrates the role of **OpenSAFELY** and the other methodologies in play.
7. Takes a user from **ELI5 → detailed exploration**.
8. Makes the case that **MIS providers joining adds value**, and that **edtech systems** will then want
   to join — a flow of enrichment outward in exchange for basic signals back, plus DfE accreditation.

## 2. Shape

One new route, five stacked instruments, one data module. Everything is a typed constant; nothing is
fetched. The page reads top-to-bottom as an argument and each section is independently explorable.

| # | Section | Component | Answers |
|---|---|---|---|
| 0 | Hero + depth control | (in `+page.svelte`) | "What am I looking at?" |
| 1 | **The trace** | `RequestTrace.svelte` | stages 1–6, animated, per-layer |
| 2 | **The clock** | `TimeLedger.svelte` | machine time vs human time; the reuse dividend |
| 3 | **The methods** | `MethodsMatrix.svelte` | OpenSAFELY and the other 9 methodologies, mapped to stages |
| 4 | **The network effect** | `SupplyFlywheel.svelte` | MIS → edtech onboarding, coverage, accreditation |
| 5 | Next links | (in `+page.svelte`) | onward to Recommendation / Governance / 3-D sim |

### 2.1 The core data model — a stage × layer matrix

Six canonical **stages** (the brief's list, in order):

`COMMISSION → LEDGER → CONSENT → MIS COMPUTE → DfE AGGREGATION → ANSWER`

Six **layers**, presented top-down so the user descends the stack from meaning to matter:

`PRACTICAL → ANALYTICAL → COMPUTE → STORAGE → NETWORK → PHYSICAL`

The product is a **36-cell matrix**. Each cell states: what happens, what actually crosses the boundary
at that layer (the "payload"), who acts, how long it takes, and how it fails. This matrix *is* the
"complexity of information transfer" the brief asks for — the visualisation is a reader for it.

### 2.2 Five scenarios

Each scenario walks the same six stages, but with different durations, different payloads and different
stage behaviour (`fast` / `slow` / `blocked` / `human`).

| id | Name | Point it makes |
|---|---|---|
| `standing` | A standing question, already agreed | the ELI5 baseline — seconds, no humans in the loop |
| `novel` | A question nobody has asked before | the contrast — weeks of governance around ~9 s of machine |
| `safeguard` | A child at risk | the deliberate PII exception, rule-triggered and logged |
| `research` | An accredited researcher (OpenSAFELY-style) | compute-to-data, code in the open, disclosure control |
| `edtech` | An accredited app asks — and gives back | the network-effect scenario feeding section 4 |

### 2.3 Depth

Every narration exists at three depths: **ELI5 · Official · Technical**. The control is page-local
(not the site-wide `app.narrative` binary) and initialises from `app.narrative` once, without an effect.

## 3. Files to touch

| File | Why |
|---|---|
| `src/routes/projects/data-spine/trace/lib/trace.ts` | NEW — every constant: layers, stages, scenarios, the 36-cell matrix, methods, flywheel tiers |
| `src/routes/projects/data-spine/trace/+page.svelte` | NEW — the page: hero, depth control, five sections |
| `src/routes/projects/data-spine/trace/components/RequestTrace.svelte` | NEW — the animated stage rail + layer lens + detail card |
| `src/routes/projects/data-spine/trace/components/TimeLedger.svelte` | NEW — log-scaled machine-vs-human clock |
| `src/routes/projects/data-spine/trace/components/MethodsMatrix.svelte` | NEW — methods × stages, OpenSAFELY case study |
| `src/routes/projects/data-spine/trace/components/SupplyFlywheel.svelte` | NEW — onboarding tiers, coverage, accreditation loop |
| `src/routes/projects/data-spine/components/SectionNav.svelte` | EDIT — add the `◧ Trace a request` CTA beside the simulator CTA |
| `src/routes/projects/data-spine/model/+page.svelte` | EDIT — link the new walkthrough from the recommendation deck |
| `src/routes/projects/data-spine/lib/sources.ts` | EDIT — add OpenSAFELY / PET / accreditation citations used by the new content |
| `.github/public-routes.txt` | EDIT — the public-surface lockfile must record the new route |

Ten files, of which six are new and self-contained under `trace/`. Proportionate: this is a
multi-component build, not a tweak.

## 4. Verification

- `npm run gate:public-routes` — the route lockfile is regenerated and committed.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — 0 errors.
- `npm run gate:test` — vitest stays green (58+).
- `npm run gate:build` — production build succeeds.
- Screenshot the rendered page from the local homeserv service with SwiftShader (the reliable way to
  eyeball DOM layout for this project — the 3-D headless WebGL2 caveat does not apply, this is pure SVG).
- **Live:** merge to `master`, let CI deploy, then verify by grepping the deployed JS bundle for a new
  string (the page HTML 404s to anonymous traffic because the project is private).

## 5. Decision Log

| # | Decision | Options considered | Chosen | Why | Reversibility |
|---|---|---|---|---|---|
| D1 | Rendering technology | (a) raw SVG + CSS + Svelte runes; (b) `@xyflow/svelte` (already a dep); (c) a new animation lib (GSAP/anime.js); (d) canvas 2-D | **(a)** | All 11 existing `model/components/*.svelte` are exactly (a); it is the precedent, costs no new dependency, and inherits the design tokens directly. `@xyflow/svelte` is built for *user-editable* node graphs and fights a fixed choreography and the design system. Adding an animation lib for six moving dots is unjustifiable. | Easy — components are isolated |
| D2 | New dependency? | add `d3-scale` usage for the log time axis vs hand-rolled `Math.log` | **hand-rolled** | The time axis needs exactly one log mapping; importing a scale module for it adds a chunk for four lines of arithmetic. `d3` stays unused by this route. | Trivial |
| D3 | Replace or add? | replace the 3-D sim vs add a second visualisation | **add** | Brief is explicit: "I don't want to get rid of the current visual". The two are now framed as complementary: 2-D trace = *what happens, in order, at every layer*; 3-D sim = *the shape of the whole network*. | n/a |
| D4 | Route name | `/anatomy`, `/wire`, `/walkthrough`, `/trace` | **`/trace`** | "Trace a request" is the verb a Perm Sec and an engineer both understand, and it names the artefact the ledger actually produces. | Cheap (308 stub, precedent exists) |
| D5 | IA placement | a new 8th SectionNav beat vs a second CTA beside the simulator | **second CTA** | The seven beats are a research argument (problem→next steps); the trace and the sim are both *instruments*, not beats. Pairing them as two CTAs states their relationship. | Trivial |
| D6 | Depth control | reuse the site-wide `app.narrative` (Research/ELI5) vs a page-local three-way | **page-local three-way, seeded once from `app.narrative`** | The brief wants a real gradient (ELI5 → detail), which a binary cannot express. Seeding once (no `$effect` sync) sidesteps the documented state-in-effect trap. The global toggle still works everywhere else. | Easy |
| D7 | Layer order | bottom-up (physical→practical) vs top-down (practical→physical) | **top-down** | The audience starts at meaning, not matter. Descending the stack is a natural "peel back the layers" gesture; ascending it is an engineering habit. | Trivial (array order) |
| D8 | Timing numbers | omit them; give ranges; give point estimates | **point estimates, labelled illustrative, with the real anchors cited** | A Perm Sec needs a number to react to. Every timing is marked `hypothesis` with a visible note, and the human-time anchors (DPIA, DSA, accreditation, MIS release cycles) cite published processes. Fabricated precision would be worse than a range; unlabelled precision would be dishonest. | Data-only edit |
| D9 | OpenSAFELY framing | "England already does this" vs a careful comparison | **careful comparison** | OpenSAFELY is compute-to-data across **two** EHR vendor platforms, not a 14-supplier federation. Overclaiming would be the same error the existing memory records for the England-vs-OpenSAFELY spectrum. The page states what transfers and what does not. | Copy edit |
| D10 | Edtech accreditation argument | present as recommendation vs present as hypothesis with risks | **hypothesis + an explicit risk panel** | The "give to get" bargain has real hazards — market power, coercive access, DfE drifting into de-facto regulation of edtech, competition law. Presenting only the upside to a Perm Sec would not survive first contact with their own lawyers. | Copy edit |
| D11 | Workspace | edit the shared checkout vs a git worktree | **worktree at `~/sr-trace`** | The shared checkout is on `jkai-er-truncation-salvage` with PR #46 open — a concurrent session's work. The documented shared-worktree hazard makes branch-switching there unsafe. | n/a |

## 6. Out of scope (logged, not built)

- Wiring the trace into the 3-D scene (cross-visual highlighting). Attractive, but couples two
  independent instruments and doubles the failure surface. Left as a follow-up.
- Persisting the depth choice to `localStorage`. The layout already persists `ds-narrative`; a second
  persisted key for a single page is noise.
- An "export this trace as a PDF/one-pager" action. Genuinely useful for the Perm Sec audience, but it
  belongs to the site's existing report tooling, not this route.

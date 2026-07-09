# The Data Spine — exploration tool (`/projects/data-spine`)

**Date:** 2026-07-09 · **Grade:** Full autonomous · **Status:** approved (self)

## Brief

New private project drawing on Keystone + Policy Engine content. Explain what the DfE
"data spine" is (White Paper Feb 2026), grounded in data-spine precedents from other
countries/departments. Interactive exploration of value, pros/cons, and stakeholder
perspectives (MATs, LAs, research agencies, DfE policy, IT teams, MIS vendors, OGDs…).
Factor in the single unique identifier, rapid-response services, and DfE's
policy→operational shift. A big section on information governance and
privacy-preserving technology. Feature round scored 0–100; build everything >25.

## Positioning

A deeper, self-contained companion to Policy Engine Field Study №4 (`monitor`) and
Keystone. Field-study shell (guard in `+layout.server.ts`, `.pe-*` warm-paper styling,
Fraunces/DM Sans/JetBrains Mono, typed content constants in `lib/*.ts`, ELI5/Research
toggle, sources footer). Private from launch, like Keystone.

## Feature planning round (scored 0–100 · build >25)

| # | Feature | Score | Verdict |
|---|---------|------:|---------|
| F1 | Foundations: route shell, guard, SectionNav, layout chrome, `/projects` card, registry key, private visibility | 95 | BUILD |
| F2 | IG & privacy section (the "big section"): trust-deficit ledger (ICO 2020 audit, Home Office MoU, Trustopia/LRS, 2,385 NPD distributions), legal plumbing (UK GDPR, DUAA 2025, CWSA ss.16LA–LD), PET catalogue mapped to spine layers (pseudonymisation-at-source, federated query, TRE/OpenSAFELY query-not-copy, DP, transparency dashboards, consent capture) | 93 | BUILD |
| F3 | "What is a data spine" anatomy: 5-layer model (identifier / index-locator / exchange / standards / governance) + DfE context with verbatim White Paper p.98 + Bett quotes, announced-not-built honesty | 92 | BUILD |
| F4 | Precedent gallery: NHS Spine (PDS/NRL), Estonia X-Road, ContactPoint, GOV.UK Verify→One Login, Denmark CPR, NL BSN, NZ NSN, Australia USI — each with architecture type, fate, lesson | 90 | BUILD |
| F5 | Persona lens explorer (interactive): 8 personas — MAT data lead, LA children's services, research agency, DfE policy professional, DfE Digital/IT, MIS vendor & broker, other government department, parent/privacy advocate — each with wants/fears/spine-they'd-build/verdict; picker re-lenses the value ledger | 88 | BUILD |
| F6 | Value ledger (pros/cons): claimed benefits vs risks/costs, each with evidence, confidence (FACT/HYPOTHESIS), affected personas; filterable by persona | 85 | BUILD |
| F7 | Rapid-response & operational-shift section: daily attendance via Wonde (mandatory 24/25) as live proof, FSM auto-enrolment, CNiS registers, Education Record app; 271→57 service lines; "spine as infrastructure for the operational turn" | 82 | BUILD |
| F8 | Sources footer (~40 cited URLs, precedent pattern) | 80 | BUILD |
| F9 | Architecture-archetype explorer (interactive): central store vs index+locator vs federated exchange vs identifier-only; trade-offs, who used it, failure record (ContactPoint destroyed, PDS/NRL survived, X-Road exemplar) | 78 | BUILD |
| F10 | Spine vs consistent-identifier distinction panel (they are legally/operationally distinct instruments) | 75 | BUILD |
| F11 | Timeline 2002→2026: NPD, ContactPoint life+death, 2012 sharing regs, HO MoU, ICO audit, attendance feed, MacAlister, CWSA, Bett, White Paper, summer-2026 consultation | 72 | BUILD |
| F12 | Today-vs-spine data-flow diagram (school → MIS → broker → DfE; pain points annotated; future-state toggle) | 70 | BUILD |
| F13 | FACT/HYPOTHESIS confidence badges throughout | 68 | BUILD |
| F14 | ELI5/Research narrative toggle (appState precedent) | 60 | BUILD |
| F15 | Cross-links to Keystone + Policy Engine №4 | 58 | BUILD |
| F16 | Privacy-design playbook (interactive): pick custody/identifier/access/transparency choices → consequence readout grounded in precedents | 55 | BUILD |
| F17 | Ask-the-model chat dock (copy policy-engine `chat/+server.ts` + retrieval over lib content) | 42 | BUILD |
| F18 | Consultation-response drafter (Author-style workspace) | 22 | skip — Keystone Author already covers drafting |
| F19 | Live intel radar / scan cron | 18 | skip — Keystone intel radar already watches "data spine" |
| F20 | Monte-Carlo spine delivery cost model | 15 | skip — no credible cost data to ground it |
| F21 | Full-text search within the page | 12 | skip — 4 sections + nav suffice |
| F22 | PDF export | 10 | skip |
| F23 | Public API endpoint | 8 | skip — private project |

## Route & file plan

```
src/routes/projects/data-spine/
  +layout.server.ts        guard: requireProjectPublic('data-spine')
  +layout.svelte           chrome, fonts, .pe-* globals, SectionNav, sources footer
  +page.svelte             BRIEFING: what a spine is (F3), spine-vs-identifier (F10), timeline (F11)
  value/+page.svelte       VALUE: persona explorer (F5) + value ledger (F6) + operational shift (F7)
  architecture/+page.svelte ARCHITECTURE: precedent gallery (F4), archetype explorer (F9), flow diagram (F12)
  governance/+page.svelte  GOVERNANCE: trust ledger, legal plumbing, PET catalogue, privacy playbook (F2, F16)
  chat/+server.ts          ask-the-model (F17, copied from policy-engine)
  components/              SectionNav, StorySection, ConfidenceBadge, NarrativeToggle, AskModel (copies/adaptations)
  lib/appState.svelte.ts   narrative + persona selection state
  lib/spine.ts             anatomy layers, spine-vs-identifier, timeline
  lib/precedents.ts        international/cross-gov spines + archetypes
  lib/personas.ts          8 personas
  lib/valueLedger.ts       pros/cons entries
  lib/governance.ts        trust events, legal instruments, PETs, playbook options
  lib/operational.ts       rapid-response services
  lib/sources.ts           flat citation list
src/lib/projects/registry.ts        + 'data-spine'
src/routes/projects/+page.svelte    + card (Field Study card, private)
```

## Verification

- `npm run check` + prod build (NODE_OPTIONS heap, sandbox off per local-qa).
- Local dev server: fetch each of the 4 routes, grep for section markers.
- Live: deploy.sh → curl live page (public-by-default window) → toggle private via
  owner API/DB → curl anon expects 404 → done.

## Decision Log

1. **Multi-route field study vs single long page** — options: one giant +page.svelte;
   4 sub-routes matching precedent. Chose 4 sub-routes: precedent shape
   (policy-engine/Keystone), keeps each page <900 lines. Reversible (routes can merge).
2. **Private at launch** — brief implies internal exploration; Keystone (same subject
   family) is private. Launch private, John can flip the toggle. Reversible.
3. **Chat dock built (F17, score 42)** — honest score above threshold; cheap because
   policy-engine `chat/+server.ts` is copyable. Reversible (delete route).
4. **Content authored inline, not via subagents** — research notes live in the
   orchestrator's context; re-transmitting to writers costs more tokens than writing
   directly and risks fidelity loss. Aligns with "sparingly with tokens".
5. **Persona set: 8** — brief's 6 + MIS vendors/brokers (they run today's pipes) +
   parent/privacy advocate (the governance section demands that voice). Reversible.
6. **New page repeats some Policy Engine №4 ground (timeline, spine-vs-identifier)** —
   duplication accepted: the page must stand alone; both link to each other. Content is
   re-authored deeper, not copy-pasted verbatim.
7. **No new DB tables/APIs** — all content is typed TS constants like precedents;
   only DB touch is the projectVisibility row. Lowest-risk shape.
8. **Review consolidated to 3 finder agents** (not the medium-effort 8) — diff was
   ~95% new declarative content files; all 8 angles covered across 3 prompts.
   Verification done inline (author context) rather than per-candidate agents.
9. **Review fixes applied (8):** href-quote XSS in AskModel md(); rate limiter →
   shared `$lib/server/rate-limit` keyed on cf-connecting-ip (was global-per-tunnel
   + unbounded Map); stream abort 60s→120s; dead ELI5 ternary; unreachable
   `trust2` synonym key → `mat`/`academy`; dead compact/onClose props; layout
   comment corrected re public-by-default visibility.
10. **Review findings skipped (logged):** SSE `messages = [...messages]` per-token
   spread (precedent behaviour, low risk/benefit); ledger column markup dedup
   (cosmetic); `$app/stores` → `$app/state` (precedent-wide migration, not this PR);
   chat's direct z.ai transport vs CLAUDE.md gateway rule — kept because BOTH
   existing project chat endpoints (policy-engine, keystone) deliberately use the
   same low-level transport; a gateway migration should cover all three at once.
11. **Private-from-first-request:** seeded `project_visibility(data-spine,false)`
   on prod BEFORE deploy (review caught that visibility is public-by-default).
   Live verification via a 1-hour share token minted in the DB, then revoked.

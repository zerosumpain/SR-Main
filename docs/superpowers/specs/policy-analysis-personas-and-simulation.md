# Policy analysis — a persona library, and the assessment as something you can run

Status: implementing · 2026-09-10 · autonomous (Full grade)

## The ask

1. "Embellish the capability of identifying actors, creating a persistent set of
   personas that are developed over time. Personas of actors are developed across
   policy analysis, and should be able to be enriched through research. You should
   only do this in a way that complements and enriches the specific policy run."
2. "Structure and organise the presentation further. There's a lot of intelligence
   in there; can we use simulations, or visualisation to better represent activity."

## 1 — The persona library

Today every assessment derives its actors from scratch and throws them away when the
run ends. The eighth assessment of a DfE policy knows nothing the first seven learned
about the DfE. The library makes that cumulative.

A **persona** is a body the reader keeps meeting: its standing dossier (what it is,
what moves it, what it has been shown able to do) plus a ledger of **observations** —
one per assessment that met it, one per commissioned research pass.

**The constraint is the interesting part.** A prior must enrich the run without
contaminating it. A red-team assessment that imports last month's conclusion about a
department is no longer reading *this* policy. So:

- A prior is handed to the model as CONTEXT, explicitly labelled untrusted and
  explicitly non-evidential. The prompt says corroborate or contradict from this
  policy's own text; never carry a claim across.
- The existing provenance rules do the enforcing. Every artefact must trace to a
  passage or a retrieved source (`hasSource`), and a persona is neither — so nothing
  a persona says can become a finding on its own account.
- Where a profile field is nonetheless shaped by a prior, it is stamped with a new
  origin, `prior_assessment`, which reads on the page as what it is.

### Shape

- `policy_personas` — owner, canonical name, entity type, aliases, summary, `dossier`
  (traits with their own origin/confidence and the analyses that support them),
  sighting count.
- `policy_persona_observations` — one row per (persona, analysis) and one per research
  pass. `analysis_id` is nullable and cascades: deleting an assessment removes what it
  observed, and the persona survives with a lower sighting count.

Identity is decided by `assessIdentity` — the site's own identity policy, the same one
entity resolution and cross-policy exposure already use. A shared name is not a shared
body, and an unresolved match creates a new persona rather than merging two.

### Where it plugs in

- **Stage 5 (Actor and incentive profiles)** receives the matched persona's dossier as
  a prior.
- **Stage 11 (Exploitation playbook)** receives its track record — the plays this body
  was shown capable of elsewhere. A red team that remembers is the point.
- **Stage 14 (Actor persona library)**, new and last, writes back: one merge call per
  actor, reconciling what this run observed into the standing dossier. It emits
  `persona_link` artefacts, and the worker applies them to the persona tables inside
  the same transaction that completes the stage — so a rolled-back stage writes no
  personas.
- **On demand**, from the persona page: a bounded research pass over that body,
  appended as an observation of its own. Owner-triggered, because it spends.

## 2 — Simulation and visualisation

Three additions, each computed from links the assessment already asserted. Nothing
here invents a number.

- **The stress test.** Fail an assumption and watch the assessment recompute: which
  findings lose their footing, which recommendations lose their findings, which plays
  are *disarmed* because a precondition they need has gone. Those two directions are
  opposite and are shown as opposites — a policy professional's "what if we're wrong
  about capacity" answered against the run's own provenance graph.
- **The interplay map.** Actors on the left, what they attack on the right, an arc per
  play weighted by exposure. Select an actor to see its reach; select a mechanism to
  see who is coming for it.
- **The scenario walk-through.** Each of the eight scenarios already carries a chain —
  condition changes, first actor reacts, strategy, downstream effects, what it costs,
  whether anyone would notice. Stepped through one beat at a time rather than read as
  a paragraph.

And the page itself becomes **four workspaces** rather than nine stacked sections,
using the same tab primitives the report acts introduced: all panels stay in the DOM,
so find-in-page and print still reach every one.

## Decision log

| Fork | Chosen | Why | Reversible |
|---|---|---|---|
| Persona write-back: worker hook vs. a 14th stage | 14th stage | The stage machinery already gives leases, retries, per-unit failure and an audit row. A worker hook would have reinvented all four. | Yes — drop the stage from `STAGES`. |
| Merge dossiers with one call or fan out per actor | Fan out | Matches every other stage: one bad merge is a recorded gap, not a dead stage. | Yes |
| Personas global vs. owner-scoped | Owner-scoped | Every other row in this feature is, and the library is drawn from private assessments. | Yes |
| Research enrichment in-run vs. on demand | On demand | In-run it would spend on every actor of every run. On demand it is a decision the reader makes against a body they care about. | Yes |
| A new `prior_assessment` origin vs. reusing `structural_inference` | New origin | The reader must be able to see which of these came from another paper. The enum is text in the database; nothing migrates. | Yes |
| Stress test: recompute vs. re-run the model | Recompute | The provenance graph is already there and a re-run would be a fresh opinion, not a sensitivity. Graph propagation is reproducible and free. | Yes |
| Dashboard: four workspaces vs. leaving nine sections | Workspaces | The ask was to organise further, and the report acts already established the pattern on this page. | Yes |

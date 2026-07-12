# Data Spine: user-stepped scenario animations + "The DfE model" tab

Autonomous build, 2026-07-12. Brief (verbatim intent):

1. Animation examples must not step through automatically — the user presses to go
   to each stage; the current stage's animation repeats every 5 seconds until they
   advance.
2. A new tab on federation that layers up how a DfE centralised model could work,
   based on `/drive/federated-working-national-implementations.docx`, with visuals
   and the topology HLD diagrams recreated *in the product, interactive*.

## Change 1 — user-stepped scenario playback

The only auto-stepping animations in the project are the FederationSim scenario
examples (`$lib/sim/federation/engine.ts` advances steps after `holdMs`). This is
what "the animation examples" refers to: the 14 catalogue scenarios plus
ask-the-federation runs.

Design:
- `engine.ts`: after a step's `holdMs` elapses, do NOT advance. Enter an
  `awaitingNext` hold; every 5 s of engine time, re-fire the step's **visual**
  actions (pulse / fanout / flash / highlight). Log and counter actions never
  replay — replaying them would inflate the ledger counters and duplicate log rows.
- New `SimEvent` `{ type: 'step-settled' }` so the HUD can light up the Next
  button; cleared by the next `narrate`.
- `stepForward()` becomes the advance: mid-beat it completes the beat instantly
  (existing behaviour), during the hold it drops queued replays and advances.
  Advancing past the final step ends the scenario (existing `scenario-end` path).
- Play/pause still freezes/unfreezes everything (including the replay timer);
  restart/exit/speed unchanged.
- `FederationSim.svelte`: prominent "Next ▸" button in the transport (pulses when
  the stage has settled), "stage repeats — press next" hint, step counter kept.

Files: `src/lib/sim/federation/engine.ts`, `FederationSim.svelte`,
`engine.test.ts` (rewrite auto-advance assertions; add replay + no-side-effect
assertions).

## Change 2 — "The DfE model" section tab

New section tab in the data-spine SectionNav (the project's tabs), between
Federation and Governance: route `/projects/data-spine/dfe-model`, label
"The DfE model". Content is the uploaded paper (Parts I–III): survey of national
federation implementations, the proposed UK education fabric, and the DfE policy
reality-check. The three HLD figures are rebuilt as interactive SVG components,
not embedded images.

Page structure (deck style, precedent: `federation/+page.svelte`):
1. Hero — "A thin national fabric" + stats.
2. **The blueprint** — interactive Figure 1 (FabricDiagram): the model *layers up*
   stage by stage (estate → connectors → brokerage → commissioning → cross-domain
   → ledger/identity), user-pressed advance with the current stage's animation
   repeating every 5 s (same interaction grammar as Change 1); every component
   clickable → inspector panel; flow buttons animate the four traffic types.
3. **Inside an edge node** — interactive Figure 2 (EdgeNodeDiagram): clickable
   connector internals, trust-boundary emphasis.
4. **The two core flows** — interactive Figure 3 (FlowsDiagram): flow A (no-PII
   analytic query) and flow B (rules-based PII release) as user-stepped walkthroughs.
5. Cherry-picked components — requirement → mechanism → exemplar cards.
6. The world tour — 7 archetypes with national implementations (Part I).
7. Policy reality check — DfE commitments mapping, tensions, bottom line (Part III).

Files: `components/SectionNav.svelte` (+1 tab),
`dfe-model/+page.svelte`, `dfe-model/lib/model.ts` (all copy/data),
`dfe-model/components/{FabricDiagram,EdgeNodeDiagram,FlowsDiagram}.svelte`,
`lib/sources.ts` (add public sources cited by the paper: NIIS/X-Road, MAIS
consultation, Milburn interim report, CamDX, Datafordeler, DEPA, TI-Messenger).

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| What "animation examples" means | (a) FederationSim scenarios; (b) AskFederation anatomy panels; (c) architecture flow | (a) | Only auto-stepping animation in the project; AskFederation runs *through* the sim; architecture flow is static | yes — engine change is isolated |
| Auto-play kept as option? | keep toggle / manual only | manual only | Brief says "instead of stepping through automatically"; less UI, engine stays simpler | yes |
| Replay cadence semantics | wall-clock 5 s / engine-time 5 s | engine time | At 1× (default) identical; at 2×–3× replays speed up with the rest of the animation — consistent feel | yes |
| Replay side effects | replay all actions / visuals only | visuals only | Replaying log/counter actions corrupts ledger counts + duplicates log rows | n/a (correctness) |
| "Tab" placement | sub-tabs inside federation page / new SectionNav section | new SectionNav section | Federation page has no tab chrome; SectionNav *is* the project's tab bar (user's word "tab" matches its aria/CSS naming); keeps the sim page presentation-pure | yes |
| Tab name/route | "DfE centralised model" / "The DfE model" `/dfe-model` | "The DfE model" | Paper's own thesis: what the DfE centralises is trust + brokerage, NOT data; page presents exactly "how a DfE centrally-run model could work" while staying faithful to the source's no-central-pool design | yes (rename trivial) |
| Diagram tech | Three.js / static PNGs / interactive SVG | interactive SVG | "Within the product and interactive" rules out PNGs; SVG + CSS animation is the right weight for HLD topology (precedent: admin architecture map is SVG-based; sim already owns the 3D slot) | yes |
| eli5 support | research-only / both narratives | both | Every other data-spine section honours the toggle | — |

## Verification

- `npx vitest run src/lib/sim/federation` — engine behaviour incl. new hold/replay.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` — types.
- Local prod-build headless QA: screenshot `/projects/data-spine/dfe-model` and the
  federation transport, confirm Next-stepping works and diagrams render.
- Deploy via ship skill; live verify with the project share token (data-spine is
  private) or owner session; confirm new tab + diagrams on strangeramblings.com.

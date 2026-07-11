# sr. decks — presentation capability

**Date:** 2026-07-11 · **Status:** approved (design round 2026-07-11, all recommendations accepted: "go with your recommendations")

## What

A first-class presentation capability at `/decks/[slug]`: hierarchical, zoomable slide decks with **play** and **edit** modes, shareable via URL, buildable from a `/jkai` prompt, rendering site-branded editorial blocks and live interactive embeds (first: the data-spine federation simulator).

Test case: "The Data Spine — Federation" — a deck telling the data spine story, zooming into a sub-deck of live federation scenarios.

## Content model — structured block decks

A deck is a **tree of slides**; each slide is an **ordered list of typed blocks**. No freeform positioning: the LLM emits a JSON spec, blocks render deterministically on-brand. This is what makes /jkai a reliable author — free placement is where LLM decks go ugly.

```
DECK
 ├─ Slide 1 [masthead]
 ├─ Slide 2 [bigNumber, prose]
 ├─ Slide 3 [embed: federation-sim]
 │    └─ sub-deck (zoom in)
 │        ├─ 3.1 [statRow, chart]
 │        └─ 3.2 [quote]
 └─ Slide 4 [timeline]
```

### Schema (Drizzle — conventions from `workflows`/`projectShares`)

- **`decks`**: `id` (text uuid), `slug` (unique), `title`, `description`, `theme` (default `'editorial'`), `isPublic` (bool default false), `createdAt`/`updatedAt`.
- **`deckSlides`**: `id`, `deckId` (FK cascade), `parentSlideId` (self-FK nullable — the zoom hierarchy), `position` (int, order within plane), `title`, `blocks` (jsonb ordered array), `notes` (speaker notes), `version` (int, optimistic concurrency), timestamps.
- **`deckShares`**: mirror of `projectShares` — `tokenHash` (sha256, unique), `label`, `expiresAt`, `revokedAt`, `lastUsedAt`, `useCount`.

Blocks are jsonb on the slide, not per-block rows: editor and LLM both work a-slide-at-a-time, so slide-level versioning (canvas-style `expectedVersion` → 409) is the right granularity. The tree allows arbitrary nesting; player UI supports one zoom level in v1.

## Block library — `$lib/presentation/`

Shared from day one (deliberately breaking the per-route copy-paste pattern of the study pages, which a reusable slide system can't afford). A registry maps block type → zod schema + render component + editor form descriptor + LLM-facing description — same shape as the workflow node registry.

| Block | Ported from |
|---|---|
| `masthead` | data-spine `StoryMasthead` (kicker / Fraunces headline / thesis / asks) |
| `prose` | `.pe-lede`/`.pe-prose` typography |
| `bigNumber` | `VitalTile` (Tween count-up on entry) |
| `statRow` | policy-engine `Scorecard` / Keystone `TakeawayBar` chips |
| `quote` | data-spine `.quote` (accent left border, Fraunces italic, attribution) |
| `timeline` | Keystone `CommitTimeline` / data-spine timeline |
| `image` | plain figure + mono kicker caption |
| `chart` | policy-engine `chartkit.ts` line/bar (no new chart dependency) |
| `embed` | registered interactives (see below) |
| `iframe` | any strangeramblings.com URL — cheap fallback for existing dynamic content |

**Theme**: editorial field-study register — Fraunces display, DM Sans body, JetBrains Mono labels, paper/ink palette — implemented as CSS custom properties on the deck wrapper so a brutalist (or other) theme is a later additive change, not a rework. All animation durations route through `$lib/motion.ts` `dur()` (reduced-motion safe). Animation stack is `svelte/transition` + `svelte/motion` `Tween` only — house style, no GSAP.

## Embeds + federation sim promotion

`$lib/presentation/embeds.ts`: an allowlist of embeddable interactives, each with a config schema. First entry **`federation-sim`** (config: scenario id, autoplay). To support this the sim's clean core (`topology/engine/scene/scenarios/queries` + `FederationSim.svelte`) moves from the data-spine route folder to **`$lib/sim/federation/`**; data-spine imports from there. One source, no fork; its vitest suite moves with it.

## Player — `/decks/[slug]`

- **Guard** (`+page.server.ts`, logic in `$lib/decks/guard.ts` mirroring `requireProjectPublic`): public if `isPublic`; else owner session; else share token `?t=` (sha256 lookup → sets `dsh_<slug>` cookie, 12h, httpOnly) — otherwise **404** (not 403). Private/share views get `cache-control: private, no-store` + `x-robots-tag: noindex`.
- **Navigation**: full-viewport slides; ←/→/space keys, touch swipe, click zones; JetBrains Mono progress index ("04 / 12"); fullscreen + Escape via the `ArchitectureMap` pattern.
- **Hierarchical zoom**: within a plane ←/→ walks siblings. A slide with children shows a zoom affordance; Enter/click scales the current slide up/out while the sub-deck's first slide scales in (CSS transform + Tween — the Prezi feel without a spatial engine). Breadcrumb shows depth. At the end of a sub-deck, → zooms out and advances the parent. Deep link via `?s=<slideId>`.
- `/decks` index: owner sees all; anonymous sees nothing (published decks are reachable by direct URL).

## jkai tool — `presentation_build_from_spec` (phase 2)

`src/lib/workflows/site-tools/tools/presentations.ts`, mirroring `workflow_build_from_spec` exactly:

- Design-first gate in the tool description: outline agreed in chat text → user "yes" → tool call.
- Args: `{ title, slug?, theme?, slides: [{ title, blocks: [...], children?: [...] }] }` — nesting via `children`.
- Handler: validate every block against the registry zod schemas; mint unique slug; **emit deck URL before DB writes**; insert deck + slides incrementally; verification pass (blocks validate, embed refs exist) blocking success; return `summaryMarkdown` with the paste-verbatim contract.
- Registered via one import in `registry.ts`; added to `ESSENTIAL_TOOL_NAMES`; **zero LLM calls in-tool** — Hermes draws content together in chat using its existing research/file tools.
- Hermes side: new `jkai-decks` skill in `~/.hermes-jkai/skills/` documenting block vocabulary + the design-first gate; committed to `zerosumpain/homeserv-hermes-jkai`.

## Edit mode — `/decks/[slug]/edit` (phase 3)

Owner-gated. Left rail: slide tree (reorder, indent-to-nest). Center: live render at true fidelity. Right: per-block forms generated from the registry (canvas `configDraft`/dirty/save pattern). Persistence: REST under `/api/decks/…` (POST deck, PATCH deck meta, POST/PATCH/DELETE slides) with `expectedVersion` → 409 on conflict. Share management (mint/revoke) in the editor, mirroring `/api/projects/share`.

## Phasing (each phase ships to prod)

1. **Engine**: schema + shares/guard + block library + sim promotion + player + seeded test deck. Verify: share URL loads on strangeramblings.com; Playwright screenshots of transitions and zoom-in/out.
2. **jkai tool**: prompt /jkai → deck URL → loads. Both repos committed.
3. **Editor**: edit block → reload → persisted; stale version → 409.

## Verification commands

- `npm run check` / vitest (block schemas, guard, slug allocator; moved sim suite stays green)
- `curl -s 'https://strangeramblings.com/decks/data-spine-federation?t=<token>' | grep -q 'Data Spine'` (and anonymous request without token → 404)
- Playwright headless run against prod: navigate, arrow through slides, zoom into sub-deck, screenshot each state
- Phase 2: live /jkai prompt producing a working deck URL

## Decision Log

| # | Decision | Options considered | Why | Reversibility |
|---|---|---|---|---|
| 1 | Structured block decks | freeform canvas; markdown/shortcodes | Deterministic on-brand render; LLM-reliable; matches node-registry + build_from_spec precedents | Block model could later gain a freeform block type |
| 2 | Editorial (Fraunces) default theme | sitewide brutalist; both day-1 | "Editorial" is the house style of the three field studies the brief cites; blocks port from them | Themes are CSS vars on the wrapper; additive later |
| 3 | `/decks/[slug]` | `/presentations`, `/jkai/decks` | Short, brandable, share URLs don't leak /jkai namespace | Redirects trivial if renamed |
| 4 | Phase order: engine → jkai tool → editor | editor first; tool+editor together | Prompt-authoring is the primary path in the brief; each phase ships | N/A (ordering) |
| 5 | Blocks as jsonb on slide rows | per-block rows | Slide-at-a-time editing granularity; simpler; canvas versioning still applies | Migration to rows possible if per-block concurrency ever needed |
| 6 | Private by default + hashed share tokens + publish toggle | public by default | Matches projectVisibility/projectShares semantics and John's use of private studies | Toggle is per-deck |
| 7 | Promote federation sim to `$lib/sim/federation/` | reach-across import; duplicate | Two consumers now exist; route-folder reach-across breaks repo convention; duplication drifts | Pure file move, imports updated |
| 8 | Zoom = transform/Tween illusion, not spatial engine | true infinite-canvas camera | One zoom level covers the brief; ~90% of the feel for ~10% of the build | Tree model already supports deeper nesting |
| 9 | No new dependencies (no GSAP, no svelte-flow, no reveal.js) | adopting a deck/animation lib | House patterns cover 100% of needs; svelte-flow already unused in repo | Can add later if a real gap appears |
| 10 | In-tool LLM calls: none | tool calls gateway itself | Mirrors workflow_build_from_spec; Hermes is the author, tool is the persister | Gateway call could be added for auto-layout later |
| 11 | Inline plan execution; ported components specified by source-reference | subagent-per-task with full inline code | Executor = planner in-session with all precedent files read; full-code plan would double the work (John: scale process to task) | N/A (process) |
| 12 | Seed via standalone `pg` script run locally + on VPS | owner-token import endpoint | No new auth surface; matches `migrate-*.mjs`/`policy-engine-ingest.mjs` script precedent | Phase 3 adds proper POST /api/decks anyway |

## Not in scope (v1)

PDF/PPTX export, speaker-notes presenter view, multi-user collaboration, deck-level RAG chat, arbitrary-depth zoom UI (model supports it; UI is one level), theme picker UI.

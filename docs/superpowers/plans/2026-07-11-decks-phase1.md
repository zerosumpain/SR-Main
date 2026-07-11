# sr. decks — Phase 1 Implementation Plan (engine + player + seeded deck)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/decks/[slug]` — a share-token-gated deck player rendering typed editorial blocks with hierarchical zoom — proven live with a seeded "The Data Spine — Federation" deck.

**Architecture:** Deck = tree of slides (rows in `deck_slides`, `parentSlideId` self-FK); slide = jsonb array of typed blocks validated by a zod registry in `$lib/presentation/`. Player is a full-viewport SvelteKit route guarded exactly like private projects (`requireDeckVisible` mirrors `requireProjectPublic`). Federation sim promotes to `$lib/sim/federation/` so the `embed` block can mount it.

**Tech Stack:** SvelteKit + Svelte 5 runes, Drizzle/PostgreSQL, zod, svelte/transition + svelte/motion via `$lib/motion.ts dur()`, Three.js (existing sim only). **No new dependencies.**

## Global Constraints

- All animation durations through `dur()` from `$lib/motion.ts` (reduced-motion collapses to 0).
- Editorial theme only: Fraunces / DM Sans / JetBrains Mono, paper/ink CSS vars aliased from site tokens (`--paper: var(--bg)` etc.) exactly as `data-spine/+layout.svelte:79`.
- Private deck responses: `cache-control: private, no-store` + `x-robots-tag: noindex`; unauthorized → **404**, never 403.
- Svelte 5: no `$state` on render-loop/interval handles; follow `svelte5-pitfalls` skill.
- `npm run check`/`build` need `NODE_OPTIONS=--max-old-space-size=8192`; build outside Bash sandbox (adapter-node failure); homeserv build clobbers the always-on service → deploy.sh restarts it.
- ids: `text('id').primaryKey().default(sql\`gen_random_uuid()::text\`)`; timestamps `withTimezone: true`.
- Commit after each task; conventional commits `feat(decks): …`.

---

### Task 1: Schema — `decks`, `deck_slides`, `deck_shares`

**Files:**
- Modify: `src/lib/db/schema.ts` (append new section after `projectShares` block ~line 722)

**Produces (later tasks rely on):** `decks`, `deckSlides`, `deckShares` tables + `Deck`, `DeckSlide`, `NewDeck`, `NewDeckSlide` types.

- [ ] **Step 1: Add tables** (mirror `projectShares`/`workflowNodes` conventions):

```ts
// ==========================================
// sr. decks — presentation capability
// Spec: docs/superpowers/specs/2026-07-11-decks-presentation-capability.md
// ==========================================

export const decks = pgTable('decks', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  theme: text('theme').notNull().default('editorial'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ bySlug: uniqueIndex('decks_slug_idx').on(t.slug) }));

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;

// A deck is a TREE of slides: parentSlideId=null is the main plane; a slide
// with children can be "zoomed into" in the player. `blocks` is the ordered
// jsonb array of typed blocks (validated by $lib/presentation/registry).
// `version` = optimistic-concurrency counter (workflow_nodes pattern).
export const deckSlides = pgTable('deck_slides', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  deckId: text('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  parentSlideId: text('parent_slide_id'),
  position: integer('position').notNull().default(0),
  title: text('title'),
  layout: text('layout').notNull().default('default'),
  blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
  notes: text('notes'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byDeck: index('deck_slides_deck_idx').on(t.deckId, t.parentSlideId, t.position) }));

export type DeckSlide = typeof deckSlides.$inferSelect;
export type NewDeckSlide = typeof deckSlides.$inferInsert;

// Share links: exact mirror of project_share (sha256 of raw token, live while
// not revoked and not expired).
export const deckShares = pgTable('deck_share', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  deckId: text('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  label: text('label'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  useCount: integer('use_count').notNull().default(0),
}, (t) => ({
  byTokenHash: uniqueIndex('deck_share_token_hash_idx').on(t.tokenHash),
  byDeck: index('deck_share_deck_idx').on(t.deckId),
}));

export type DeckShare = typeof deckShares.$inferSelect;
```

(No FK on `parentSlideId` → avoids self-reference TS circularity Drizzle quirk; integrity enforced app-side, cascade covered by `deckId`.)

- [ ] **Step 2: Push locally**: `npx drizzle-kit push` (new empty tables — the `.unique()`-on-populated-table gotcha does not apply). Expected: 3 tables created.
- [ ] **Step 3: Commit** `feat(decks): schema — decks, deck_slides, deck_shares`

---

### Task 2: `$lib/decks/` — shares + guard (server)

**Files:**
- Create: `src/lib/decks/shares.ts` (adapt `src/lib/projects/shares.ts` — same function names, `deckId` instead of `projectKey`, cookie prefix `dsh_`)
- Create: `src/lib/decks/guard.ts`
- Test: `src/lib/decks/guard.test.ts` (pure parts only: cookie naming)

**Interfaces (produces):**
- `generateShareToken(): string`, `hashShareToken(t: string): string`, `shareCookieName(slug: string): string` → `'dsh_' + slug.replace(/[^a-zA-Z0-9_-]/g,'')`
- `validateDeckShare(deckId: string, rawToken: string): Promise<boolean>`
- `createShare({deckId, createdBy, label?, expiresAt?}): Promise<{id, token}>`, `listShares(deckId)`, `revokeShare(id, deckId)`
- `requireDeckVisible(deck: {id: string; slug: string; isPublic: boolean}, ctx: {locals: App.Locals; url: URL; cookies: Cookies}): Promise<{authedPrivate: boolean; viaShare: boolean}>` — public → pass; owner (`isOwnerEmail(session?.user?.email)`) → `authedPrivate`; `?t=`/cookie token valid → sets cookie (path `/decks`, httpOnly, 12h) + `viaShare`; else `throw error(404)`.

- [ ] Step 1: failing test for `shareCookieName` sanitization; Step 2: implement both files (guard takes the already-loaded deck row — unlike projects, the caller must query by slug first, so the guard doesn't re-query); Step 3: `npx vitest run src/lib/decks` passes; Step 4: commit `feat(decks): share tokens + visibility guard`.

---

### Task 3: `$lib/presentation/` — block types, zod schemas, registry

**Files:**
- Create: `src/lib/presentation/types.ts`, `src/lib/presentation/registry.ts`, `src/lib/presentation/embeds.ts`, `src/lib/presentation/navigation.ts`
- Test: `src/lib/presentation/registry.test.ts`, `src/lib/presentation/navigation.test.ts`

**Interfaces (produces):**

```ts
// types.ts (shapes; zod schemas in registry.ts are the source of truth)
export type BlockType = 'masthead'|'prose'|'bigNumber'|'statRow'|'quote'|'timeline'|'image'|'chart'|'embed'|'iframe';
export interface MastheadBlock { type:'masthead'; kicker?:string; title:string; thesis?:string; asks?:string[] }
export interface ProseBlock    { type:'prose'; body:string; lede?:boolean }            // markdown-lite: **b**, links
export interface BigNumberBlock{ type:'bigNumber'; value:number; unit?:string; label:string; sub?:string; dp?:number }
export interface StatRowBlock  { type:'statRow'; stats:{n:string; label:string}[] }     // n preformatted string
export interface QuoteBlock    { type:'quote'; text:string; attribution?:string; url?:string }
export interface TimelineBlock { type:'timeline'; items:{year:string; label:string; detail?:string}[] }
export interface ImageBlock    { type:'image'; src:string; alt:string; caption?:string }
export interface ChartBlock    { type:'chart'; kind:'line'|'bar'; title?:string; series:{label:string; points:{x:number;y:number}[]}[]; xLabel?:string; yLabel?:string }
export interface EmbedBlock    { type:'embed'; embed:string; config?:Record<string,unknown> }   // embed ∈ EMBEDS registry
export interface IframeBlock   { type:'iframe'; src:string; title:string; height?:number }      // same-site URLs only
export type Block = …union…;
export interface DeckMeta { id:string; slug:string; title:string; description:string|null; theme:string }
export interface SlideNode { id:string; parentSlideId:string|null; position:number; title:string|null; layout:string; blocks:Block[]; hasChildren:boolean }

// registry.ts
export const BLOCK_SCHEMAS: Record<BlockType, z.ZodTypeAny>;
export function validateBlocks(blocks: unknown): { ok: boolean; issues: string[] };  // per-block path-labelled issues
export const BLOCK_DOCS: Record<BlockType, string>;  // one-line LLM-facing doc per type (phase 2 uses this)

// embeds.ts
export const EMBEDS: Record<string, { label: string; configSchema: z.ZodTypeAny }>;  // v1: 'federation-sim' { scenario?: string; autoplay?: boolean }
// iframe src rule: must start with '/' (site-relative) — validated in schema.

// navigation.ts — pure tree walking over DeckSlide-shaped rows
export interface FlatSlide { id:string; parentSlideId:string|null; position:number }
export function buildPlanes(rows: FlatSlide[]): Map<string|null, string[]>;  // parent → ordered child ids
export function nextSlide(rows: FlatSlide[], current: string): { id: string; move: 'sibling'|'zoomOut' } | null;
  // next sibling in plane; at end of a sub-plane → parent's next sibling ('zoomOut'); at end of root plane → null
export function prevSlide(rows: FlatSlide[], current: string): { id: string; move: 'sibling'|'zoomOut' } | null;
export function zoomIn(rows: FlatSlide[], current: string): string | null;   // first child or null
export function breadcrumb(rows: FlatSlide[], current: string): string[];    // ancestor ids root→current
```

- [ ] Step 1: failing tests — `validateBlocks` rejects unknown type/missing required props with path-labelled issues; `nextSlide`/`prevSlide`/`zoomIn` over the fixture tree `[root:(a,b,c); b:(b1,b2)]`: `next(a)=b`, `zoomIn(b)=b1`, `next(b2)={c, zoomOut}`, `prev(b1)=null-or-{b,zoomOut}` (define: prev at first child → `{b,'zoomOut'}`), `next(c)=null`.
- [ ] Step 2: implement; Step 3: vitest green; Step 4: commit `feat(presentation): block registry + tree navigation`.

---

### Task 4: Promote federation sim → `$lib/sim/federation/`

**Files:**
- Move: `src/routes/projects/data-spine/federation/lib/{topology,engine,scene,scenarios,queries}.ts` + `*.test.ts` → `src/lib/sim/federation/`
- Move: `src/routes/projects/data-spine/federation/components/FederationSim.svelte` → `src/lib/sim/federation/FederationSim.svelte`
- Modify: all importers — `federation/+page.svelte`, `federation/components/{AskFederation,QueryExplorer}.svelte` (these two STAY in the route; they import `$lib/sim/federation` for types/queries but keep their `appState` coupling)

- [ ] Step 1: `git mv` files; rewrite intra-sim relative imports (`../lib/x` → `./x`); Step 2: update route importers to `$lib/sim/federation/...`; Step 3: `npx vitest run src/lib/sim` green + `npm run check` clean on touched files; Step 4: commit `refactor(data-spine): promote federation sim core to $lib/sim/federation`.

---

### Task 5: Block render components + editorial theme

**Files (create under `src/lib/components/presentation/`):**
- `DeckShell.svelte` — theme wrapper: Fraunces/DM Sans/JetBrains Mono font link (copy `data-spine/+layout.svelte:24-28`), paper/ink var aliases (`--paper: var(--bg); --ink: var(--text-primary); --ink-soft: var(--text-muted)`), paper-grain overlay, `.deck-*` typography globals (port `.pe-h1/.pe-lede` scale at slide size: h1 `clamp(34px,5.4vw,64px)`)
- `SlideView.svelte` — `{slide: SlideNode}` → renders its `blocks` in order via the map below; layout variants `default|center|full-bleed`
- `blocks/Masthead.svelte` (port StoryMasthead, no appState — no eli5), `blocks/Prose.svelte`, `blocks/BigNumber.svelte` (port VitalTile Tween count-up, Fraunces numeral `clamp(48px,9vw,120px)`), `blocks/StatRow.svelte` (Scorecard grid), `blocks/Quote.svelte`, `blocks/Timeline.svelte`, `blocks/Image.svelte`, `blocks/Chart.svelte` (chartkit — copy `linScale/niceTicks/extent/polyline/fmt` into `$lib/presentation/chartkit.ts`, leave policy-engine's copy untouched), `blocks/Embed.svelte` (switch on `EMBEDS`; `federation-sim` → dynamic `import('$lib/sim/federation/FederationSim.svelte')` + `bind:this` + autoplay `run(scenario)` after `ready`), `blocks/Iframe.svelte`
- `block-components.ts` — `Record<BlockType, Component>` map

**Consumes:** Task 3 types/registry; Task 4 `$lib/sim/federation`.

- [ ] Step 1: invoke `svelte5-pitfalls` + `sr-design` skills; build components (visual QA in Task 7's Playwright pass — no unit tests for markup); Step 2: `npm run check` clean; Step 3: commit `feat(presentation): editorial block components + deck theme`.

Prose markdown-lite: escape HTML then allowlist `**bold**`, `[text](url)`, line breaks — copy the escape-then-allowlist approach from data-spine `AskModel.svelte`.

---

### Task 6: Player — `/decks/[slug]` + `/decks` index

**Files:**
- Create: `src/routes/decks/[slug]/+page.server.ts` — query deck by slug (404 if none), `requireDeckVisible`, load slides ordered `(parentSlideId, position)`, `setHeaders({'cache-control':'private, no-store','x-robots-tag':'noindex'})` when private view, return `{deck: DeckMeta, slides: SlideNode[], startId: string}` (honour `?s=` if it names a slide)
- Create: `src/routes/decks/[slug]/+page.svelte` — the player
- Create: `src/routes/decks/+page.server.ts` + `+page.svelte` — owner-only index (`isOwnerEmail` via `locals.auth()`; anonymous → empty-state 404-style page), list decks w/ slide counts, play links
- Modify: `src/lib/auth.ts:33` — add `'/decks'` to `PUBLIC_PATHS` (prefix) so the hook never intercepts; per-deck privacy is the guard's job (two-layer design copied from /projects)

**Player behaviour (all in `+page.svelte`, state via plain runes):**
- `current = $state(startId)`; derived slide lookup; `mode: 'plane'|'zooming'`
- Keys: `ArrowRight/Space` → `nextSlide` (on `zoomOut` move, play zoom-out transition), `ArrowLeft` → `prevSlide`, `Enter/ArrowDown` → `zoomIn` if `hasChildren`, `Escape` → zoom out to parent (or exit fullscreen), `f` → fullscreen (ArchitectureMap `requestFullscreen` pattern incl. `fullscreenchange` listener)
- Touch: pointerdown/up swipe threshold 60px horizontal
- Transitions via `{#key current}` + custom transition fns in `$lib/presentation/transitions.ts`: sibling nav `fly x ±40 / fade` (dur 320); zoom-in: outgoing `scale 1→1.5 fade`, incoming `scale 0.7→1 fade` (dur 480, cubicOut); zoom-out inverse. Direction picked from the `move` returned by navigation fns.
- Chrome (auto-hides after 3s idle, reappears on pointermove): progress `04 / 12` (JetBrains Mono, count within current plane), breadcrumb chips when depth>0 ("↩ back to <parent title>"), zoom-in affordance pill when `hasChildren` ("⤵ N slides — Enter"), arrow click-zones at viewport edges
- `?s=` kept in URL via `replaceState` on nav (deep-linkable, no history spam)

- [ ] Step 1: server load + guard wiring; Step 2: player UI + transitions; Step 3: index page; Step 4: `npm run check` clean; local dev run: create throwaway deck row via psql, arrow/zoom through it at `http://homeserv:5173/decks/<slug>?t=<token>`; Step 5: commit `feat(decks): player route with hierarchical zoom + share URLs`.

---

### Task 7: Seed deck + ship live

**Files:**
- Create: `src/lib/decks/seed-data-spine-federation.ts` — the deck spec as a typed `DeckSpec` const (content drawn from `data-spine` lib constants + scenarios; structure below)
- Create: `scripts/seed-deck.mjs` — standalone `pg` script: reads the spec via a small JSON export step (`node scripts/seed-deck.mjs` uses `scripts/` tsconfig pattern like `curate-smoke.ts`; simplest: emit spec JSON via `npx tsx -e` import, or define spec directly in the .mjs — decide at implementation, prefer .mjs-native to avoid tsx-on-VPS) — idempotent: `DELETE FROM decks WHERE slug=$1` then insert deck + walk slides tree inserting with positions; prints share URL after minting one share token
- Deck structure (~9 slides): 1 masthead ("The Data Spine", kicker FIELD STUDY Nº5 · A PRESENTATION) → 2 the-problem (prose lede + statRow 15 suppliers / 24,000 schools / 0 published architecture) → 3 what-federation-is (quote + prose) → 4 **embed federation-sim** (full-bleed, no autoplay) **with children:** 4.1 first-query (embed autoplay `attendance-daily` + prose), 4.2 opt-out (embed autoplay opt-out scenario + statRow refusals), 4.3 central-copy contrast (embed autoplay + quote) → 5 governance (timeline 2002→2026) → 6 what-it-costs (bigNumber + statRow) → 7 close (masthead variant asks + iframe link chip to `/projects/data-spine/federation`)
- Scenario ids: read real ids from `$lib/sim/federation/scenarios.ts` `SCENARIOS` at authoring time.

- [ ] Step 1: author spec; validate via vitest one-liner (`validateBlocks` over every slide) as a test `seed.test.ts`; Step 2: seed locally, walk the full deck at `http://homeserv:5173/decks/data-spine-federation?t=…` (fix visuals now — this is the visual QA gate; screenshot via headless chromium if useful); Step 3: invoke `ship` skill — check → build → commit/push → deploy.sh; Step 4: `ssh johnk@157.180.19.38` run seed against prod DB (env from `/opt/strange-rambling-svelte/.env`), mint prod share token; Step 5: verify live — anonymous `curl https://strangeramblings.com/decks/data-spine-federation` → 404; with `?t=` → 200 + title present; Playwright headless against prod: arrow through all slides, zoom in/out, screenshot each state; Step 6: commit `feat(decks): seed The Data Spine — Federation deck`.

---

## Self-review notes

- Spec coverage: schema✓ shares/guard✓ registry+blocks✓ sim promotion✓ player+zoom✓ index✓ seed+ship✓. Editor/jkai tool are phases 2–3 (own plans).
- `PUBLIC_API_PATHS` (exact-match) untouched — no new public API routes in phase 1; `/decks` added to prefix-matched `PUBLIC_PATHS` only.
- Type consistency: `SlideNode.hasChildren` computed server-side in `+page.server.ts` from the loaded rows; navigation fns take `FlatSlide[]` (id/parent/position) — `SlideNode` satisfies it structurally.
- Ported components are specified by source-file reference rather than inline code (executor is the planning agent, same session, precedent files already read — logged as Decision Log #11).

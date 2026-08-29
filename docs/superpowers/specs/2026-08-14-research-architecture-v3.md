# Research architecture v3 — depth, frontier, dashboard

> Rework of the jkai research stack to deliver: understandable depth tiers with a
> reliable sub-2-minute option; a session-bound knowledge graph that detects and
> abandons dead ends *during* the run; a dashboard summary view alongside the
> desk; SSE everywhere including a reasoning-token toggle; and a definition stage
> that can bind research to specific sites, sources or processes.
>
> Date: 2026-08-14. All paths relative to `/home/john/strange_rambling_svelte/`.

## Decisions (agreed 2026-08-14)

1. **Full consolidation.** `/research/*` becomes the single route family;
   `quick_answer` backfills into `research_session` as `depth='scan'`; the old
   routes become 308 redirects. Two code paths are the convolution being removed.
2. **The live graph draws the frontier**, with entities on drill-down. A
   complete session averages 253 entities — the raw graph is a hairball with no
   signal about direction or dead ends.
3. **Durability lands in phase 2**, alongside the frontier, since
   `research_lead` rows already make the queue resumable.

---

## 0. What exists today (measured, not assumed)

### Surfaces — five of them, overlapping

| Route | What it is | Lines |
|---|---|---|
| `/jkai/research` | Launcher with a Quick\|Deep segmented control | 280 |
| `/quickanswer`, `/quickanswer/[id]` | Single-pass search + streamed synthesis | 185 + 34 |
| `/deepdive` | Second launcher with six advanced knobs | 440 |
| `/deepdive/[id]` | `ResearchDesk.svelte` canvas | 2,297 |
| `/deepdive/[id]/dashboard`, `/progress` | **Retired** — 308 redirect to the desk | 7 each |

Plus `deep-research` + `quick-answer` workflow nodes, seven `research_*` site
tools, `@research` retrieval in chat (`research-search.ts`), the Studio brief
(`research-brief.ts`), and the intel bridge.

Two DB tables (`quick_answer`, `research_session`), two workers
(`$lib/quickanswer/worker.ts`, `$lib/deepdive/worker.ts`), two SSE endpoints,
two incompatible SSE event shapes.

### The engine

`phase1` (breadth search, diversity-saturation stop) → `phase2` (fact + entity +
relationship extraction, novelty stop) → `phase3` (red-team adversarial search) →
`postprocess` (clusters, knowledge gaps, hypotheses, contradictions, follow-ups) →
cross-session entity linking → intel extraction.

### Production measurements (2026-08-14, `strange-rambling-app-db-1`)

```
quick_answer:      complete n=5    p50 50s     max 94s
research_session:  complete n=18   p50 1,524s (25m)   max 4,967s (83m)
                   avg per complete session: 45 sources, 229 facts,
                                             253 entities, 151 relationships
```

Session status distribution — 31 rows:

```
complete 18 | failed 5 | cancelled 1 | phase1 3 | phase3 3 | post_processing 1
```

**Seven sessions (23%) are stranded in a non-terminal state**, the oldest since
2026-04-15, one from 95 hours ago. Worker state lives in process-local `Map`s
(`activeEmitters`, `stopSignals`, `abortControllers` — `worker.ts:15-18`) and
`startResearch` is fire-and-forget. CI deploys on every merge to master, so any
deploy landing mid-run strands that session permanently. There is no resume.

---

## 1. Gap analysis against the five outcomes

### 1.1 Depth tiers

- Only two tiers exist, with a **cliff between 50 seconds and 25 minutes** and
  nothing in between.
- `/deepdive` asks the user to *compose* a depth out of six orthogonal dials
  (`timeLimit`, `maxSources`, `diversityThreshold`, `analysisDepth`,
  `redTeamAggression`, `maxFactsBeforePhase3`). That composition is the
  convolution.
- No model-knowledge-only tier exists at all.
- `TimeLimitOption` (`types.ts:45`) offers 15/30/60/120 **minutes**. The shortest
  bound available is 15 minutes.
- The `deep-research` workflow node passes a `depth` config into
  `research_start` (`deep-research.ts:35`) — but `research_start` declares only
  `topic` and `goals` (`site-tools/tools/research.ts:14-21`). **`depth` is
  silently dropped.**

### 1.2 Dead ends

- Stop conditions are **global averages**, not per-branch: phase 1 stops on
  category-diversity saturation across the whole run (`phase1.ts:181-192`);
  phase 2 stops when fewer than 5 new facts arrive per 20 sources
  (`phase2.ts:126-132`). One dead branch does not get pruned — it just dilutes
  the global mean, so the run keeps paying for it.
- `followUpQueue` (`phase1.ts:82`) is **unscored FIFO**. A query line that
  returned nothing useful gets its children enqueued identically to one that hit.
- Entities and relationships are extracted and stored, but nothing reads them
  back to choose the next query. The graph is **output, never controller**.
- `knowledge_gaps` and `hypotheses` are generated in `postprocess.ts:280-323` —
  *after* the research has finished, so they cannot redirect anything.
- Nothing measures whether a new fact is *about the question*. Searching an
  ambiguous name pulls in an unrelated namesake and the run has no way to notice.

### 1.3 Dashboard

- The dashboard route was retired to a 308 (`dashboard/+page.server.ts`).
- The `report` jsonb already holds `executive_summary`, `clusters`,
  `knowledge_gaps`, `hypotheses`, `contradictions_map`, `suggested_followups`,
  `source_diversity`, `entity_centrality` (`types.ts:86-103`) — and **nothing
  renders it as a summary**. You get the canvas, or a docx/md export.
- Every onward action already has a backend and no button: `@research`
  retrieval, `intel-bridge.ts`, `research-brief.ts` (Studio), exports, decks,
  Drive.

### 1.4 SSE and reasoning

- SSE exists on both paths, but `runStream` (`ai.ts:237-247`) reads only
  `chunk.choices[0].delta.content`. **Reasoning deltas are dropped on the
  floor.**
- Deep dive barely streams at all — nearly every call is `jsonCompletion`, which
  is non-streaming. There are no tokens to show.
- jkai chat *does* have a reasoning channel (`sse-adapter.ts:12`, "thinking: a
  reasoning-delta for the collapsible Reasoning panel"). The pattern exists;
  deepdive does not use it.
- Constraint: Codex cannot stream — the SDK emits one completed message per turn
  and zero reasoning items. If the site default is a `codex/` id the toggle must
  say so rather than sit empty.

### 1.5 Scoping

- `tavily.ts:36-46` supports `excludeDomains` but **not `includeDomains`**.
  `grep -rn "includeDomains\|include_domains" src/lib` returns nothing.
- No definition stage. `suggest-goals` proposes goals, but goals never constrain
  which sources are admissible.
- No way to bind to a site, a source class, or a named process.

---

## 2. Design

### 2.1 One depth enum, four values, one launcher

Depth is the **only** thing the user picks. It expands server-side into a
preset — config, phase list, budget and pinned model.

| Depth | Sources | Engine | Target wall-clock | Measured baseline |
|---|---|---|---|---|
| `instant` | none | model knowledge only, streamed | 3–8 s | new |
| `scan` | ~12 | current quickanswer path | < 90 s | p50 50 s |
| `brief` | ~15 | **new** — one bounded round, extraction, one synthesis | **< 120 s hard** | new |
| `investigation` | 40+ | current 3-phase engine + frontier steering | 20 min+ | p50 25 min |

`brief` is the sub-2-minute guarantee. It runs one search round of ~8 queries,
extracts facts from the top ~8 sources by credibility, does a single entity
pass, and synthesises once. No red team, no LinkedIn pass, no cross-session
linking (deferred to a background job so it never costs the user time).

Three rules make the guarantee hold:

1. **The budget is a wall-clock deadline, not a source count.** A new
   `$lib/deepdive/budget.ts` carries `deadline`, `remaining()`, and
   `reserveFor(stage)`. Synthesis always gets a reserved slice (~20 s) — the run
   degrades to "here is what I have" rather than overrunning or returning
   nothing.
2. **The deadline is checked inside stages, not only between them.** Today
   `isTimeUp()` is consulted between batches (`phase2.ts:107`), so one 15-second
   Tavily call plus one 45-second LLM call blows through it. Every await in a
   budgeted tier takes a signal derived from the deadline.
3. **Fast tiers pin a fast model.** They must not inherit the site default,
   which may be a reasoning model (reasoning tokens eat `max_tokens` and add tens
   of seconds) or a `codex/` id (~10 s first call). `instant`/`scan`/`brief` pin
   an OpenRouter non-reasoning id; `investigation` keeps the site default.

The launcher shows each tier's **measured p50 from the last N runs of that
tier**, not a promised number. The user's question — "how long will this take" —
gets answered with evidence.

### 2.2 The frontier: a session-bound graph that steers

Promote the graph from output to controller. A new `research_lead` table is the
durable work queue *and* the visible investigation shape.

A lead = a query + its provenance (which entity, gap or hypothesis spawned it) +
a running yield score + a status (`queued | running | productive | exhausted |
drifted | pruned`).

```
seed the graph with topic + goals as anchor nodes
while (budget remains && frontier has leads above threshold):
    take top-k leads by expected yield
    execute  → sources → facts → entities → edges
    score the lead on what it actually returned
    spawn child leads only from NEW entities and NEW gaps
    prune: mark leads dead below threshold; kill the whole subtree
```

**Yield scoring uses signals already computed — no extra LLM call:**

- `novelFacts` — facts that survived embedding dedup. `isDuplicate` already
  returns this (`phase2.ts:37-68`).
- `novelEntities` — entities not already in the session graph.
- `graphConnectivity` — do the new entities connect to the existing component,
  or float free? **A floating cluster is the signature of drift.**
- `goalAlignment` — cosine of the new facts' embeddings against the topic/goal
  embedding. The vectors already exist (`fact.embedding`, 1536-dim).

**The dead-end rule:** a lead whose children produce facts with low
`goalAlignment` *and* no edges into the main component is marked `drifted`, and
its entire subtree is pruned. This is emitted to the UI as a visible event —
*"abandoned: 'coffee futures Brazil' — 0 of 11 facts connected to the
question"*. The run says what it stopped doing and why.

Anchoring on topic + goals matters: connectivity must be measured against the
question, not against whatever the first search happened to return. Otherwise an
early wrong turn becomes the main component and the *correct* material gets
pruned as drift.

**Live rendering.** A new `graph` SSE event carries node/edge deltas and lead
status changes. Render with `$lib/components/intel/NetworkGraph.svelte` — d3
force, `NetNode[]`/`NetEdge[]`, already carrying the Svelte 5 discipline in its
header comment ("d3 handles are plain `let`, never `$state`"). Reuse it; do not
write a second force layout.

At 253 entities per session the raw entity graph is unreadable. **The live view
draws the frontier — tens of lead nodes showing the investigation's shape,
including the pruned branches** — with entities as weighted sub-nodes on
drill-down. The point of the live graph is "where is this going and what did it
give up on", not "here is every noun found".

**The frontier table also fixes durability.** Because leads are rows, a worker
that dies mid-run leaves a resumable queue. A boot sweep picks up any session in
a non-terminal state and continues it. Liveness comes from an explicit
`heartbeatAt` column written by the worker — never from subtracting `updatedAt`,
which has bitten this codebase before.

### 2.3 Dashboard

Bring back the retired route as the **default view for a run**, with the desk one
click away:

- `/research/[id]` → dashboard. Live during the run (graph + activity +
  reasoning lane); summary once complete.
- `/research/[id]/desk` → the canvas, unchanged.

Everything below already exists in `report` and needs rendering, not computing:

- Executive summary, plus **goal coverage** — per goal, answered / partial /
  unanswered. `knowledge_gaps[].goal_index` already carries this.
- Source diversity and credibility mix (`source_diversity`).
- Contradictions found (`contradictions_map`).
- Knowledge gaps, each with a **"research this"** button spawning a child session
  — `SeedContext` and `parentSessionId` plumbing already exists (`types.ts:113`).
- Hypotheses with testability and suggested queries, one click to test.
- Top entities by centrality (`entity_centrality`).
- **What was abandoned** — the pruned leads, with reasons. New, from §2.2.

**Actions row** — the "well connected into the rest of jkai" ask. Each of these
has a backend today and no button: send to chat as context (`@research`), push to
Intel (`intel-bridge.ts`), open a Studio brief (`research-brief.ts`), export
docx/md, build a deck, save to Drive.

Build the tiles with the `dataviz` skill; the type floor and modal token rules in
the design system apply.

### 2.4 SSE and the reasoning toggle

- Extend `runStream` (`ai.ts:200-253`) to read `delta.reasoning` alongside
  `delta.content` and fire an `onReasoning` callback.
- Add `reasoning`, `graph` and `lead` to the `SSEEvent` union (`types.ts:26-30`).
  Reasoning events carry the lead/stage id so the UI attaches them to the right
  activity rather than one undifferentiated firehose.
- Toggle defaults **off**, persisted. When the active model cannot stream
  reasoning (any `codex/` id — check `getProviderFeatures()`), the toggle
  explains why instead of showing an empty lane.
- Unify the two SSE event shapes onto one, so the dashboard, the desk and the
  workflow nodes read one stream.

### 2.5 Definition stage

A `scope` object on the session, set in a stage that is skippable — `instant` and
`scan` skip by default, `brief` and `investigation` show it.

```ts
interface ResearchScope {
  mode: 'open' | 'bounded' | 'exclusive';
  includeDomains?: string[];        // → tavily include_domains
  excludeDomains?: string[];        // already supported
  seedUrls?: string[];              // extracted directly, no search
  recency?: { days: number } | null;// → tavily topic:'news' + days
  sourceTypes?: string[];           // filtered via existing classifyDomain
  process?: string;                 // named reusable preset
}
```

- `open` — today's behaviour.
- `bounded` — prefer these domains, allow others but rank them down via a
  credibility bonus.
- `exclusive` — `include_domains` only. **If that returns nothing, say so
  loudly** rather than silently widening; a near-miss returning empty rather
  than erroring is a recurring trap in this codebase.

"Routes or processes" become **saved scope presets** — e.g. a *UK public sector*
process bundling gov.uk / parliament.uk / ons.gov.uk plus academic sources and
excluding social. Stored in `$lib/datastore/` so they are reusable across
sessions and selectable from tools and workflow nodes.

The stage ends with a **plan preview**: the generated queries and the domain
budget, editable before anything is spent. This is a scoping feature that doubles
as dead-end prevention — the user prunes bad angles at zero cost.

Requires `includeDomains` + `topic`/`days` passthrough in `tavily.ts` (~6 lines),
a `scope` jsonb column, and the UI.

### 2.6 Consolidation

One route family, one table, one worker, one event stream, four depths:

- `/research` — launcher and history across all tiers
- `/research/new` — definition stage
- `/research/[id]` — dashboard
- `/research/[id]/desk` — canvas
- `/deepdive/*`, `/quickanswer/*`, `/jkai/research` → 308 redirects (the retired
  dashboard/progress routes are the precedent for exactly this)

`research_session` gains `depth`, `scope`, `budgetMs`, `plan`, `heartbeatAt`.
`quick_answer` rows backfill as `depth='scan'` sessions. Keeping two tables means
every downstream surface keeps two code paths — which is the convolution being
removed.

---

## 3. Files to touch

**Phase 1 — depth, scope, budget (the sub-2-minute win)**

| File | Change |
|---|---|
| `src/lib/deepdive/types.ts` | `ResearchDepth`, `ResearchScope`; extend `SSEEvent` union |
| `src/lib/deepdive/budget.ts` | **new** — deadline, `remaining()`, `reserveFor(stage)` |
| `src/lib/deepdive/depth.ts` | **new** — the four presets → config + phases + model pin |
| `src/lib/deepdive/tavily.ts` | `includeDomains`, `topic`, `days` passthrough |
| `src/lib/deepdive/brief.ts` | **new** — the bounded `brief` runner |
| `src/lib/deepdive/worker.ts` | take a budget; run the tier's phase list, not a hard-coded 1→2→3 |
| `src/lib/db/schema.ts` | `research_session` += `depth`, `scope`, `budgetMs`, `plan`, `heartbeatAt` |
| `src/routes/api/research/+server.ts` | **new** — unified create (depth + scope + goals) |
| `src/routes/research/**` | **new** route family: launcher, definition stage |
| `src/lib/workflows/site-tools/tools/research.ts` | `research_start` accepts `depth` + `scope` — fixes the silently-dropped param |
| `src/lib/workflows/nodes/deep-research.ts` | pass depth through properly |

**Phase 2 — frontier and live graph**

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | `research_lead` table |
| `src/lib/deepdive/frontier.ts` | **new** — lead queue, yield scoring, pruning |
| `src/lib/deepdive/phase1.ts`, `phase2.ts` | draw from the frontier instead of `followUpQueue` |
| `src/lib/deepdive/desk-events.ts` | `graph` and `lead` event emission |
| `src/lib/components/research/FrontierGraph.svelte` | **new** — wraps `NetworkGraph.svelte` |
| `src/lib/deepdive/resume.ts` | **new** — boot sweep over stale non-terminal sessions |

**Phase 3 — dashboard and reasoning**

| File | Change |
|---|---|
| `src/routes/research/[id]/+page.svelte` | **new** — dashboard |
| `src/lib/deepdive/ai.ts` | `runStream` reads `delta.reasoning`, fires `onReasoning` |
| `src/routes/deepdive/**`, `src/routes/quickanswer/**` | 308 redirects |

---

### 3.1 Build order

**Phase 1 — depth, scope, budget.** Ships the sub-2-minute tier and the
definition stage. Independently useful: `brief` and scoped search are live even
if nothing else follows. Ends with the route family in place and the old routes
redirecting.

**Phase 2 — frontier, live graph, durability.** The `research_lead` table lands
once and serves all three: the steering queue, the frontier graph, and the
resume sweep. `investigation` starts pruning dead ends and surviving deploys.

**Phase 3 — dashboard and reasoning.** The dashboard is mostly rendering data
that already exists, so it goes last and gets the frontier's "what was
abandoned" panel for free. Reasoning streaming rides along with it.

Each phase merges to master on its own and deploys via CI. Phase 1 is
independently shippable; phases 2 and 3 assume phase 1's route family.

---

## 4. Verification

Stated before any code is written.

**Sub-2-minute guarantee** — five `brief` runs, then the same query that produced
the baseline in §0:

```sql
select depth, count(*), 
       round((percentile_cont(0.5) within group (order by duration_ms))::numeric/1000,1) p50_s,
       round((percentile_cont(0.95) within group (order by duration_ms))::numeric/1000,1) p95_s,
       round(max(duration_ms)/1000.0,1) max_s
from research_session where depth is not null group by 1;
```

Pass condition: `brief` p95 < 120 s, max < 120 s, zero runs returning no answer.

**Scope binding** — start with `scope.mode='exclusive'`,
`includeDomains:['gov.uk']`, then:

```sql
select distinct domain from source where session_id = '<id>';
```

Pass condition: gov.uk domains only; an empty result surfaces as a visible
"no sources matched your scope" state, not a silent widen.

**Dead-end pruning** — seed a deliberately ambiguous topic (a common name), then:

```sql
select status, count(*) from research_lead where session_id = '<id>' group by 1;
```

Pass condition: at least one lead reaches `drifted`, and no `running`/`queued`
leads descend from it.

**Streams** — `curl -N localhost:5173/api/research/<id>/stream` must contain
`"type":"graph"` during the run, and `"type":"reasoning"` when the toggle is on
with a streaming-capable model.

**Durability** — start an `investigation`, restart the service mid-run, confirm
the boot sweep resumes it and the session reaches a terminal status.

---

## 5. Known traps carried in

- Never subtract `updatedAt` for liveness — use the explicit heartbeat column.
- A near-miss scope filter returns **empty, never an error**. Make it loud.
- Reasoning models need a token floor or they truncate; fast tiers pin a
  non-reasoning model for this reason.
- Codex cannot stream reasoning at all.
- `NetworkGraph`/3D: install before `graphData()`; d3 handles are plain `let`,
  never `$state`.
- `ci-deploy.sh` is an allow-list — any new file under `scripts/` needs its own
  rsync line.
- Drizzle `.unique()` on a populated table breaks `push`; a column rename prompts
  on a TTY.

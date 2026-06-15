# Research Desk v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Overhaul the Research Desk: pile-based multi-dimension synthesize, /jkai/canvas restyle + view-locked floating filters, right-click NodePalette with a research-chat node and a report/export node, backed by streamed /chat + /report + /clusters(similarity) + /export/md endpoints.

**Architecture:** Reuse the /jkai/canvas grid/node/edge/palette internals, the deepdive LLM gateway (+ disableThinking, keeping the OpenRouter 429 fallback), pgvector embeddings (now populated) for similarity, and the existing export/docx pipeline. Client-only desk nodes; additive (no destructive schema).

**Tech Stack:** SvelteKit (Svelte 5 runes), Drizzle+Postgres+pgvector, SSE-over-POST streaming, Vitest, $lib/deepdive/ai.ts gateway.

---

## Contract glossary

```text
SHARED CONTRACT — use these EXACT names/paths/types verbatim.

ENDPOINTS (new, under src/routes/api/deepdive/[id]/):
- POST chat/+server.ts          — streamed SSE-over-POST; body { question, history? }; frames: data:{type:'sources',sources}, data:{type:'token',token}, data:{type:'done'}.
- GET  report/+server.ts        — returns { report } (researchSessions.report jsonb) or { report:null }.
- POST report/regenerate/+server.ts — fires runPostProcessing(sessionId) fire-and-forget; returns 202 { ok:true }.
- GET  clusters/+server.ts       — ?by=similarity → { clusters:[{factId,clusterId,clusterLabel}] }; greedy cosine over facts.embedding, cached per (sessionId,factCount).
- GET  export/md/+server.ts      — generateReportMarkdown(sessionId) → text/markdown + Content-Disposition attachment.
- MODIFY data/+server.ts         — add entityMentions:{entityId,factId}[] to the JSON payload.

LLM GATEWAY (src/lib/deepdive/ai.ts):
- Extend streamCompletion opts with disableThinking?:boolean → pass thinking:{type:'disabled'} into the z.ai chat.completions.create. MUST keep the existing OpenRouter 429 fallback + idle watchdog. The chat endpoint calls streamCompletion(system,user,{ disableThinking:true, maxTokens:3072, signal, onToken }).
- Reuse generateEmbedding(question) + the similar-facts pgvector query (src/routes/api/deepdive/[id]/similar-facts/+server.ts) for chat retrieval.

REPORT (src/lib/deepdive/docx-export.ts): add generateReportMarkdown(sessionId):Promise<string> (sibling of generateReport; uses ResearchReport jsonb; marked available). runPostProcessing is in src/lib/deepdive/postprocess.ts.

GROUPING (new src/lib/canvas/intelligence/desk/grouping.ts):
- export type GroupDim = 'cluster'|'theme'|'entityType'|'sentiment'|'cooccurrence'|'similarity';
- export function groupBy(dim:GroupDim, cards, edges, mentions, similarityMap):{ memberOf:Map<string,string>, groups:{key:string,label:string,count:number}[] }
  cluster=deskCategory; theme=themeOf (reuse desk/themes.ts); entityType=entities.type; sentiment=bucket edges by relationships.sentiment; cooccurrence=entities/facts sharing a factId via entityMentions; similarity=from similarityMap (factId->clusterId from the clusters endpoint).

LAYOUT (src/lib/canvas/intelligence/desk/layout.ts):
- export function pileLayout(groups, memberOf, cards, expanded:Set<string>):Map<string,{x,y}>  — grid of pile anchors (left->right), each group a fanned stack (offset {dx:6,dy:8}, descending z, ~5 visible) collapsed; expanded groups spread members into a column. Replaces organisedLayout/themeLayout callsites. Manual/pinned overrides still win in posOf.

NODES (client-only on the desk — STRIP the workflow server addNode/edge POST/PATCH):
- Lift src/lib/canvas/NodePalette.svelte + the oncontextmenu handler + openPalette/closePalette/onPalettePick + screenToWorld + resolveOverlap from src/routes/jkai/canvas/[slug]/+page.svelte into ResearchDesk.svelte.
- Register two new types in src/lib/canvas/adapter.ts CANVAS_NODE_TYPES: 'research-chat' and 'research-report' (+ NodeKind + KIND_COLOR in +page.svelte:1055-1068 + mapTypeToKind). Config panels cloned from src/lib/canvas/nodes/panels/DelayPanel.svelte, registered in panels/registry.ts AND added to SPECIALISED_PANEL_TYPES (+page.svelte:38-89). Renderers: src/lib/canvas/intelligence/desk/ResearchChatNode.svelte + desk/ReportNode.svelte, branched in the desk node {#each}.

RESTYLE (lift from src/routes/jkai/canvas/[slug]/+page.svelte): .viewport grid CSS (:5945-5964) + --grid-offset-x/y + --grid-cell (32*zoom) vars; .wf-node frame; .edge-stroke/.edge-hit + orthPath() for edges; .hifi-toolbar/.composer-pill/.hifi-zoomctl chrome. Apply to ResearchDesk.svelte's existing pan/zoom world.

FLOATING FILTERS (new src/lib/canvas/intelligence/desk/FloatingFilters.svelte): position:absolute; top:12px; left:12px; a SIBLING of the transformed world (view-locked, not panned). Holds the artefact-type filters (source/fact/entity/counterfactual — moved out of LeftFeed) + the GroupDim selector. REMOVE the LeftFeed left sidebar from the desk (keep the bottom ActivityTicker).

DESIGN TOKENS: --bg, --accent #c4570a, --surface-elevated, --card-border, --divider, --text-primary, --font-mono — all global. No new fonts/colors.

DEFAULT groupBy when synthesize first runs = 'similarity'.

TEST: Vitest, co-located *.test.ts. Sandbox: if a Bash command fails with EPERM/permission, retry with the Bash tool's dangerouslyDisableSandbox:true. NODE_OPTIONS=--max-old-space-size=8192 for svelte-check/tsc. Build/deploy sandbox-disabled. Git: trunk-based master; commit per task; footer: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---


I now have the complete, verified picture of every file this milestone touches. I have all the idioms: the ai.test.ts mock-client pattern, the synthesize/server.test.ts DB-mock pattern, the `runPostProcessing(sessionId, session)` two-arg signature, the `data/+server.ts` query shape, the `entityMentions` schema table (already imported in data/+server.ts but unused), the docx-export `generateReport` shape and `ResearchReport` type, the export endpoint Response idiom, and `marked ^17.0.6` is available.

Here is the milestone.

## Milestone 1: Backend foundations

This milestone delivers the five backend changes that everything else builds on, with no UI work. All paths are absolute under `/home/john/strange_rambling_svelte/`. Work on the `master` trunk; commit per task.

Pre-flight facts confirmed against the live code (do not re-derive):
- `streamCompletion` lives at `src/lib/deepdive/ai.ts:247`; the z.ai create call is inside `runStream` at `ai.ts:222`. The OpenRouter 429 fallback (`ai.ts:282-301`) and idle watchdog (`ai.ts:204-219`) MUST be preserved.
- `runPostProcessing` has signature `runPostProcessing(sessionId: string, session: ResearchSession): Promise<void>` (`src/lib/deepdive/postprocess.ts:18`) — it takes TWO args, so the regenerate endpoint must load the full session row first.
- `researchSessions.report` is `jsonb('report')` (nullable) at `schema.ts:377`; `ResearchSession = typeof researchSessions.$inferSelect` (`schema.ts:385`).
- The `ResearchReport` shape is in `src/lib/deepdive/types.ts:86-103`.
- `entityMentions` is already imported (unused) in `src/routes/api/deepdive/[id]/data/+server.ts:10` and has columns `entityId` / `factId` / `sessionId` (used in `postprocess.ts:71-74`).
- `marked` `^17.0.6` is installed.
- Vitest config includes `src/**/*.test.ts` (`vitest.config.ts`). Endpoint DB-mock idiom = `src/routes/api/deepdive/[id]/synthesize/server.test.ts`; ai-client mock idiom = `src/lib/deepdive/ai.test.ts`.
- The export Response idiom (`new Response(body, { headers })`, no `json()`) = `src/routes/api/deepdive/[id]/export/narrative-md/+server.ts`.

---

### Task 1: `streamCompletion` `disableThinking` option

Extend the gateway so the chat endpoint can pass `thinking:{type:'disabled'}` to z.ai without losing the OpenRouter fallback or idle watchdog. The option must thread through `streamCompletion → runStream → client.chat.completions.create`.

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/deepdive/ai.ts`
- Modify `/home/john/strange_rambling_svelte/src/lib/deepdive/ai.test.ts`

- [ ] **Step 1: Write the failing tests first.** Append these cases to the existing `describe('streamCompletion', ...)` block in `src/lib/deepdive/ai.test.ts` (insert before the closing `});` of that describe, after the existing `'does NOT apply fallback ...'` test). They assert the param is passed on the z.ai create, is absent by default, and is preserved on the OpenRouter fallback path.

```ts
  it('passes thinking:{type:disabled} to the z.ai create when disableThinking is true', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok', usage: 3 }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBe(true);
  });

  it('omits the thinking field entirely when disableThinking is not set', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body).not.toHaveProperty('thinking');
  });

  it('still falls back to OpenRouter on 429 with disableThinking set, and forwards thinking to the fallback create', async () => {
    mockZaiCreate.mockRejectedValueOnce(rate429());
    mockOrCreate.mockResolvedValueOnce(makeStream([{ delta: 'fallback' }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('fallback');
    expect(mockOrCreate).toHaveBeenCalledOnce();
    const [body] = mockOrCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
```

- [ ] **Step 2: Run the new tests — confirm they fail.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/ai.test.ts
```

Expected: the three new tests FAIL (the existing ~20 pass). Failure messages reference `body.thinking` being `undefined` (e.g. `expected undefined to deeply equal { type: 'disabled' }`). This proves the tests exercise the new behaviour. If a Bash sandbox `EPERM`/permission error appears, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Add `disableThinking` to `runStream`.** In `src/lib/deepdive/ai.ts`, change the `runStream` opts type and the create call. Replace the existing opts param of `runStream` (currently `opts: { temperature: number; maxTokens: number; signal: AbortSignal; onToken?: (t: string) => void }`) with one that includes `disableThinking`:

```ts
async function runStream(
  client: import('openai').default,
  model: string,
  messages: ChatCompletionMessageParam[],
  opts: { temperature: number; maxTokens: number; signal: AbortSignal; onToken?: (t: string) => void; disableThinking?: boolean },
): Promise<{ text: string; tokensUsed: number }> {
```

Then in the same function replace the create call (currently `ai.ts:222-225`) with a version that conditionally spreads `thinking`:

```ts
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: true,
        ...(opts.disableThinking ? { thinking: { type: 'disabled' } } : {}),
      } as any,
      { signal: idleAc.signal as any },
    );
```

(The `as any` is required because `thinking` is a z.ai-proprietary field not in the OpenAI SDK type — the file already uses `as any` on the signal for the same reason.)

- [ ] **Step 4: Add `disableThinking` to the `streamCompletion` public options and thread it through both `runStream` callsites.** In `src/lib/deepdive/ai.ts`, add the field to the `options` object type of `streamCompletion` (currently `ai.ts:250-256`):

```ts
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    model?: string;
    onToken?: (token: string) => void;
    disableThinking?: boolean;
  },
```

Then in the primary `runStream` call (`ai.ts:276-281`) add `disableThinking: options?.disableThinking,`:

```ts
    return await runStream(client, model, messages, {
      temperature,
      maxTokens,
      signal: externalAc.signal,
      onToken: options?.onToken,
      disableThinking: options?.disableThinking,
    });
```

And in the OpenRouter fallback `runStream` call (`ai.ts:293-298`) add the same field so the fallback also disables thinking:

```ts
      return runStream(getOpenRouterClient(), fallbackModel, messages, {
        temperature,
        maxTokens,
        signal: fallbackAc.signal,
        onToken: options?.onToken,
        disableThinking: options?.disableThinking,
      });
```

- [ ] **Step 5: Re-run the suite — confirm all pass.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/ai.test.ts
```

Expected output ends with `Test Files  1 passed (1)` and all tests passing (the original suite plus the 3 new cases). If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 6: Type-check the touched module.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "ai\.ts|error" | head
```

Expected: no errors referencing `src/lib/deepdive/ai.ts`. (A clean run prints `svelte-check found 0 errors`; pre-existing unrelated errors elsewhere are out of scope — only assert `ai.ts` is clean.) If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 7: Commit.**

```
git add src/lib/deepdive/ai.ts src/lib/deepdive/ai.test.ts
git commit -m "$(cat <<'EOF'
deepdive: add disableThinking option to streamCompletion

Threads thinking:{type:'disabled'} into the z.ai chat.completions.create
(and the OpenRouter fallback create) so callers can stop GLM reasoning-token
starvation. Preserves the existing 429 fallback + idle watchdog.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: add `entityMentions` to the `/data` payload

The co-occurrence grouping dimension (later milestone) needs `{ entityId, factId }[]` on the client. Add it to the existing `/data` JSON without disturbing the other arrays.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/data/server.test.ts`
- Modify `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/data/+server.ts`

- [ ] **Step 1: Write the failing integration-style test first.** This mocks `$lib/db` (mirroring `synthesize/server.test.ts`) so each `db.select().from(table)` resolves a per-table fixture, including an `entityMentions` query. Create `src/routes/api/deepdive/[id]/data/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-table fixtures keyed by the drizzle table object passed to .from(table).
let sessionRow: any = { id: 'sess-1', report: { entity_centrality: { 'e1': 0.5 } } };
const factRows = [
  { id: 'f1', content: 'fact one', confidence: 0.9, eventDate: null, isCounterfactual: false, refutesFactId: null, sourceId: 's1', tags: [] },
];
const entityRows = [{ id: 'e1', name: 'Acme', type: 'org', description: null }];
const sourceRows = [{ id: 's1', url: 'http://x', title: 'X', domain: 'x.com', category: 'news', credibilityScore: 0.8, credibilityType: 'news' }];
const relationshipRows = [{ id: 'r1', fromEntityId: 'e1', toEntityId: 'e1', relationshipType: 'rel', sentiment: 'neutral' }];
const mentionRows = [{ entityId: 'e1', factId: 'f1' }];

vi.mock('$lib/db/schema', () => ({
  researchSessions: { __t: 'researchSessions', id: {}, report: {} },
  facts: { __t: 'facts', id: {}, content: {}, confidence: {}, eventDate: {}, isCounterfactual: {}, refutesFactId: {}, sourceId: {}, tags: {} },
  entities: { __t: 'entities', sessionId: {} },
  sources: { __t: 'sources', id: {}, url: {}, title: {}, domain: {}, category: {}, credibilityScore: {}, credibilityType: {}, sessionId: {} },
  relationships: { __t: 'relationships', id: {}, fromEntityId: {}, toEntityId: {}, relationshipType: {}, sentiment: {}, sessionId: {} },
  entityMentions: { __t: 'entityMentions', entityId: {}, factId: {}, sessionId: {} },
}));

vi.mock('drizzle-orm', () => ({ eq: (..._a: any[]) => ({}) }));

vi.mock('$lib/db', () => {
  function rowsFor(table: any) {
    switch (table?.__t) {
      case 'researchSessions': return sessionRow ? [sessionRow] : [];
      case 'facts': return factRows;
      case 'entities': return entityRows;
      case 'sources': return sourceRows;
      case 'relationships': return relationshipRows;
      case 'entityMentions': return mentionRows;
      default: return [];
    }
  }
  // Builder supports both .limit() (session lookup) and .where() terminal awaits.
  const makeBuilder = (table: any) => {
    const result = rowsFor(table);
    const thenable: any = {
      where: () => ({ limit: async () => result, then: (r: any) => Promise.resolve(result).then(r) }),
      then: (r: any) => Promise.resolve(result).then(r),
    };
    // db.select(cols).from(table).where(...) returns a promise-like resolving to rows
    return { from: (_t?: any) => ({ where: () => Promise.resolve(result) }), ...thenable };
  };
  const db = {
    select: (_cols?: any) => ({
      from: (table: any) => ({
        where: () => ({ limit: async () => rowsFor(table) }),
      }),
    }),
  };
  // Override: the session lookup uses .limit(); the table queries terminate on .where().
  db.select = (_cols?: any) => ({
    from: (table: any) => {
      const result = rowsFor(table);
      const whereObj: any = (() => result);
      return {
        where: () => {
          const p: any = Promise.resolve(result);
          p.limit = async () => result;
          return p;
        },
      };
    },
  });
  return { db };
});

import { GET } from './+server';

function makeEvent(id: string) {
  return { params: { id } } as any;
}

beforeEach(() => {
  sessionRow = { id: 'sess-1', report: { entity_centrality: { 'e1': 0.5 } } };
});

describe('GET /api/deepdive/[id]/data', () => {
  it('includes entityMentions as {entityId,factId}[]', async () => {
    const res = await GET(makeEvent('sess-1'));
    const payload = await res.json();
    expect(payload.entityMentions).toEqual([{ entityId: 'e1', factId: 'f1' }]);
  });

  it('still returns facts/entities/sources/relationships', async () => {
    const res = await GET(makeEvent('sess-1'));
    const payload = await res.json();
    expect(payload.facts).toHaveLength(1);
    expect(payload.entities[0].centrality).toBe(0.5);
    expect(payload.sources).toHaveLength(1);
    expect(payload.relationships).toHaveLength(1);
  });

  it('404s when the session is missing', async () => {
    sessionRow = null;
    const res = await GET(makeEvent('nope'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/routes/api/deepdive/[id]/data/server.test.ts
```

Expected: the `includes entityMentions` test FAILS (`expected undefined to deeply equal [ { entityId: 'e1', factId: 'f1' } ]`). The other two should pass (they describe current behaviour). If the DB-mock shape causes the other two to error, fix the mock until only the `entityMentions` assertion fails — that is the red state we want. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Add the `entityMentions` query and payload field.** In `src/routes/api/deepdive/[id]/data/+server.ts`, the `Promise.all` destructure (`data/+server.ts:33`) currently reads `[allFacts, allEntities, allSources, allRelationships]`. Add a fifth query. Replace the destructure line:

```ts
  const [allFacts, allEntities, allSources, allRelationships, allMentions] = await Promise.all([
```

Then add this query as the final element of the `Promise.all` array, immediately after the `relationships` query block (after the `.where(eq(relationships.sessionId, params.id))` element, before the closing `]);`):

```ts
    db
      .select({
        entityId: entityMentions.entityId,
        factId: entityMentions.factId,
      })
      .from(entityMentions)
      .where(eq(entityMentions.sessionId, params.id)),
```

Then in the returned `json({...})` (`data/+server.ts:75-89`) add the new field after `relationships: allRelationships,`:

```ts
    relationships: allRelationships,
    entityMentions: allMentions,
```

(`entityMentions` is already imported at `data/+server.ts:10`, and `entityMentions.sessionId` exists per `postprocess.ts` usage — no new import needed.)

- [ ] **Step 4: Re-run the test — confirm all pass.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/routes/api/deepdive/[id]/data/server.test.ts
```

Expected: `Test Files  1 passed (1)`, 3 tests passing. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Commit.**

```
git add "src/routes/api/deepdive/[id]/data/+server.ts" "src/routes/api/deepdive/[id]/data/server.test.ts"
git commit -m "$(cat <<'EOF'
deepdive: expose entityMentions in /data payload

Adds entityMentions:{entityId,factId}[] to GET /api/deepdive/[id]/data so the
desk can build the entity/fact co-occurrence graph client-side.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `GET /api/deepdive/[id]/report` — report JSON read endpoint

The report node previews `researchSessions.report` without re-running the LLM. Returns `{ report }` or `{ report: null }`, with the standard session 404 guard.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/report/+server.ts`
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/report/server.test.ts`

- [ ] **Step 1: Write the failing tests first.** Mirror the `synthesize/server.test.ts` DB-mock idiom (`select().from().where()` resolves an array). Create `src/routes/api/deepdive/[id]/report/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionRows: any[] = [{ id: 'sess-1', report: { executive_summary: 'hi', clusters: [], ranked_facts: [], timeline: [], entity_centrality: {} } }];

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({ researchSessions: { id: {}, report: {} } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

import { GET } from './+server';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  sessionRows = [{ id: 'sess-1', report: { executive_summary: 'hi', clusters: [], ranked_facts: [], timeline: [], entity_centrality: {} } }];
});

describe('GET /api/deepdive/[id]/report', () => {
  it('returns { report } when the session has a report', async () => {
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.report.executive_summary).toBe('hi');
  });

  it('returns { report: null } when report is null', async () => {
    sessionRows = [{ id: 'sess-1', report: null }];
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.report).toBeNull();
  });

  it('404s when the session does not exist', async () => {
    sessionRows = [];
    const res = await GET(makeEvent('missing'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run "src/routes/api/deepdive/[id]/report/server.test.ts"
```

Expected: FAIL with a module-resolution error (`Cannot find module './+server'`) because the handler does not yet exist. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Implement the endpoint.** Create `src/routes/api/deepdive/[id]/report/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/deepdive/[id]/report
 * Returns the persisted ResearchReport jsonb for the report-preview node.
 * { report } when present, { report: null } when not yet generated.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  return json({ report: session.report ?? null });
};
```

- [ ] **Step 4: Re-run the tests — confirm all pass.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run "src/routes/api/deepdive/[id]/report/server.test.ts"
```

Expected: `Test Files  1 passed (1)`, 3 tests passing. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Commit.**

```
git add "src/routes/api/deepdive/[id]/report/+server.ts" "src/routes/api/deepdive/[id]/report/server.test.ts"
git commit -m "$(cat <<'EOF'
deepdive: add GET /api/deepdive/[id]/report

Returns the persisted researchSessions.report jsonb ({ report } or
{ report:null }) for the report-preview node, with the standard 404 guard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `POST /api/deepdive/[id]/report/regenerate` — fire-and-forget post-processing

Re-runs `runPostProcessing` (which rewrites `researchSessions.report`) in the background and returns `202 { ok: true }`. CRITICAL: `runPostProcessing(sessionId, session)` requires the full session row, so the handler must `SELECT *` (not just `id`) before kicking it off — mirroring how `postprocess.ts` reads `session.topic`/`session.goals`.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/report/regenerate/+server.ts`
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/report/regenerate/server.test.ts`

- [ ] **Step 1: Write the failing tests first.** Stub `$lib/deepdive/postprocess` so no LLM/DB runs, capture its calls, and assert the fire-and-forget contract (202, called once with the full session row, 404 when missing, no kickoff on 404). Create `src/routes/api/deepdive/[id]/report/regenerate/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runPostProcessingCalls: Array<{ sessionId: string; session: any }> = [];

vi.mock('$lib/deepdive/postprocess', () => ({
  runPostProcessing: vi.fn(async (sessionId: string, session: any) => {
    runPostProcessingCalls.push({ sessionId, session });
  }),
}));

let sessionRows: any[] = [{ id: 'sess-1', topic: 'T', goals: ['g'], report: null }];

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({ researchSessions: { id: {} } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

import { POST } from './+server';
import { runPostProcessing } from '$lib/deepdive/postprocess';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  runPostProcessingCalls.length = 0;
  (runPostProcessing as any).mockClear();
  sessionRows = [{ id: 'sess-1', topic: 'T', goals: ['g'], report: null }];
});

describe('POST /api/deepdive/[id]/report/regenerate', () => {
  it('returns 202 { ok:true } and fires runPostProcessing with the full session row', async () => {
    const res = await POST(makeEvent('sess-1'));
    expect(res.status).toBe(202);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true });

    // fire-and-forget: kicked off synchronously before the response resolves
    expect(runPostProcessingCalls).toHaveLength(1);
    expect(runPostProcessingCalls[0].sessionId).toBe('sess-1');
    expect(runPostProcessingCalls[0].session).toMatchObject({ id: 'sess-1', topic: 'T' });
  });

  it('404s when the session does not exist (no kickoff)', async () => {
    sessionRows = [];
    const res = await POST(makeEvent('missing'));
    expect(res.status).toBe(404);
    expect(runPostProcessingCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run "src/routes/api/deepdive/[id]/report/regenerate/server.test.ts"
```

Expected: FAIL with `Cannot find module './+server'`. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Implement the endpoint.** Note the `SELECT` must return the full row (use plain `.select()`), and the `.catch()` on the fire-and-forget call must swallow errors so an unhandled rejection cannot crash the process — mirroring `synthesize/+server.ts:36-38`. Create `src/routes/api/deepdive/[id]/report/regenerate/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { runPostProcessing } from '$lib/deepdive/postprocess';

/**
 * POST /api/deepdive/[id]/report/regenerate
 * Re-runs post-processing (rewrites researchSessions.report) in the background
 * so the report reflects current facts (incl. post-load synthesis).
 * Fire-and-forget; progress is visible via the existing SSE status/log stream.
 */
export const POST: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  // Fire-and-forget — do NOT await (mirrors startResearch / runSynthesis kickoff).
  runPostProcessing(params.id, session).catch((err) => {
    console.error(`[deepdive] report regenerate (runPostProcessing) crashed for ${params.id}:`, err);
  });

  return json({ ok: true }, { status: 202 });
};
```

- [ ] **Step 4: Re-run the tests — confirm all pass.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run "src/routes/api/deepdive/[id]/report/regenerate/server.test.ts"
```

Expected: `Test Files  1 passed (1)`, 2 tests passing. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Commit.**

```
git add "src/routes/api/deepdive/[id]/report/regenerate/+server.ts" "src/routes/api/deepdive/[id]/report/regenerate/server.test.ts"
git commit -m "$(cat <<'EOF'
deepdive: add POST /api/deepdive/[id]/report/regenerate

Loads the full session row and fires runPostProcessing(sessionId, session)
fire-and-forget, returning 202 { ok:true }. Lets the report node refresh a
stale report after on-demand synthesis.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `generateReportMarkdown(sessionId)` + `GET /api/deepdive/[id]/export/md`

A markdown sibling of `generateReport`, plus the route that serves it as a download. The function reads the same `ResearchReport` jsonb the docx path uses and assembles markdown by hand (no LLM). The route mirrors the `export/narrative-md` Response idiom.

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/deepdive/docx-export.ts`
- Create `/home/john/strange_rambling_svelte/src/lib/deepdive/report-markdown.test.ts`
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/export/md/+server.ts`

- [ ] **Step 1: Write the failing unit test first (shape of the markdown).** This mocks `$lib/db` so `generateReportMarkdown` runs without a real DB, exercising: title heading, executive summary, a cluster section with its facts, the "not generated" error path, and the "session not found" error path. Create `src/lib/deepdive/report-markdown.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-table fixtures resolved by .from(table) via a __t tag.
let sessionRows: any[] = [{
  id: 'sess-1',
  topic: 'Acme Corp',
  report: {
    executive_summary: 'First para.\n\nSecond para.',
    clusters: [{ title: 'Finances', summary: 'Money stuff.', fact_ids: ['f1', 'f2'] }],
    ranked_facts: ['f1', 'f2'],
    timeline: [],
    entity_centrality: { e1: 0.9 },
    knowledge_gaps: [{ gap: 'No regional data', type: 'geographic', severity: 'high' }],
  },
}];
const factRows = [
  { id: 'f1', content: 'Revenue rose.', confidence: 0.91, sourceId: 's1', isCounterfactual: false, refutesFactId: null },
  { id: 'f2', content: 'Costs fell.', confidence: 0.7, sourceId: 's1', isCounterfactual: false, refutesFactId: null },
];
const entityRows = [{ id: 'e1', name: 'Acme', type: 'org', description: 'a company' }];
const sourceRows = [{ id: 's1', url: 'http://acme.test', title: 'Acme Filing', domain: 'acme.test', phase: 1 }];

vi.mock('$lib/db/schema', () => ({
  researchSessions: { __t: 'researchSessions' },
  facts: { __t: 'facts' },
  entities: { __t: 'entities' },
  sources: { __t: 'sources' },
  entityMentions: { __t: 'entityMentions' },
  narrativeItems: { __t: 'narrativeItems' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), sql: () => ({}), asc: () => ({}) }));

vi.mock('$lib/db', () => {
  const rowsFor = (table: any) => {
    switch (table?.__t) {
      case 'researchSessions': return sessionRows;
      case 'facts': return factRows;
      case 'entities': return entityRows;
      case 'sources': return sourceRows;
      default: return [];
    }
  };
  return {
    db: {
      select: () => ({
        from: (table: any) => {
          const rows = rowsFor(table);
          const p: any = Promise.resolve(rows);
          p.where = () => Promise.resolve(rows);
          return p;
        },
      }),
    },
  };
});

import { generateReportMarkdown } from './docx-export';

beforeEach(() => {
  sessionRows = [{
    id: 'sess-1',
    topic: 'Acme Corp',
    report: {
      executive_summary: 'First para.\n\nSecond para.',
      clusters: [{ title: 'Finances', summary: 'Money stuff.', fact_ids: ['f1', 'f2'] }],
      ranked_facts: ['f1', 'f2'],
      timeline: [],
      entity_centrality: { e1: 0.9 },
      knowledge_gaps: [{ gap: 'No regional data', type: 'geographic', severity: 'high' }],
    },
  }];
});

describe('generateReportMarkdown', () => {
  it('renders title, executive summary, and cluster sections with facts', async () => {
    const md = await generateReportMarkdown('sess-1');
    expect(md).toContain('# Acme Corp');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('First para.');
    expect(md).toContain('Second para.');
    expect(md).toContain('## Finances');
    expect(md).toContain('Money stuff.');
    // facts appear with confidence
    expect(md).toContain('Revenue rose.');
    expect(md).toContain('Costs fell.');
    expect(md).toMatch(/confidence:\s*0\.91/);
  });

  it('renders knowledge gaps when present', async () => {
    const md = await generateReportMarkdown('sess-1');
    expect(md).toContain('No regional data');
  });

  it('throws "Report not yet generated" when report is null', async () => {
    sessionRows = [{ id: 'sess-1', topic: 'Acme Corp', report: null }];
    await expect(generateReportMarkdown('sess-1')).rejects.toThrow('Report not yet generated');
  });

  it('throws "Session not found" when the session is missing', async () => {
    sessionRows = [];
    await expect(generateReportMarkdown('missing')).rejects.toThrow('Session not found');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/report-markdown.test.ts
```

Expected: FAIL — `generateReportMarkdown` is not exported (`generateReportMarkdown is not a function`). If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Implement `generateReportMarkdown` in `docx-export.ts`.** Append this exported function to the END of `src/lib/deepdive/docx-export.ts` (after `generateNarrativeReport`). It reuses the existing `slugify` and the `ResearchReport` type already imported at the top of the file. It mirrors `generateReport`'s guards (`'Session not found'`, `'Report not yet generated'`) and section order (cover → exec summary → clusters → entities → gaps/hypotheses/follow-ups/source diversity → sources):

```ts
export async function generateReportMarkdown(sessionId: string): Promise<string> {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId));

  if (!session) throw new Error('Session not found');

  const report = session.report as ResearchReport | null;
  if (!report) throw new Error('Report not yet generated');

  const allFacts = await db.select().from(facts).where(eq(facts.sessionId, sessionId));
  const allEntities = await db.select().from(entities).where(eq(entities.sessionId, sessionId));
  const allSources = await db.select().from(sources).where(eq(sources.sessionId, sessionId));

  const factMap = new Map(allFacts.map((f) => [f.id, f]));
  const sourceMap = new Map(allSources.map((s) => [s.id, s]));
  const entityCentrality = report.entity_centrality ?? {};
  const dateStr = new Date().toISOString().slice(0, 10);
  const nonCfFacts = allFacts.filter((f) => !f.isCounterfactual);

  const lines: string[] = [];
  lines.push(`# ${session.topic}`);
  lines.push('');
  lines.push('*Deep Dive Research Report*');
  lines.push(`*Generated ${dateStr} — Facts: ${nonCfFacts.length} | Entities: ${allEntities.length} | Sources: ${allSources.length}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  for (const para of (report.executive_summary || '').split('\n\n')) {
    if (para.trim()) {
      lines.push(para.trim());
      lines.push('');
    }
  }

  // Topic clusters
  for (const cluster of report.clusters ?? []) {
    lines.push(`## ${cluster.title}`);
    lines.push('');
    if (cluster.summary) {
      lines.push(cluster.summary);
      lines.push('');
    }
    lines.push('### Key Findings');
    lines.push('');
    for (const factId of cluster.fact_ids ?? []) {
      const fact = factMap.get(factId);
      if (!fact) continue;
      const src = fact.sourceId ? sourceMap.get(fact.sourceId) : undefined;
      const cite = src ? ` ([${src.title ?? src.domain ?? 'source'}](${src.url}))` : '';
      lines.push(`- ${fact.content} *(confidence: ${fact.confidence.toFixed(2)})*${cite}`);
    }
    lines.push('');
  }

  // Key entities (top 50 by centrality)
  const sortedEntities = [...allEntities].sort(
    (a, b) => (entityCentrality[b.id] ?? 0) - (entityCentrality[a.id] ?? 0),
  );
  if (sortedEntities.length > 0) {
    lines.push('## Key Entities');
    lines.push('');
    lines.push('| Name | Type | Centrality |');
    lines.push('| --- | --- | --- |');
    for (const e of sortedEntities.slice(0, 50)) {
      lines.push(`| ${e.name} | ${e.type} | ${(entityCentrality[e.id] ?? 0).toFixed(2)} |`);
    }
    lines.push('');
  }

  // Knowledge gaps
  if (report.knowledge_gaps && report.knowledge_gaps.length > 0) {
    lines.push('## Knowledge Gaps');
    lines.push('');
    for (const g of report.knowledge_gaps) {
      lines.push(`- **[${g.severity}]** (${g.type}) ${g.gap}`);
    }
    lines.push('');
  }

  // Hypotheses
  if (report.hypotheses && report.hypotheses.length > 0) {
    lines.push('## Hypotheses');
    lines.push('');
    for (const h of report.hypotheses) {
      lines.push(`- ${h.hypothesis} *(testability: ${h.testability})*`);
    }
    lines.push('');
  }

  // Follow-up suggestions
  if (report.suggested_followups && report.suggested_followups.length > 0) {
    lines.push('## Suggested Follow-ups');
    lines.push('');
    for (const f of report.suggested_followups) {
      lines.push(`- **${f.question}** — ${f.context}`);
    }
    lines.push('');
  }

  // Source diversity
  if (report.source_diversity) {
    const sd = report.source_diversity;
    lines.push('## Source Diversity');
    lines.push('');
    lines.push(`- Distinct domains: ${sd.total_domains}`);
    lines.push(`- Concentration index: ${sd.concentration_index}`);
    lines.push('');
  }

  // Sources
  if (allSources.length > 0) {
    lines.push('## Sources');
    lines.push('');
    allSources.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.title ?? 'Untitled'}](${s.url}) — ${s.domain ?? 'unknown'} (Phase ${s.phase})`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the unit test — confirm all pass.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/report-markdown.test.ts
```

Expected: `Test Files  1 passed (1)`, 4 tests passing. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Implement the `export/md` route.** Mirror `export/narrative-md/+server.ts`'s `text/markdown` + `Content-Disposition` Response idiom, but delegate to `generateReportMarkdown` and surface its thrown errors. Create `src/routes/api/deepdive/[id]/export/md/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateReportMarkdown } from '$lib/deepdive/docx-export';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * GET /api/deepdive/[id]/export/md
 * Serves the auto research report as a markdown download.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ topic: researchSessions.topic })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return new Response('Session not found', { status: 404 });

  let md: string;
  try {
    md = await generateReportMarkdown(params.id);
  } catch (err: any) {
    // e.g. "Report not yet generated"
    return new Response(err?.message ?? 'Report unavailable', { status: 409 });
  }

  const filename = `deepdive-${slugify(session.topic)}-${new Date().toISOString().slice(0, 10)}.md`;

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
```

- [ ] **Step 6: Write + run the route test.** Create `src/routes/api/deepdive/[id]/export/md/server.test.ts` (stubs `generateReportMarkdown` and the session lookup; asserts the markdown body, the `Content-Disposition` header, the 409-on-not-generated path, and the 404):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionRows: any[] = [{ topic: 'Acme Corp' }];
let mdResult: string | Error = '# Acme Corp\n\n## Executive Summary\n\nHi.';

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ researchSessions: { topic: {}, id: {} } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('$lib/deepdive/docx-export', () => ({
  generateReportMarkdown: vi.fn(async () => {
    if (mdResult instanceof Error) throw mdResult;
    return mdResult;
  }),
}));

import { GET } from './+server';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  sessionRows = [{ topic: 'Acme Corp' }];
  mdResult = '# Acme Corp\n\n## Executive Summary\n\nHi.';
});

describe('GET /api/deepdive/[id]/export/md', () => {
  it('returns markdown with an attachment Content-Disposition', async () => {
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('deepdive-acme-corp-');
    expect(cd).toContain('.md');
    const body = await res.text();
    expect(body).toContain('# Acme Corp');
  });

  it('returns 409 when the report is not yet generated', async () => {
    mdResult = new Error('Report not yet generated');
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('Report not yet generated');
  });

  it('404s when the session is missing', async () => {
    sessionRows = [];
    const res = await GET(makeEvent('missing'));
    expect(res.status).toBe(404);
  });
});
```

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run "src/routes/api/deepdive/[id]/export/md/server.test.ts"
```

Expected: `Test Files  1 passed (1)`, 3 tests passing. If sandbox `EPERM`, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 7: Full deepdive suite + touched type-check — sanity gate.** Run the whole deepdive test folder plus the new route tests to confirm nothing regressed, then a focused type-check.

```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive "src/routes/api/deepdive/[id]/report" "src/routes/api/deepdive/[id]/export/md" "src/routes/api/deepdive/[id]/data"
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "docx-export\.ts|export/md|report/.*server|data/\+server|ai\.ts" | head
```

Expected: the vitest run reports all files passed (`Test Files  N passed`); the grep prints nothing (no new type errors in the files this milestone touched). If sandbox `EPERM` on either command, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 8: Commit.**

```
git add src/lib/deepdive/docx-export.ts src/lib/deepdive/report-markdown.test.ts "src/routes/api/deepdive/[id]/export/md/+server.ts" "src/routes/api/deepdive/[id]/export/md/server.test.ts"
git commit -m "$(cat <<'EOF'
deepdive: add generateReportMarkdown + GET /api/deepdive/[id]/export/md

generateReportMarkdown(sessionId) is a markdown sibling of generateReport that
reads the same ResearchReport jsonb (no LLM) and assembles a download. The route
serves it as text/markdown with an attachment Content-Disposition, mirroring the
narrative-md endpoint. Fills the report-as-markdown export gap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Milestone exit criteria:** `streamCompletion` accepts `disableThinking` (preserving fallback + watchdog); `/data` returns `entityMentions`; `GET report`, `POST report/regenerate`, and `GET export/md` are live with the contracted shapes/status codes; `generateReportMarkdown` exists in `docx-export.ts`. All new endpoints carry the session 404 guard. Full deepdive vitest suite green; no new type errors in touched files. Five commits on `master`. No UI, no schema changes, no deploy (later milestone).


I now have everything I need: the `1 - (e <=> e)` cosine idiom (`credibility.ts:142`), the `similar-facts` SQL shape, `toVectorLiteral` validation, the `fact` table (SQL name `fact`, columns `id`, `content`, `confidence`, `embedding`, `session_id`, `is_counterfactual`), the session-guard pattern, the in-memory cache pattern, and the test/integration conventions. Let me draft the milestone.

## Milestone 2: Similarity clusters endpoint

This milestone delivers `GET /api/deepdive/[id]/clusters?by=similarity` — greedy cosine-threshold clustering over `facts.embedding` (pgvector), returning `{ clusters: [{ factId, clusterId, clusterLabel }] }`. The clustering *logic* is extracted as a pure, fully unit-tested function (`greedyCluster`) operating on a list of `{ id, confidence, label }` plus a pairwise-similar predicate; the SQL similarity pass and HTTP plumbing live in the route, are integration/DB-gated, and reuse the `1 - (e <=> e)` cosine idiom (confirmed at `src/lib/deepdive/credibility.ts:142` and `src/routes/api/deepdive/[id]/similar-facts/+server.ts:32`). Cluster labels derive from the highest-confidence member fact (truncated). An in-memory cache is keyed on `(sessionId, factCount)`.

Confirmed repo facts (re-verified by content, line refs drifted-but-checked):
- The facts table maps to SQL table name `fact` with columns `id`, `session_id`, `content`, `confidence` (doublePrecision), `is_counterfactual` (boolean), `embedding` (vector). (`src/lib/db/schema.ts:411-432`)
- `toVectorLiteral(embedding: number[]): string` validates finiteness and returns `[a,b,c]`. (`src/lib/deepdive/vector.ts:8`)
- Cosine-similarity idiom in raw SQL: `1 - (embedding <=> ${vectorStr}::vector)`. (`credibility.ts:142`, `similar-facts/+server.ts:32`)
- Session-guard pattern: select `researchSessions.id` by `eq(researchSessions.id, params.id)`, 404 if absent. (`synthesize/+server.ts:10-17`)
- In-memory cache pattern: module-level `new Map<string, Entry>()` + `cacheKey()` helper. (`source-summary/+server.ts:24-55`)
- Vitest `describe`/`it`/`expect`, co-located `*.test.ts`; DB-gated integration tests use `const HAS_DB = !!process.env.DATABASE_URL; const suite = HAS_DB ? describe : describe.skip;`. (`delete.integration.test.ts:1-5`)

---

### Task 1: Pure greedy-cluster grouping module + unit tests

The clustering algorithm must be a pure function so it can be unit-tested without a database. It takes a list of items (each with `id`, `confidence`, and a candidate `label`) and a pairwise-similarity predicate (an adjacency set built by the caller from the SQL pass), and produces clusters via single-pass greedy union: each item joins the first existing cluster it is similar to (transitively, via the union), else starts a new cluster. The cluster label is the truncated content of the highest-confidence member.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/lib/deepdive/cluster-facts.ts`
- Create `/home/john/strange_rambling_svelte/src/lib/deepdive/cluster-facts.test.ts`

- [ ] **Step 1: Write the test file first (TDD — red).**

Create `/home/john/strange_rambling_svelte/src/lib/deepdive/cluster-facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { greedyCluster, truncateLabel, type ClusterItem } from './cluster-facts';

// Each test builds an explicit symmetric adjacency map (id -> Set of similar ids).
// greedyCluster must never read embeddings; it only consults `isSimilar`.
function adjacency(pairs: Array<[string, string]>): (a: string, b: string) => boolean {
  const map = new Map<string, Set<string>>();
  const add = (x: string, y: string) => {
    if (!map.has(x)) map.set(x, new Set());
    map.get(x)!.add(y);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a); // symmetric
  }
  return (a, b) => a === b || (map.get(a)?.has(b) ?? false);
}

const item = (id: string, confidence: number, content: string): ClusterItem => ({
  id,
  confidence,
  content,
});

describe('truncateLabel', () => {
  it('returns the content unchanged when within the limit', () => {
    expect(truncateLabel('short fact', 80)).toBe('short fact');
  });

  it('truncates long content at a word boundary and appends an ellipsis', () => {
    const long =
      'The Department for Education published new attainment statistics for the autumn term';
    const out = truncateLabel(long, 40);
    expect(out.length).toBeLessThanOrEqual(41); // 40 chars + the ellipsis char
    expect(out.endsWith('…')).toBe(true);
    // must not split mid-word
    expect(out.replace('…', '').trim().endsWith('attainment')).toBe(true);
  });

  it('collapses internal whitespace/newlines into single spaces', () => {
    expect(truncateLabel('line one\n\n  line two', 80)).toBe('line one line two');
  });

  it('handles empty content', () => {
    expect(truncateLabel('', 80)).toBe('');
  });
});

describe('greedyCluster', () => {
  it('groups two mutually-similar facts into one cluster', () => {
    const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta')];
    const out = greedyCluster(items, adjacency([['a', 'b']]));
    expect(out.length).toBe(2);
    // both in the same cluster
    const ca = out.find((r) => r.factId === 'a')!;
    const cb = out.find((r) => r.factId === 'b')!;
    expect(ca.clusterId).toBe(cb.clusterId);
  });

  it('keeps a fact with no similar neighbours as a singleton cluster', () => {
    const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta'), item('c', 0.5, 'gamma')];
    // a~b only; c is isolated
    const out = greedyCluster(items, adjacency([['a', 'b']]));
    const ca = out.find((r) => r.factId === 'a')!;
    const cc = out.find((r) => r.factId === 'c')!;
    expect(ca.clusterId).not.toBe(cc.clusterId);
    // c is alone in its cluster
    expect(out.filter((r) => r.clusterId === cc.clusterId).length).toBe(1);
  });

  it('transitively merges a chain a~b, b~c into one cluster even if a is not directly similar to c', () => {
    const items = [item('a', 0.9, 'alpha'), item('b', 0.8, 'beta'), item('c', 0.7, 'gamma')];
    const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
    const ids = new Set(out.map((r) => r.clusterId));
    expect(ids.size).toBe(1);
  });

  it('labels every cluster with the truncated content of its highest-confidence member', () => {
    const items = [
      item('a', 0.4, 'low confidence member'),
      item('b', 0.95, 'TOP confidence member'),
      item('c', 0.6, 'mid confidence member'),
    ];
    const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
    expect(out.every((r) => r.clusterLabel === 'TOP confidence member')).toBe(true);
  });

  it('assigns stable cluster ids of the form c0, c1, ... in first-seen order', () => {
    const items = [item('a', 0.9, 'alpha'), item('b', 0.7, 'beta'), item('c', 0.5, 'gamma')];
    const out = greedyCluster(items, adjacency([['b', 'c']]));
    // a seen first -> c0 (singleton); b -> c1; c joins b's cluster c1
    const ca = out.find((r) => r.factId === 'a')!;
    const cb = out.find((r) => r.factId === 'b')!;
    const cc = out.find((r) => r.factId === 'c')!;
    expect(ca.clusterId).toBe('c0');
    expect(cb.clusterId).toBe('c1');
    expect(cc.clusterId).toBe('c1');
  });

  it('returns one row per input fact and preserves all fact ids', () => {
    const items = [item('a', 0.9, 'a'), item('b', 0.8, 'b'), item('c', 0.7, 'c'), item('d', 0.6, 'd')];
    const out = greedyCluster(items, adjacency([['a', 'b'], ['c', 'd']]));
    expect(out.length).toBe(4);
    expect(new Set(out.map((r) => r.factId))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('returns an empty array for empty input', () => {
    expect(greedyCluster([], adjacency([]))).toEqual([]);
  });

  it('joins a new item to the FIRST existing cluster it matches (greedy), not all of them', () => {
    // a and c are NOT similar, but b is similar to both. b is processed last.
    // a -> c0, c -> c1, then b matches a(c0) first -> b joins c0. a,b in c0; c alone in c1.
    const items = [item('a', 0.9, 'alpha'), item('c', 0.8, 'gamma'), item('b', 0.7, 'beta')];
    const out = greedyCluster(items, adjacency([['a', 'b'], ['b', 'c']]));
    const ca = out.find((r) => r.factId === 'a')!;
    const cb = out.find((r) => r.factId === 'b')!;
    const cc = out.find((r) => r.factId === 'c')!;
    expect(cb.clusterId).toBe(ca.clusterId); // b joined a's cluster
    expect(cc.clusterId).not.toBe(ca.clusterId); // c stayed separate
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (red).**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/cluster-facts.test.ts
```

Expected output: the run fails to resolve the import `./cluster-facts` (module does not exist yet), e.g. `Error: Failed to load url ./cluster-facts` / `No test suite found` — confirming red. If a Bash command fails with EPERM/permission, retry the same command with the Bash tool's `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Implement the pure module (green).**

Create `/home/john/strange_rambling_svelte/src/lib/deepdive/cluster-facts.ts`:

```ts
/**
 * Pure greedy cosine-threshold clustering over a list of facts.
 *
 * The SQL/pgvector similarity pass lives in the route handler; this module is
 * deliberately database-free so it can be unit-tested in isolation. The caller
 * builds a symmetric `isSimilar(a, b)` predicate (an adjacency derived from the
 * `1 - (e <=> e) > threshold` query) and passes it in.
 *
 * Algorithm (single greedy pass, first-seen order):
 *   - For each item, find the FIRST existing cluster containing a member that
 *     is similar to the item. Join that cluster (no re-balancing).
 *   - Otherwise start a new cluster.
 * This yields transitive merges along chains while staying O(N * clusters)
 * and deterministic for a fixed input order.
 *
 * Cluster ids are `c0`, `c1`, ... in first-created order.
 * Cluster label = truncated content of the highest-confidence member.
 */

export interface ClusterItem {
  id: string;
  /** Higher = more confident; used to pick the cluster label. */
  confidence: number;
  /** Fact content; the highest-confidence member's content becomes the label. */
  content: string;
}

export interface ClusterAssignment {
  factId: string;
  clusterId: string;
  clusterLabel: string;
}

const DEFAULT_LABEL_LEN = 80;

/**
 * Normalise whitespace and truncate to `maxLen` chars at a word boundary,
 * appending a single-character ellipsis (…) when truncated.
 */
export function truncateLabel(content: string, maxLen = DEFAULT_LABEL_LEN): string {
  const normalised = content.replace(/\s+/g, ' ').trim();
  if (normalised.length <= maxLen) return normalised;
  const slice = normalised.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

interface WorkingCluster {
  id: string;
  members: ClusterItem[];
}

export function greedyCluster(
  items: ClusterItem[],
  isSimilar: (a: string, b: string) => boolean,
  labelLen = DEFAULT_LABEL_LEN,
): ClusterAssignment[] {
  const clusters: WorkingCluster[] = [];
  let nextId = 0;

  for (const item of items) {
    // Greedy: join the first cluster with any member similar to this item.
    let joined: WorkingCluster | undefined;
    for (const cluster of clusters) {
      if (cluster.members.some((m) => isSimilar(item.id, m.id))) {
        joined = cluster;
        break;
      }
    }
    if (joined) {
      joined.members.push(item);
    } else {
      clusters.push({ id: `c${nextId++}`, members: [item] });
    }
  }

  const out: ClusterAssignment[] = [];
  for (const cluster of clusters) {
    // Label = highest-confidence member's truncated content.
    const top = cluster.members.reduce((best, m) =>
      m.confidence > best.confidence ? m : best,
    );
    const label = truncateLabel(top.content, labelLen);
    for (const m of cluster.members) {
      out.push({ factId: m.id, clusterId: cluster.id, clusterLabel: label });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes (green).**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/cluster-facts.test.ts
```

Expected output: all tests pass, e.g. `Test Files  1 passed (1)` and `Tests  13 passed (13)`. If EPERM/permission, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Type-check the new module.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'cluster-facts' || echo "no cluster-facts type errors"
```

Expected output: `no cluster-facts type errors` (the grep finds no diagnostics mentioning the new file).

- [ ] **Step 6: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/cluster-facts.ts src/lib/deepdive/cluster-facts.test.ts && git commit -m "$(cat <<'EOF'
deepdive: add pure greedyCluster grouping + unit tests

Extracts the greedy cosine-threshold clustering as a database-free pure
function operating on {id,confidence,content} + an isSimilar predicate.
Clusters by transitive similarity (greedy first-match), produces stable
c0/c1/... ids, and labels each cluster with the truncated content of its
highest-confidence member. Fully unit-tested (singletons, transitive
chains, greedy first-match, labelling, truncation).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"</parameter>
```

---

### Task 2: Clusters endpoint (SQL similarity pass + in-memory cache)

Implement the route. It loads non-counterfactual facts with embeddings for the session, runs the pgvector cosine query per fact to build the symmetric adjacency, hands `{id,confidence,content}` + the `isSimilar` predicate to `greedyCluster`, and caches the result in-memory keyed on `(sessionId, factCount)`. Only `?by=similarity` is supported in v1.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/clusters/+server.ts`

- [ ] **Step 1: Implement the route handler.**

Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/clusters/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { toVectorLiteral } from '$lib/deepdive/vector';
import { greedyCluster, type ClusterAssignment, type ClusterItem } from '$lib/deepdive/cluster-facts';

// Cosine-similarity threshold for two facts to be "the same cluster".
// Reuses the `1 - (e <=> e)` idiom from credibility.ts; tuned slightly tighter
// (0.82) than the source-agreement pass (0.85) so near-duplicate AND closely
// paraphrased facts group, without collapsing loosely-related topics.
const SIMILARITY_THRESHOLD = 0.82;

// Cap neighbours fetched per fact — clustering is transitive so we don't need
// the full pairwise matrix, just enough edges to connect the components.
const NEIGHBOUR_LIMIT = 25;

// ——— in-memory cache, keyed on (sessionId, factCount) ———
// Recompute only when the number of facts changes (new facts loaded / synthesis
// added/removed facts). Embeddings never leave the server.
interface CacheEntry {
  factCount: number;
  clusters: ClusterAssignment[];
}
const clusterCache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, factCount: number): string {
  return `${sessionId}:${factCount}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const sessionId = params.id;
  const by = url.searchParams.get('by') ?? 'similarity';

  if (by !== 'similarity') {
    return json({ error: `Unsupported clustering dimension: ${by}` }, { status: 400 });
  }

  // 404-guard the session (mirrors synthesize/+server.ts).
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId));
  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  // Load all clusterable facts (non-counterfactual, embedded).
  const rows = await db
    .select({
      id: facts.id,
      content: facts.content,
      confidence: facts.confidence,
      embedding: facts.embedding,
    })
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

  const embedded = rows.filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
  const factCount = embedded.length;

  // Serve from cache when the fact set hasn't grown/shrunk.
  const cached = clusterCache.get(cacheKey(sessionId, factCount));
  if (cached) {
    return json({ clusters: cached.clusters });
  }

  if (factCount === 0) {
    const empty: ClusterAssignment[] = [];
    clusterCache.set(cacheKey(sessionId, factCount), { factCount, clusters: empty });
    return json({ clusters: empty });
  }

  // Build the symmetric adjacency via the pgvector cosine query per fact.
  // Reuses the `1 - (embedding <=> vec)::vector > threshold` idiom.
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const fact of embedded) {
    const vectorStr = toVectorLiteral(fact.embedding as number[]);
    const similar = await db.execute(
      sql`SELECT id
          FROM fact
          WHERE session_id = ${sessionId}
            AND id != ${fact.id}
            AND NOT is_counterfactual
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > ${SIMILARITY_THRESHOLD}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${NEIGHBOUR_LIMIT}`,
    );
    for (const r of similar.rows as Array<{ id: string }>) {
      addEdge(fact.id, r.id);
    }
  }

  const isSimilar = (a: string, b: string): boolean =>
    a === b || (adjacency.get(a)?.has(b) ?? false);

  const items: ClusterItem[] = embedded.map((r) => ({
    id: r.id,
    confidence: r.confidence,
    content: r.content,
  }));

  const clusters = greedyCluster(items, isSimilar);
  clusterCache.set(cacheKey(sessionId, factCount), { factCount, clusters });

  return json({ clusters });
};
```

Notes on contract adherence:
- Response shape is exactly `{ clusters: [{ factId, clusterId, clusterLabel }] }` (from `greedyCluster`'s `ClusterAssignment`).
- `?by=similarity` is the only supported dimension; anything else is a 400 (the integration map ties the `similarity` group dimension to this endpoint).
- Cache key is `(sessionId, factCount)` per the brief.
- `embedding` from Drizzle's `vector` column deserialises to `number[]`; `toVectorLiteral` already validates finiteness, so no extra sanitisation is needed before the raw SQL fragment.

- [ ] **Step 2: Type-check the route.**

```bash
cd /home/john/strange_rambling_svelte && npx svelte-kit sync && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'clusters/\+server' || echo "no clusters route type errors"
```

Expected output: `no clusters route type errors`. (The `svelte-kit sync` step generates `./$types` for the new route so the import resolves.)

- [ ] **Step 3: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/routes/api/deepdive/\[id\]/clusters/+server.ts && git commit -m "$(cat <<'EOF'
deepdive: add GET /api/deepdive/[id]/clusters?by=similarity

Greedy cosine-threshold clustering over facts.embedding. Loads
non-counterfactual embedded facts, builds a symmetric adjacency via the
pgvector `1 - (e <=> e) > 0.82` idiom (per-fact, capped neighbours), then
hands {id,confidence,content} + the isSimilar predicate to the pure
greedyCluster. Returns {clusters:[{factId,clusterId,clusterLabel}]} with
labels from the highest-confidence member. In-memory cache keyed on
(sessionId, factCount). 404 on missing session; 400 on unsupported `by`.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"</parameter>
```

---

### Task 3: DB-gated integration test for the clusters endpoint

The SQL/embedding path can't be unit-tested without Postgres, so it is integration/DB-gated (skips cleanly when `DATABASE_URL` is unset), matching `delete.integration.test.ts`. It seeds a session + facts with hand-crafted embeddings (two near-identical vectors → one cluster; one orthogonal vector → singleton), exercises the real handler, and asserts the response contract + cache behaviour.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/clusters/clusters.integration.test.ts`

- [ ] **Step 1: Write the integration test.**

Create `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/clusters/clusters.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable (mirrors delete.integration.test.ts).
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('GET /api/deepdive/[id]/clusters (integration)', () => {
  let db: typeof import('$lib/db')['db'];
  let schema: typeof import('$lib/db/schema');
  let GET_handler: typeof import('./+server')['GET'];
  let eq: typeof import('drizzle-orm')['eq'];

  let sessionId: string;
  let sourceId: string;

  // 4-dim unit-ish embeddings (the column is dimension-agnostic for the cosine op).
  const VEC_A1 = [1, 0, 0, 0];
  const VEC_A2 = [0.98, 0.04, 0, 0]; // ~cosine 0.999 with A1 -> same cluster
  const VEC_B = [0, 0, 1, 0]; // orthogonal to A* -> singleton

  function makeEvent(id: string, by = 'similarity') {
    return {
      params: { id },
      url: new URL(`http://localhost/api/deepdive/${id}/clusters?by=${by}`),
    } as unknown as Parameters<typeof GET_handler>[0];
  }

  beforeAll(async () => {
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    ({ GET: GET_handler } = await import('./+server'));
    ({ eq } = await import('drizzle-orm'));

    const [session] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'clusters integration test' })
      .returning({ id: schema.researchSessions.id });
    sessionId = session.id;

    const [source] = await db
      .insert(schema.sources)
      .values({ sessionId, url: 'https://example.test/clusters', title: 'Clusters test source' })
      .returning({ id: schema.sources.id });
    sourceId = source.id;

    await db.insert(schema.facts).values([
      {
        sessionId,
        sourceId,
        content: 'Alpha fact about the policy with high confidence',
        confidence: 0.95,
        embedding: VEC_A1,
      },
      {
        sessionId,
        sourceId,
        content: 'Alpha fact restated slightly differently lower confidence',
        confidence: 0.6,
        embedding: VEC_A2,
      },
      {
        sessionId,
        sourceId,
        content: 'Beta fact about an unrelated topic',
        confidence: 0.7,
        embedding: VEC_B,
      },
    ]);
  });

  afterAll(async () => {
    if (!sessionId) return;
    await db.delete(schema.facts).where(eq(schema.facts.sessionId, sessionId));
    await db.delete(schema.sources).where(eq(schema.sources.sessionId, sessionId));
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, sessionId));
  });

  it('returns 404 for a non-existent session', async () => {
    const res = await GET_handler(makeEvent('00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('rejects unsupported `by` dimensions with 400', async () => {
    const res = await GET_handler(makeEvent(sessionId, 'theme'));
    expect(res.status).toBe(400);
  });

  it('returns the {factId,clusterId,clusterLabel} contract with correct grouping', async () => {
    const res = await GET_handler(makeEvent(sessionId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clusters: Array<{ factId: string; clusterId: string; clusterLabel: string }>;
    };

    // One row per embedded fact.
    expect(body.clusters.length).toBe(3);
    for (const c of body.clusters) {
      expect(typeof c.factId).toBe('string');
      expect(typeof c.clusterId).toBe('string');
      expect(typeof c.clusterLabel).toBe('string');
    }

    // Group the assignments by clusterId.
    const byCluster = new Map<string, string[]>();
    for (const c of body.clusters) {
      if (!byCluster.has(c.clusterId)) byCluster.set(c.clusterId, []);
      byCluster.get(c.clusterId)!.push(c.factId);
    }

    // Exactly two clusters: the two Alpha facts together, Beta alone.
    expect(byCluster.size).toBe(2);
    const sizes = [...byCluster.values()].map((v) => v.length).sort();
    expect(sizes).toEqual([1, 2]);

    // The 2-member cluster's label = the highest-confidence (Alpha A1) content, truncated.
    const bigCluster = [...byCluster.values()].find((v) => v.length === 2)!;
    const labelRow = body.clusters.find((c) => c.factId === bigCluster[0])!;
    expect(labelRow.clusterLabel).toContain('Alpha fact about the policy');
  });

  it('serves the same result from cache on a second call (cache keyed on factCount)', async () => {
    const first = await GET_handler(makeEvent(sessionId));
    const second = await GET_handler(makeEvent(sessionId));
    const a = await first.json();
    const b = await second.json();
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run the integration test (DB-reachable on homeserv via `DATABASE_URL`).**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/routes/api/deepdive/\[id\]/clusters/clusters.integration.test.ts
```

Expected output when Postgres is reachable: `Test Files  1 passed (1)` / `Tests  4 passed (4)`. If `DATABASE_URL` is unset the suite is skipped (`describe.skip`) and you'll see `4 skipped` — that is acceptable for environments without a DB, but on homeserv the dev `.env` provides `DATABASE_URL`, so prefer running it green. If a Bash command fails with EPERM/permission, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Run the full deepdive test slice to confirm no regressions.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/cluster-facts.test.ts src/routes/api/deepdive/\[id\]/clusters/
```

Expected output: all unit tests pass and the integration suite passes (or skips when no DB). No failures.

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/routes/api/deepdive/\[id\]/clusters/clusters.integration.test.ts && git commit -m "$(cat <<'EOF'
deepdive: DB-gated integration test for clusters endpoint

Seeds a session + facts with crafted embeddings (two near-identical
vectors -> one cluster, one orthogonal -> singleton), exercises the real
GET handler, and asserts the {factId,clusterId,clusterLabel} contract,
the 404/400 guards, the highest-confidence-member label, and cache reuse.
Skips cleanly when DATABASE_URL is unset (mirrors delete.integration.test.ts).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"</parameter>
```


I have all the context I need. I've confirmed: `streamCompletion` opts, the `runStream` create call (where `thinking` must be injected), the OpenRouter fallback + idle watchdog, the policy-engine SSE pattern, the `similar-facts` SQL idiom, the `ResearchReport` shape, schema for `facts`/`sources`/`researchSessions`, the `keys.ts` model, the data-endpoint session-guard pattern, and the vitest mocking conventions. Now I'll write the milestone.

## Milestone 3: Research chat endpoint

This milestone adds the streamed, retrieval-grounded chat endpoint `POST /api/deepdive/[id]/chat`. It is split into a tested **pure context-assembly + prompt-builder helper** (no network, no DB — fully unit-testable), a small **`disableThinking` extension to `streamCompletion`** (TDD'd against the existing mock harness), and a thin **SSE-over-POST endpoint** that wires retrieval, the overview, and the streamer together, mirroring `src/routes/projects/policy-engine/chat/+server.ts` (server) and the `AskModel.svelte` reader pattern (consumed by the client node in a later milestone — not built here).

All paths are absolute from the repo root `/home/john/strange_rambling_svelte/`. Trunk-based on `master`; commit per task.

---

### Task 1: Extend `streamCompletion` with `disableThinking`

The chat endpoint must call `streamCompletion(system, user, { disableThinking:true, maxTokens:3072, signal, onToken })`. GLM-5.1 otherwise burns the token budget on reasoning and can return empty content (see `feedback_glm_reasoning_tokens.md`). We add a `disableThinking?: boolean` option that injects `thinking: { type: 'disabled' }` into the z.ai `chat.completions.create` call inside `runStream`, while keeping the existing OpenRouter 429 fallback and the idle watchdog fully intact.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/deepdive/ai.ts`
- Modify: `/home/john/strange_rambling_svelte/src/lib/deepdive/ai.test.ts`

- [ ] **Step 1: Write the failing tests first.** Append these three cases to the existing `describe('streamCompletion', ...)` block in `ai.test.ts`, immediately before its closing `});`. They assert the create-call body carries `thinking:{type:'disabled'}` when the option is set, that it is absent otherwise, and that the option does NOT break the existing OpenRouter 429 fallback (the fallback create body must also carry it). The mock harness (`mockZaiCreate`, `mockOrCreate`, `makeStream`, `rate429`, fake timers) already exists at the top of the file — reuse it.

```ts
  it('passes thinking:{type:"disabled"} to the z.ai create call when disableThinking is set', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok' }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.stream).toBe(true);
  });

  it('does NOT set thinking when disableThinking is absent', async () => {
    mockZaiCreate.mockResolvedValueOnce(makeStream([{ delta: 'ok' }]));

    const promise = streamCompletion('sys', 'user');
    await vi.runAllTimersAsync();
    await promise;

    const [body] = mockZaiCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
  });

  it('keeps the OpenRouter 429 fallback AND carries disableThinking into the fallback create', async () => {
    mockZaiCreate.mockRejectedValueOnce(rate429());
    mockOrCreate.mockResolvedValueOnce(makeStream([{ delta: 'fallback text' }]));

    const promise = streamCompletion('sys', 'user', { disableThinking: true });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.text).toBe('fallback text');
    expect(mockOrCreate).toHaveBeenCalledOnce();
    const [body] = mockOrCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
```

- [ ] **Step 2: Run the new tests and confirm they fail.** They must fail because `disableThinking` is not yet threaded through.

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/ai.test.ts
```
Expected: the three new `streamCompletion` cases fail (`body.thinking` is `undefined` when it should equal `{ type: 'disabled' }`); the pre-existing `ai.test.ts` cases still pass. If the Bash call fails with EPERM/permission, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Thread `disableThinking` through `runStream`.** In `ai.ts`, update the `runStream` signature's `opts` to accept `disableThinking` and inject `thinking` into the create body. Replace the existing `runStream` `opts` type and the `client.chat.completions.create(...)` call.

Change the `opts` parameter type (currently `opts: { temperature: number; maxTokens: number; signal: AbortSignal; onToken?: (t: string) => void }`) to:

```ts
  opts: { temperature: number; maxTokens: number; signal: AbortSignal; onToken?: (t: string) => void; disableThinking?: boolean },
```

Replace the create call inside `runStream` (the block beginning `const stream = await client.chat.completions.create(`) with:

```ts
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: true,
        // GLM-5.1 burns max_tokens on reasoning and can return empty content for short
        // grounded answers. When disableThinking is set we suppress it. The field is a
        // z.ai extension, hence the `as any` cast (it is not in the OpenAI types).
        ...(opts.disableThinking ? { thinking: { type: 'disabled' } } : {}),
      } as any,
      { signal: idleAc.signal as any },
    );
```

- [ ] **Step 4: Forward `disableThinking` from `streamCompletion` into both `runStream` calls.** In `streamCompletion`, add the option to the public signature and pass it to the primary call and the OpenRouter fallback call so the fallback also suppresses thinking.

Add `disableThinking?: boolean;` to the `streamCompletion` `options` object type (alongside `temperature`, `maxTokens`, `signal`, `model`, `onToken`):

```ts
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    model?: string;
    onToken?: (token: string) => void;
    disableThinking?: boolean;
  },
```

In the primary `runStream` call inside the `try` block, add the field:

```ts
    return await runStream(client, model, messages, {
      temperature,
      maxTokens,
      signal: externalAc.signal,
      onToken: options?.onToken,
      disableThinking: options?.disableThinking,
    });
```

In the OpenRouter fallback `runStream` call (inside the `catch`), add it too:

```ts
      return runStream(getOpenRouterClient(), fallbackModel, messages, {
        temperature,
        maxTokens,
        signal: fallbackAc.signal,
        onToken: options?.onToken,
        disableThinking: options?.disableThinking,
      });
```

- [ ] **Step 5: Run the tests and confirm all pass.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/ai.test.ts
```
Expected: all `ai.test.ts` suites pass — `isRateLimitError`, `chatCompletion`, `jsonCompletion`, and `streamCompletion` (including the three new cases). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 6: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/ai.ts src/lib/deepdive/ai.test.ts && git commit -m "$(cat <<'EOF'
deepdive(ai): add disableThinking option to streamCompletion

GLM-5.1 burns the max_tokens budget on reasoning and can return empty
content for short grounded answers. disableThinking injects
thinking:{type:'disabled'} into the z.ai create call. The OpenRouter 429
fallback and the idle watchdog are unchanged; the flag is forwarded into
the fallback create too.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure chat context-assembly + prompt-builder helper (TDD)

The non-trivial, network-free logic lives in a pure module: building the compact session overview from `ResearchReport`, ranking/numbering retrieved passages, resolving sources to `[n]` citation metadata, capping passages and history, and assembling the system + user prompts. This is the unit under test. The endpoint (Task 3) only does I/O (DB load, embedding, SQL retrieval) and feeds the resolved inputs into this helper.

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/deepdive/chat-context.ts`
- Create: `/home/john/strange_rambling_svelte/src/lib/deepdive/chat-context.test.ts`

- [ ] **Step 1: Write the failing test first.** This pins the public contract of the helper: input shapes, the source-numbering / passage-capping rules, overview-vs-fallback selection, history capping, and that both prompts contain the load-bearing instructions.

```ts
// src/lib/deepdive/chat-context.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildOverview,
  numberSources,
  buildChatPrompt,
  CHAT_SYSTEM,
  PASSAGE_CAP,
  MAX_HISTORY_TURNS,
  type RetrievedFact,
  type SourceMeta,
} from './chat-context';
import type { ResearchReport } from './types';

const report: ResearchReport = {
  ranked_facts: ['f-top-1', 'f-top-2'],
  timeline: [],
  clusters: [
    { title: 'Funding mechanics', summary: 'How money flows.', fact_ids: ['f-top-1'] },
    { title: 'Equity gap', summary: 'The disadvantage gap.', fact_ids: ['f-top-2'] },
  ],
  executive_summary: 'A study of education policy levers and their effects.',
  entity_centrality: { 'e-1': 0.9, 'e-2': 0.4, 'e-3': 0.1 },
};

const factsById = new Map([
  ['f-top-1', { id: 'f-top-1', content: 'Per-pupil funding rose 3% in real terms.', confidence: 0.8 }],
  ['f-top-2', { id: 'f-top-2', content: 'The disadvantage gap widened post-2019.', confidence: 0.7 }],
]);

const entitiesById = new Map([
  ['e-1', { id: 'e-1', name: 'Department for Education', type: 'org' }],
  ['e-2', { id: 'e-2', name: 'Ofsted', type: 'org' }],
  ['e-3', { id: 'e-3', name: 'Pupil Premium', type: 'concept' }],
]);

describe('buildOverview — from report', () => {
  it('includes the executive summary', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('A study of education policy levers');
  });

  it('lists top ranked facts by their content', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('Per-pupil funding rose 3% in real terms.');
    expect(ov).toContain('The disadvantage gap widened post-2019.');
  });

  it('lists cluster titles', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    expect(ov).toContain('Funding mechanics');
    expect(ov).toContain('Equity gap');
  });

  it('lists top entities ordered by centrality (DfE before Ofsted before Pupil Premium)', () => {
    const ov = buildOverview(report, factsById, entitiesById);
    const dfe = ov.indexOf('Department for Education');
    const ofsted = ov.indexOf('Ofsted');
    const pp = ov.indexOf('Pupil Premium');
    expect(dfe).toBeGreaterThanOrEqual(0);
    expect(dfe).toBeLessThan(ofsted);
    expect(ofsted).toBeLessThan(pp);
  });
});

describe('buildOverview — fallback when no report', () => {
  it('falls back to the top-confidence facts when report is null', () => {
    const fallbackFacts = [
      { id: 'a', content: 'Low conf fact.', confidence: 0.2 },
      { id: 'b', content: 'High conf fact.', confidence: 0.95 },
    ];
    const ov = buildOverview(null, new Map(), new Map(), fallbackFacts);
    // Highest-confidence fact must appear first
    expect(ov.indexOf('High conf fact.')).toBeLessThan(ov.indexOf('Low conf fact.'));
    expect(ov).toContain('High conf fact.');
  });

  it('returns a non-empty string even with no report and no facts', () => {
    const ov = buildOverview(null, new Map(), new Map(), []);
    expect(ov.length).toBeGreaterThan(0);
  });
});

describe('numberSources', () => {
  const retrieved: RetrievedFact[] = [
    { id: 'r1', content: 'Passage one.', sourceId: 's1', similarity: 0.9 },
    { id: 'r2', content: 'Passage two.', sourceId: 's2', similarity: 0.8 },
    { id: 'r3', content: 'Passage three, same source as one.', sourceId: 's1', similarity: 0.7 },
  ];
  const sourceMeta = new Map<string, SourceMeta>([
    ['s1', { id: 's1', title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' }],
    ['s2', { id: 's2', title: 'Source Two', domain: 'two.org', url: 'https://two.org/b' }],
  ]);

  it('assigns one citation number per distinct source', () => {
    const { sources } = numberSources(retrieved, sourceMeta);
    // s1 and s2 only — two distinct sources
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it('exposes title/domain/url on each numbered source', () => {
    const { sources } = numberSources(retrieved, sourceMeta);
    expect(sources[0]).toMatchObject({ n: 1, title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' });
  });

  it('caps each passage to PASSAGE_CAP characters', () => {
    const long = 'x'.repeat(PASSAGE_CAP + 500);
    const { passages } = numberSources(
      [{ id: 'r1', content: long, sourceId: 's1', similarity: 0.9 }],
      sourceMeta,
    );
    // Passage text body must not exceed the cap
    expect(passages).toContain('x'.repeat(PASSAGE_CAP));
    expect(passages).not.toContain('x'.repeat(PASSAGE_CAP + 1));
  });

  it('tags each passage with the [n] of its source', () => {
    const { passages } = numberSources(retrieved, sourceMeta);
    expect(passages).toContain('[1]');
    expect(passages).toContain('[2]');
  });
});

describe('buildChatPrompt', () => {
  const overview = 'OVERVIEW TEXT';
  const passages = '[1] (Source One)\nPassage one.';
  const sources = [{ n: 1, title: 'Source One', domain: 'one.gov.uk', url: 'https://one.gov.uk/a' }];

  it('system prompt instructs grounding and [n] citation', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('cite');
    expect(CHAT_SYSTEM).toContain('[n]');
  });

  it('user prompt embeds the topic, overview, passages and question', () => {
    const { user } = buildChatPrompt('Education policy', overview, passages, [], 'How is funding modelled?');
    expect(user).toContain('Education policy');
    expect(user).toContain('OVERVIEW TEXT');
    expect(user).toContain('Passage one.');
    expect(user).toContain('How is funding modelled?');
  });

  it('caps history to the most recent MAX_HISTORY_TURNS turns', () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${i}`,
    }));
    const { user } = buildChatPrompt('T', overview, passages, history, 'Q');
    // The oldest turn must have been dropped; the newest must be present.
    expect(user).not.toContain('turn-0');
    expect(user).toContain(`turn-${MAX_HISTORY_TURNS + 3}`);
  });

  it('returns the shared CHAT_SYSTEM as the system prompt', () => {
    const { system } = buildChatPrompt('T', overview, passages, [], 'Q');
    expect(system).toBe(CHAT_SYSTEM);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails (module does not exist yet).**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/chat-context.test.ts
```
Expected: failure to resolve `./chat-context` (cannot find module). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 3: Implement the pure helper.** Create `chat-context.ts` with the exact exports the test imports. No imports from DB/network — only the `ResearchReport` type.

```ts
// src/lib/deepdive/chat-context.ts
// Pure, network-free context assembly for POST /api/deepdive/[id]/chat.
// All DB / embedding / SQL work happens in the endpoint; this module only
// shapes already-fetched data into the system + user prompts and the citation
// list. Kept pure so it is fully unit-testable.
import type { ResearchReport } from './types';

/** Each retrieved fact carries enough to cite its source and rank it. */
export interface RetrievedFact {
  id: string;
  content: string;
  sourceId: string;
  similarity: number;
}

/** Resolved source metadata for [n] citations. */
export interface SourceMeta {
  id: string;
  title: string | null;
  domain: string | null;
  url: string | null;
}

/** A citation entry surfaced to the client in the `sources` SSE frame. */
export interface CitationSource {
  n: number;
  title: string | null;
  domain: string | null;
  url: string | null;
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface OverviewFact {
  id: string;
  content: string;
  confidence: number;
}

interface OverviewEntity {
  id: string;
  name: string;
  type: string;
}

// Tunables (also asserted by the tests so they stay honest).
export const PASSAGE_CAP = 1400;
export const MAX_HISTORY_TURNS = 6;
const MAX_OVERVIEW_FACTS = 8;
const MAX_OVERVIEW_CLUSTERS = 8;
const MAX_OVERVIEW_ENTITIES = 8;
const MAX_FALLBACK_FACTS = 10;

export const CHAT_SYSTEM = `You are the research assistant for a single Research Desk session. You answer ONLY from the CONTEXT supplied below — the session overview and the retrieved fact passages.

RULES:
1. Ground every factual claim in the OVERVIEW or the PASSAGES below. Do not use outside knowledge to assert facts. If the context does not cover the question, say so plainly ("this session's research doesn't cover that") rather than inventing an answer.
2. Cite the passages you use with their [n] markers inline (the numbers map to the sources listed for this session).
3. Be concise, neutral and precise. Distinguish what the research firmly establishes from what is uncertain or contested. Never overstate certainty.
4. Stay scoped to THIS session's topic and research. Politely decline unrelated requests in one sentence.
Never fabricate statistics, sources or quotes.`;

/**
 * Compact, pre-ranked overview drawn from the persisted ResearchReport:
 * executive summary + top ranked facts + cluster titles/summaries + top
 * entities by centrality. When the report is null/empty, fall back to the
 * highest-confidence facts supplied by the caller.
 */
export function buildOverview(
  report: ResearchReport | null,
  factsById: Map<string, OverviewFact>,
  entitiesById: Map<string, OverviewEntity>,
  fallbackFacts: OverviewFact[] = [],
): string {
  const lines: string[] = [];

  if (report && (report.executive_summary || report.ranked_facts?.length)) {
    if (report.executive_summary) {
      lines.push('SESSION SUMMARY:');
      lines.push(report.executive_summary.trim());
    }

    const ranked = (report.ranked_facts ?? []).slice(0, MAX_OVERVIEW_FACTS);
    const rankedLines = ranked
      .map((fid) => factsById.get(fid))
      .filter((f): f is OverviewFact => !!f)
      .map((f) => `  • ${f.content}`);
    if (rankedLines.length) {
      lines.push('', 'TOP-RANKED FACTS:', ...rankedLines);
    }

    const clusters = (report.clusters ?? []).slice(0, MAX_OVERVIEW_CLUSTERS);
    if (clusters.length) {
      lines.push('', 'THEMES (clusters):');
      for (const c of clusters) {
        lines.push(`  • ${c.title}${c.summary ? ` — ${c.summary}` : ''}`);
      }
    }

    const centrality = report.entity_centrality ?? {};
    const topEntities = Object.entries(centrality)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_OVERVIEW_ENTITIES)
      .map(([eid]) => entitiesById.get(eid))
      .filter((e): e is OverviewEntity => !!e);
    if (topEntities.length) {
      lines.push('', 'KEY ENTITIES:');
      for (const e of topEntities) lines.push(`  • ${e.name} (${e.type})`);
    }

    return lines.join('\n');
  }

  // Fallback: no report yet — surface the highest-confidence facts.
  lines.push('SESSION SUMMARY: (no synthesised report yet — using top-confidence facts)');
  const top = [...fallbackFacts].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_FALLBACK_FACTS);
  if (top.length) {
    lines.push('', 'TOP-CONFIDENCE FACTS:');
    for (const f of top) lines.push(`  • ${f.content}`);
  }
  return lines.join('\n');
}

/**
 * Number the retrieved facts' sources (one [n] per distinct source, in first-
 * appearance order), build the cited passage block (each passage capped to
 * PASSAGE_CAP chars and tagged with its source's [n]), and return both the
 * passage text and the citation list for the `sources` SSE frame.
 */
export function numberSources(
  retrieved: RetrievedFact[],
  sourceMeta: Map<string, SourceMeta>,
): { passages: string; sources: CitationSource[] } {
  const numberBySource = new Map<string, number>();
  const sources: CitationSource[] = [];

  for (const r of retrieved) {
    if (!numberBySource.has(r.sourceId)) {
      const n = numberBySource.size + 1;
      numberBySource.set(r.sourceId, n);
      const meta = sourceMeta.get(r.sourceId);
      sources.push({
        n,
        title: meta?.title ?? null,
        domain: meta?.domain ?? null,
        url: meta?.url ?? null,
      });
    }
  }

  const passages = retrieved
    .map((r) => {
      const n = numberBySource.get(r.sourceId)!;
      const meta = sourceMeta.get(r.sourceId);
      const label = meta?.title || meta?.domain || meta?.url || 'source';
      return `[${n}] (${label})\n${r.content.slice(0, PASSAGE_CAP)}`;
    })
    .join('\n\n');

  return { passages, sources };
}

/** Assemble the system + user prompts. History is capped to the last MAX_HISTORY_TURNS turns. */
export function buildChatPrompt(
  topic: string,
  overview: string,
  passages: string,
  history: HistoryTurn[],
  question: string,
): { system: string; user: string } {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const historyBlock = recent.length
    ? `\n\nRECENT CONVERSATION (for context):\n${recent
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n')}`
    : '';

  const passageBlock = passages.trim()
    ? `\n\nRETRIEVED PASSAGES (on-topic facts from this session — cite with [n]):\n\n${passages}`
    : '\n\nRETRIEVED PASSAGES: (none matched this question closely — rely on the overview)';

  const user = `SESSION TOPIC: ${topic}

SESSION OVERVIEW:
${overview}${passageBlock}${historyBlock}

QUESTION: ${question}

Answer using only the overview and passages above, citing [n] markers. If the session's research doesn't cover it, say so briefly.`;

  return { system: CHAT_SYSTEM, user };
}
```

- [ ] **Step 4: Run the test and confirm all pass.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive/chat-context.test.ts
```
Expected: all `chat-context.test.ts` suites pass (`buildOverview — from report`, `buildOverview — fallback`, `numberSources`, `buildChatPrompt`). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/chat-context.ts src/lib/deepdive/chat-context.test.ts && git commit -m "$(cat <<'EOF'
deepdive(chat): pure context-assembly + prompt-builder helper

Network-free module that builds the compact session overview from the
ResearchReport (exec summary + top ranked facts + cluster titles + top
entities by centrality, with a top-confidence-facts fallback), numbers
retrieved sources for [n] citations, caps passages and history, and
assembles the system + user prompts. Fully unit-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `POST /api/deepdive/[id]/chat` — streamed SSE-over-POST endpoint

The endpoint loads + 404-guards the session, embeds the question, runs the `similar-facts` pgvector query (top ~12 on-topic facts), resolves source metadata, builds the overview from `session.report` (or the fallback), assembles the prompts with the Task 2 helper, then streams a `sources` frame, `token` frames, and a `done` frame using `streamCompletion(..., { disableThinking:true, maxTokens:3072, signal:request.signal, onToken })`. SSE framing/headers mirror `src/routes/projects/policy-engine/chat/+server.ts`; the retrieval SQL mirrors `src/routes/api/deepdive/[id]/similar-facts/+server.ts`.

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/chat/+server.ts`

- [ ] **Step 1: Implement the endpoint.** Create the file. Key correctness points, all confirmed against the real code read: the question embedding goes through `generateEmbedding` (`ai.ts`); the vector literal uses `toVectorLiteral` (`$lib/deepdive/vector`); the SQL uses the real table name `fact` and column names (`session_id`, `is_counterfactual`, `source_id`) exactly as `similar-facts/+server.ts` does, with the same `1 - (embedding <=> ${vec}::vector)` cosine idiom and `> 0.5` threshold; `session.report` is jsonb (cast to `ResearchReport`); sources resolve `{title,domain,url}`; the `onToken` callback enqueues `token` frames; `request.signal` is wired into `streamCompletion`. The error frame matches the policy endpoint's `{ type:'error' }` shape so the existing `AskModel`-style reader handles it.

```ts
// src/routes/api/deepdive/[id]/chat/+server.ts
// POST /api/deepdive/[id]/chat — retrieval-grounded chat for a single Research
// Desk session. Streams SSE-over-POST: a `sources` frame, then `token` frames,
// then `done`. Mirrors projects/policy-engine/chat/+server.ts (transport) and
// reuses the similar-facts pgvector retrieval. All LLM I/O goes through the
// deepdive streamCompletion gateway (disableThinking to stop GLM reasoning
// starvation; keeps the OpenRouter 429 fallback + idle watchdog).
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { researchSessions, facts, sources, entities } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { streamCompletion, generateEmbedding } from '$lib/deepdive/ai';
import { toVectorLiteral } from '$lib/deepdive/vector';
import {
  buildOverview,
  numberSources,
  buildChatPrompt,
  type RetrievedFact,
  type SourceMeta,
  type HistoryTurn,
} from '$lib/deepdive/chat-context';
import type { ResearchReport } from '$lib/deepdive/types';

const RETRIEVAL_LIMIT = 12;

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw error(404, 'Session not found');

  const body = await request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const history: HistoryTurn[] = Array.isArray(body?.history)
    ? body.history
        .slice(-6)
        .map((m: any) => ({
          role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: String(m?.content ?? '').slice(0, 2000),
        }))
    : [];

  const report = (session.report ?? null) as ResearchReport | null;

  // --- Retrieval: embed the question, pull the top on-topic facts (pgvector cosine). ---
  let retrieved: RetrievedFact[] = [];
  try {
    const embedding = await generateEmbedding(question);
    const vectorStr = toVectorLiteral(embedding);
    const rows = await db.execute(
      sql`SELECT id, content, source_id, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM fact
          WHERE session_id = ${params.id}
            AND NOT is_counterfactual
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > 0.5
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${RETRIEVAL_LIMIT}`,
    );
    retrieved = (rows.rows as any[]).map((r) => ({
      id: String(r.id),
      content: String(r.content ?? ''),
      sourceId: String(r.source_id),
      similarity: Number(r.similarity ?? 0),
    }));
  } catch (e) {
    // Retrieval failure (e.g. embeddings unavailable) is non-fatal — the
    // overview alone still grounds an answer.
    console.error('[deepdive] chat retrieval failed:', e);
  }

  // --- Resolve source metadata for the [n] citations. ---
  const sourceIds = [...new Set(retrieved.map((r) => r.sourceId))];
  const sourceMeta = new Map<string, SourceMeta>();
  if (sourceIds.length) {
    const srcRows = await db
      .select({ id: sources.id, title: sources.title, domain: sources.domain, url: sources.url })
      .from(sources)
      .where(eq(sources.sessionId, params.id));
    for (const s of srcRows) {
      sourceMeta.set(s.id, { id: s.id, title: s.title, domain: s.domain, url: s.url });
    }
  }

  // --- Build the compact overview from the report (or the top-confidence fallback). ---
  const factsById = new Map<string, { id: string; content: string; confidence: number }>();
  const entitiesById = new Map<string, { id: string; name: string; type: string }>();
  let fallbackFacts: { id: string; content: string; confidence: number }[] = [];

  if (report?.executive_summary || report?.ranked_facts?.length) {
    const wantedFactIds = [...new Set((report.ranked_facts ?? []).slice(0, 8))];
    if (wantedFactIds.length) {
      const fr = await db
        .select({ id: facts.id, content: facts.content, confidence: facts.confidence })
        .from(facts)
        .where(eq(facts.sessionId, params.id));
      for (const f of fr) factsById.set(f.id, { id: f.id, content: f.content, confidence: f.confidence });
    }
    const wantedEntityIds = Object.keys(report.entity_centrality ?? {});
    if (wantedEntityIds.length) {
      const er = await db
        .select({ id: entities.id, name: entities.name, type: entities.type })
        .from(entities)
        .where(eq(entities.sessionId, params.id));
      for (const e of er) entitiesById.set(e.id, { id: e.id, name: e.name, type: e.type });
    }
  } else {
    // No report yet — load the top-confidence facts for the fallback overview.
    fallbackFacts = await db
      .select({ id: facts.id, content: facts.content, confidence: facts.confidence })
      .from(facts)
      .where(eq(facts.sessionId, params.id))
      .orderBy(sql`confidence DESC`)
      .limit(10);
  }

  const overview = buildOverview(report, factsById, entitiesById, fallbackFacts);
  const { passages, sources: citationSources } = numberSources(retrieved, sourceMeta);
  const { system, user } = buildChatPrompt(session.topic, overview, passages, history, question);

  // --- Stream SSE-over-POST. ---
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      send({ type: 'sources', sources: citationSources });
      try {
        const { text } = await streamCompletion(system, user, {
          disableThinking: true,
          maxTokens: 3072,
          temperature: 0.3,
          signal: request.signal,
          onToken: (token) => send({ type: 'token', token }),
        });
        if (!text.trim()) {
          send({ type: 'token', token: 'Sorry — I could not generate an answer for that. Try rephrasing.' });
        }
        send({ type: 'done' });
      } catch (e: any) {
        send({ type: 'error', message: String(e?.message ?? 'generation failed').slice(0, 120) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
```

- [ ] **Step 2: Type-check the new route.** This catches drift in the imported helper types, the Drizzle column names, and the SvelteKit `RequestHandler` shape before any runtime test.

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "chat/\+server\.ts|chat-context\.ts|deepdive/ai\.ts" || echo "no errors in chat endpoint / helper / ai"
```
Expected: `no errors in chat endpoint / helper / ai` (the grep finds no error lines referencing those files). svelte-check may report pre-existing errors elsewhere in the repo — those are out of scope; only the grep-filtered lines matter. Retry with `dangerouslyDisableSandbox: true` on EPERM; svelte-check OOMs without the `NODE_OPTIONS` setting.

- [ ] **Step 3: Manual verification against a real session (dev server).** This confirms the three-frame SSE contract over the wire end-to-end. The dev server runs on homeserv; reach it at `http://homeserv:5173`.

First, start (or confirm) the dev server and pick a real completed session id:
```bash
cd /home/john/strange_rambling_svelte && (curl -s http://homeserv:5173/ >/dev/null 2>&1 && echo "dev server up") || echo "start dev server: npm run dev"
```

Get a session id that has facts (any `complete` session works):
```bash
PGPASSWORD="$(grep -oP '(?<=postgres://[^:]+:)[^@]+' .env 2>/dev/null | head -1)" psql "$(grep -oP '(?<=DATABASE_URL=).*' .env | head -1 | tr -d '"')" -tAc "SELECT id FROM research_session WHERE status='complete' ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || echo "look up a session id via pgweb at http://homeserv:8085/pgweb/"
```

Then hit the endpoint and confirm the SSE frame sequence:
```bash
curl -sN -X POST "http://homeserv:5173/api/deepdive/<SESSION_ID>/chat" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What are the main findings of this research?"}' | head -40
```
Expected output: the FIRST line is `data: {"type":"sources","sources":[...]}` (an array of `{n,title,domain,url}` objects, possibly empty if the session has no embeddings); then a run of `data: {"type":"token","token":"..."}` lines forming a grounded answer that references `[n]` markers; then a final `data: {"type":"done"}`. A `data: {"type":"error",...}` line in place of tokens indicates a misconfigured key or DB issue — investigate before proceeding. Retry curl with `dangerouslyDisableSandbox: true` if the Bash sandbox blocks the network call.

- [ ] **Step 4: Verify 404 + empty-question guards.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://homeserv:5173/api/deepdive/does-not-exist/chat" -H 'Content-Type: application/json' -d '{"question":"hi"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://homeserv:5173/api/deepdive/<SESSION_ID>/chat" -H 'Content-Type: application/json' -d '{"question":"   "}'
```
Expected: `404` for the unknown session; `400` for the empty/whitespace question.

- [ ] **Step 5: Run the full deepdive test suite to confirm no regressions.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lib/deepdive
```
Expected: all deepdive suites green, including `ai.test.ts` and `chat-context.test.ts`. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 6: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/routes/api/deepdive/\[id\]/chat/+server.ts && git commit -m "$(cat <<'EOF'
deepdive(api): POST /api/deepdive/[id]/chat streamed, grounded chat

SSE-over-POST endpoint mirroring the policy-engine chat transport. Loads
and 404-guards the session, embeds the question, runs the similar-facts
pgvector retrieval (top 12 on-topic facts), resolves source metadata for
[n] citations, builds the compact overview from session.report (top-
confidence-facts fallback), and assembles prompts via the pure
chat-context helper. Streams sources -> token* -> done via
streamCompletion({ disableThinking:true, maxTokens:3072, signal }), which
keeps the OpenRouter 429 fallback + idle watchdog. Retrieval failure is
non-fatal (overview-only answer).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```


I have everything needed. The data endpoint already imports `entityMentions` (a sibling milestone adds it to the payload). The relationships carry `sentiment` and `fromEntityId`/`toEntityId` — these become `DeskEdge` fields (`fromEntityId`/`toEntityId`/`sentiment`). The `entities[].type` field is in `fields.type` on entity cards.

Now I have all the verified facts to draft the milestone. Key contract anchors confirmed:
- `themeOf(card: ThemeArtefact): ThemeKey` — reusable for the `theme` dimension; `ThemeArtefact = {id, kind, fields?}`.
- `DeskCard = {id, kind, fields, ...}`; entity type at `fields.type`; fact counterfactual at `fields.isCounterfactual`.
- `DeskEdge = {id, fromEntityId, toEntityId, relationshipType?, sentiment?}`.
- `deskCategory` lives on the card (set by synthesis-reducer as `deskCategory`); cards from the store carry `deskCategory?: string | null`.
- `entityMentions` shape per contract: `{entityId, factId}[]`.
- `similarityMap`: `factId → clusterId` (from the clusters endpoint, which returns `{factId, clusterId, clusterLabel}`).
- `snap`, `GRID`, `Pos` exported from `layout.ts`.

Here is the milestone.

---

## Milestone 4: grouping.ts + pileLayout (pure logic)

This milestone is **pure logic only** — no Svelte, no DB, no network. It produces two tested modules that later milestones consume:

1. `src/lib/canvas/intelligence/desk/grouping.ts` — `groupBy(dim, cards, edges, mentions, similarityMap)` over the six `GroupDim` axes, returning `{ memberOf, groups }`.
2. New `pileLayout()` added to `src/lib/canvas/intelligence/desk/layout.ts` — fanned pile anchors with collapsed/expanded behaviour, replacing the `organisedLayout`/`themeLayout` callsites in a later milestone (this milestone only adds it; it does not delete the old functions).

**Verified facts the implementer must rely on (re-confirmed against current code):**
- `themes.ts` exports `themeOf(card: ThemeArtefact): ThemeKey` and `THEMES` (`{key,label}[]`). `ThemeArtefact = { id: string; kind: string; fields?: Record<string,unknown> }`. `themeOf` reads `fields.domain` (sources), `fields.isCounterfactual` (facts), `fields.type` (entities). Reuse it verbatim for the `theme` dimension.
- `layout.ts` exports `snap(v)`, `GRID` (=20), and `interface Pos { x; y }`. Reuse them.
- The card shape passed in is the store's `DeskCard`: `{ id, kind: 'source'|'fact'|'entity', fields: Record<string,unknown>, deskCategory?: string|null, ... }`. Entity type is at `fields.type`. Fact counterfactual flag is at `fields.isCounterfactual`.
- The edge shape is the store's `DeskEdge`: `{ id, fromEntityId, toEntityId, relationshipType?: string|null, sentiment?: string|null }`.
- `entityMentions` (added to `/data` in a sibling milestone) is `{ entityId: string; factId: string }[]`.
- `similarityMap` is `Map<string,string>` mapping `factId → clusterId` (built by the caller from the `clusters` endpoint's `{factId,clusterId,clusterLabel}[]`).
- Tests are co-located `*.test.ts`, Vitest, run via `npm run test`. A single file is targeted with `npm run test -- <path>`.

---

### Task 1: grouping.ts — types + `cluster`/`theme`/`entityType` dimensions (card-field axes)

**Files:**
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`

- [ ] **Step 1: Write the failing tests for the card-field dimensions first.**

Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts` with the test fixtures and the three card-field-axis suites. (Sentiment, cooccurrence, similarity suites are appended in later tasks — keep this file additive.)

```ts
import { describe, it, expect } from 'vitest';
import {
  groupBy,
  type GroupDim,
  type GroupCard,
  type GroupEdge,
  type EntityMention,
} from './grouping';

// ——— fixtures ———

function src(id: string, fields: Record<string, unknown> = {}): GroupCard {
  return { id, kind: 'source', fields };
}
function fact(id: string, fields: Record<string, unknown> = {}): GroupCard {
  return { id, kind: 'fact', fields };
}
function entity(id: string, type: string): GroupCard {
  return { id, kind: 'entity', fields: { type } };
}
function withCat(c: GroupCard, deskCategory: string | null): GroupCard {
  return { ...c, deskCategory };
}
function edge(
  id: string,
  fromEntityId: string,
  toEntityId: string,
  sentiment: string | null = null,
): GroupEdge {
  return { id, fromEntityId, toEntityId, sentiment };
}

const NO_EDGES: GroupEdge[] = [];
const NO_MENTIONS: EntityMention[] = [];
const NO_SIM = new Map<string, string>();

describe('groupBy — common contract', () => {
  it('returns a memberOf entry for every card and groups with summed counts', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.size).toBe(3);
    for (const c of cards) expect(memberOf.has(c.id)).toBe(true);
    // counts in groups sum to (the number of cards that landed in a group)
    const total = groups.reduce((n, g) => n + g.count, 0);
    expect(total).toBe(3);
  });

  it('is deterministic — same inputs produce identical memberOf + groups', () => {
    const cards = [withCat(fact('f1'), 'cat-a'), withCat(fact('f2'), 'cat-b')];
    const a = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    const b = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });

  it('handles an empty card list', () => {
    const { memberOf, groups } = groupBy('cluster', [], NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.size).toBe(0);
    expect(groups).toEqual([]);
  });

  it('group counts equal the number of memberOf entries pointing at each key', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    for (const g of groups) {
      const members = [...memberOf.values()].filter((k) => k === g.key).length;
      expect(g.count).toBe(members);
    }
  });
});

describe('groupBy — cluster (deskCategory)', () => {
  it('groups cards by deskCategory; same category → same group key', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    expect(memberOf.get('f1')).not.toBe(memberOf.get('f3'));
    expect(groups.find((g) => g.key === memberOf.get('f1'))!.count).toBe(2);
  });

  it('routes null/undefined deskCategory into a stable "uncategorised" group', () => {
    const cards = [withCat(fact('f1'), null), { ...fact('f2') }];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    const g = groups.find((x) => x.key === memberOf.get('f1'))!;
    expect(g.count).toBe(2);
    expect(g.label.toLowerCase()).toContain('uncategor');
  });

  it('orders groups by descending count then key (stable)', () => {
    const cards = [
      withCat(fact('f1'), 'cat-b'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-a'),
    ];
    const { groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(groups[0].key).toBe('cat-a'); // count 2 first
    expect(groups[0].count).toBe(2);
    expect(groups[1].key).toBe('cat-b');
  });
});

describe('groupBy — theme (reuses themeOf)', () => {
  it('buckets by KIND/type theme', () => {
    const cards = [
      src('s1', { domain: 'example.com' }), // sites
      src('s2', { domain: 'youtube.com' }), // videos
      fact('f1', { isCounterfactual: false }), // facts
      fact('f2', { isCounterfactual: true }), // challenges
      entity('p1', 'person'), // people
    ];
    const { memberOf, groups } = groupBy('theme', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('s1')).toBe('sites');
    expect(memberOf.get('s2')).toBe('videos');
    expect(memberOf.get('f1')).toBe('facts');
    expect(memberOf.get('f2')).toBe('challenges');
    expect(memberOf.get('p1')).toBe('people');
    // labels are the human THEMES labels
    expect(groups.find((g) => g.key === 'sites')!.label).toBe('Sites');
    expect(groups.find((g) => g.key === 'facts')!.label).toBe('Facts');
  });

  it('two facts share the facts theme', () => {
    const cards = [fact('f1'), fact('f2')];
    const { memberOf } = groupBy('theme', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
  });
});

describe('groupBy — entityType', () => {
  it('groups entities by their type field; non-entities fall into a non-entity group', () => {
    const cards = [
      entity('e1', 'person'),
      entity('e2', 'person'),
      entity('e3', 'organisation'),
      fact('f1'),
    ];
    const { memberOf, groups } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e3'));
    // non-entity cards are kept (so memberOf covers every card) in a dedicated bucket
    expect(memberOf.has('f1')).toBe(true);
    expect(memberOf.get('f1')).not.toBe(memberOf.get('e1'));
    expect(groups.find((g) => g.key === memberOf.get('e1'))!.count).toBe(2);
  });

  it('normalises entity type casing/whitespace into one group', () => {
    const cards = [entity('e1', 'Person'), entity('e2', ' person ')];
    const { memberOf } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
  });

  it('routes an entity with a missing type into an "other" entity group', () => {
    const cards = [{ id: 'e1', kind: 'entity' as const, fields: {} }];
    const { memberOf, groups } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.has('e1')).toBe(true);
    expect(groups.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail because the module does not exist.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts
```

Expected output: failure with a module-resolution error, e.g. `Failed to resolve import "./grouping"` / `Cannot find module './grouping'`. (If a Bash command fails with EPERM/permission, retry the same command with `dangerouslyDisableSandbox: true`.)

- [ ] **Step 3: Implement `grouping.ts` with the card-field dimensions (the sentiment/cooccurrence/similarity branches return a stub for now, filled in Tasks 2-4).**

Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`:

```ts
// src/lib/canvas/intelligence/desk/grouping.ts
//
// Pure multi-dimension grouping for the Research Desk's "synthesize" pile view.
//
// groupBy(dim, cards, edges, mentions, similarityMap) maps every card to a
// group KEY (memberOf) and returns the ordered set of non-empty groups
// (groups[], descending count then key for stable left→right pile placement).
//
// All six GroupDim axes are pure functions of their inputs:
//   cluster      — card.deskCategory (synthesis cluster id)
//   theme        — themeOf() (KIND/type)        [reuses ./themes]
//   entityType   — entities by fields.type; non-entities bucketed separately
//   sentiment    — facts/entities bucketed by the sentiment of relationships
//                  they participate in (relationships carry the only sentiment)
//   cooccurrence — entities/facts sharing ≥1 factId via entityMentions
//   similarity   — factId→clusterId from the server clusters endpoint (passed in)
//
// No global mutable state, no Date/Math.random — deterministic for reloads.

import { themeOf, THEMES, type ThemeArtefact } from './themes';

/** The six grouping axes the floating filter selector offers. */
export type GroupDim =
  | 'cluster'
  | 'theme'
  | 'entityType'
  | 'sentiment'
  | 'cooccurrence'
  | 'similarity';

/** Minimal card slice grouping consumes — a structural subset of DeskCard. */
export interface GroupCard {
  id: string;
  kind: string; // 'source' | 'fact' | 'entity'
  fields?: Record<string, unknown>;
  deskCategory?: string | null;
}

/** Minimal edge slice — a structural subset of DeskEdge. */
export interface GroupEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  sentiment?: string | null;
}

/** An entity↔fact mention (added to /data for co-occurrence). */
export interface EntityMention {
  entityId: string;
  factId: string;
}

/** One pile/group header descriptor. */
export interface Group {
  key: string;
  label: string;
  count: number;
}

/** Result of grouping: card id → group key, plus ordered non-empty groups. */
export interface GroupResult {
  memberOf: Map<string, string>;
  groups: Group[];
}

// ——— shared stable keys/labels ———

/** Group key for cards with no deskCategory. */
export const UNCATEGORISED_KEY = '__uncategorised__';
/** Group key for non-entity cards under the entityType axis. */
export const NON_ENTITY_KEY = '__non_entity__';
/** Group key for an entity with a missing/blank type. */
export const ENTITY_OTHER_KEY = '__entity_other__';
/** Group key for a card not touched by any relationship (sentiment axis). */
export const NO_SENTIMENT_KEY = '__no_sentiment__';
/** Group key for a card in no co-occurrence component (cooccurrence axis). */
export const ISOLATED_KEY = '__isolated__';
/** Group key for a fact absent from the similarity map. */
export const SIM_UNCLUSTERED_KEY = '__unclustered__';

const THEME_LABEL = new Map(THEMES.map((t) => [t.key as string, t.label]));

/** Normalise an entity `type` to a stable lowercase key; '' → ENTITY_OTHER_KEY. */
function entityTypeKey(type: unknown): string {
  const t = typeof type === 'string' ? type.toLowerCase().trim() : '';
  return t.length === 0 ? ENTITY_OTHER_KEY : t;
}

/** Title-case a raw key for display (e.g. 'organisation' → 'Organisation'). */
function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Assemble the ordered groups[] from a memberOf map and a per-key label
 * resolver. Groups are ordered by DESCENDING count, then ASCENDING key, so the
 * order is total and deterministic (the pile packer reads it left→right).
 */
function buildGroups(
  memberOf: Map<string, string>,
  labelOf: (key: string) => string,
): Group[] {
  const counts = new Map<string, number>();
  for (const key of memberOf.values()) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups: Group[] = [];
  for (const [key, count] of counts) {
    groups.push({ key, label: labelOf(key), count });
  }
  groups.sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return groups;
}

// ——— per-dimension memberOf builders ———

function groupByCluster(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const cat = c.deskCategory;
    memberOf.set(c.id, cat != null && cat.length > 0 ? cat : UNCATEGORISED_KEY);
  }
  const groups = buildGroups(memberOf, (key) =>
    key === UNCATEGORISED_KEY ? 'Uncategorised' : key,
  );
  return { memberOf, groups };
}

function groupByTheme(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const artefact: ThemeArtefact = { id: c.id, kind: c.kind, fields: c.fields };
    memberOf.set(c.id, themeOf(artefact));
  }
  const groups = buildGroups(memberOf, (key) => THEME_LABEL.get(key) ?? titleCase(key));
  return { memberOf, groups };
}

function groupByEntityType(cards: GroupCard[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    if (c.kind === 'entity') {
      memberOf.set(c.id, entityTypeKey(c.fields?.type));
    } else {
      memberOf.set(c.id, NON_ENTITY_KEY);
    }
  }
  const groups = buildGroups(memberOf, (key) =>
    key === NON_ENTITY_KEY
      ? 'Other artefacts'
      : key === ENTITY_OTHER_KEY
        ? 'Other entities'
        : titleCase(key),
  );
  return { memberOf, groups };
}

/**
 * Group cards along one of six dimensions.
 *
 * Every card receives a group key (memberOf covers all input ids); groups[]
 * lists the non-empty groups in descending-count, then ascending-key order.
 * Pure + deterministic.
 */
export function groupBy(
  dim: GroupDim,
  cards: GroupCard[],
  edges: GroupEdge[],
  mentions: EntityMention[],
  similarityMap: Map<string, string>,
): GroupResult {
  switch (dim) {
    case 'cluster':
      return groupByCluster(cards);
    case 'theme':
      return groupByTheme(cards);
    case 'entityType':
      return groupByEntityType(cards);
    case 'sentiment':
      return groupBySentiment(cards, edges);
    case 'cooccurrence':
      return groupByCooccurrence(cards, mentions);
    case 'similarity':
      return groupBySimilarity(cards, similarityMap);
    default: {
      // Exhaustiveness guard — every GroupDim must be handled above.
      const _never: never = dim;
      return { memberOf: new Map(), groups: [] };
    }
  }
}
```

The `sentiment`, `cooccurrence`, and `similarity` branches reference functions defined in Tasks 2-4. To make this task compile and its tests pass in isolation, add **temporary stub implementations** at the bottom of the file (these are REPLACED with real implementations in the next tasks — keep the function names identical):

```ts
// ——— TEMPORARY STUBS (replaced in Tasks 2-4) ———
function groupBySentiment(cards: GroupCard[], _edges: GroupEdge[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) memberOf.set(c.id, NO_SENTIMENT_KEY);
  return { memberOf, groups: buildGroups(memberOf, () => 'No sentiment') };
}
function groupByCooccurrence(cards: GroupCard[], _mentions: EntityMention[]): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) memberOf.set(c.id, ISOLATED_KEY);
  return { memberOf, groups: buildGroups(memberOf, () => 'Isolated') };
}
function groupBySimilarity(cards: GroupCard[], _sim: Map<string, string>): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) memberOf.set(c.id, SIM_UNCLUSTERED_KEY);
  return { memberOf, groups: buildGroups(memberOf, () => 'Unclustered') };
}
```

- [ ] **Step 4: Re-run the grouping tests and confirm the card-field suites pass.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts
```

Expected output: all `groupBy — common contract`, `cluster`, `theme`, and `entityType` tests pass (green). The sentiment/cooccurrence/similarity suites do not exist yet, so the run is fully green.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/grouping.ts src/lib/canvas/intelligence/desk/grouping.test.ts
git commit -m "$(cat <<'EOF'
desk grouping: groupBy types + cluster/theme/entityType dimensions

Pure groupBy(dim, cards, edges, mentions, similarityMap) → {memberOf, groups}.
Card-field axes (cluster=deskCategory, theme=themeOf, entityType=fields.type)
implemented + exhaustively tested. sentiment/cooccurrence/similarity stubbed,
filled in following tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: grouping.ts — `sentiment` dimension (bucket cards by relationship sentiment)

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`

Semantics (per SHARED CONTRACT — `sentiment=bucket edges by relationships.sentiment`): relationships are the only sentiment we store, per entity-pair. A card (entity or fact) is bucketed by the sentiment of the relationship(s) it participates in. Entities participate via `fromEntityId`/`toEntityId`. A card touched by relationships of differing sentiments goes into a deterministic **"mixed"** bucket. A card touched by no relationship goes into `NO_SENTIMENT_KEY`.

- [ ] **Step 1: Append the failing sentiment test suite to `grouping.test.ts`.**

Add at the end of `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`:

```ts
describe('groupBy — sentiment (relationship sentiment)', () => {
  it('buckets an entity by the sentiment of the relationship it participates in', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).toContain('positive');
  });

  it('separates entities by differing relationship sentiment', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), entity('e3', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive'), edge('r2', 'e3', 'e2', 'negative')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    // e2 is in BOTH a positive and a negative relationship → mixed
    expect(memberOf.get('e2')).toContain('mixed');
    expect(memberOf.get('e1')).toContain('positive');
    expect(memberOf.get('e3')).toContain('negative');
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e3'));
  });

  it('places a card touched by no relationship into the no-sentiment bucket', () => {
    const cards = [entity('lonely', 'person'), fact('f1')];
    const edges = [edge('r1', 'a', 'b', 'positive')]; // touches neither card
    const { memberOf, groups } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('lonely')).toBe(memberOf.get('f1'));
    const g = groups.find((x) => x.key === memberOf.get('lonely'))!;
    expect(g.count).toBe(2);
    expect(g.label.toLowerCase()).toContain('no sentiment');
  });

  it('treats a null/blank relationship sentiment as "neutral"', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', null)];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toContain('neutral');
  });

  it('normalises sentiment casing (POSITIVE == positive)', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), entity('e3', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'POSITIVE'), edge('r2', 'e3', 'e2', 'positive')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    // e1 (POSITIVE) and e3 (positive) share the positive sentiment, both via e2;
    // e2 sees only positive → not mixed.
    expect(memberOf.get('e2')).toContain('positive');
    expect(memberOf.get('e2')).not.toContain('mixed');
  });

  it('is deterministic for the same inputs', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive')];
    const a = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    const b = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
  });
});
```

- [ ] **Step 2: Run the sentiment suite and confirm it fails against the stub.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts -t "sentiment"
```

Expected output: the `groupBy — sentiment` tests FAIL (the stub routes everything to `NO_SENTIMENT_KEY`, so e.g. the "buckets an entity by ... positive" assertion `expect(...).toContain('positive')` fails).

- [ ] **Step 3: Replace the `groupBySentiment` stub with the real implementation.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`, delete the temporary `groupBySentiment` stub and replace it with:

```ts
// ——— sentiment ———
//
// Relationships carry the only sentiment we store (per entity-pair). A card is
// bucketed by the sentiment(s) of the relationships it participates in:
//   - an ENTITY participates via from/toEntityId
//   - a card touched by relationships of ONE sentiment → that sentiment bucket
//   - a card touched by relationships of DIFFERING sentiments → "mixed"
//   - a card touched by NO relationship → NO_SENTIMENT_KEY
// null/blank relationship sentiment is normalised to "neutral".

const SENTIMENT_PREFIX = 'sentiment:';
const MIXED_SENTIMENT = `${SENTIMENT_PREFIX}mixed`;

function normaliseSentiment(s: unknown): string {
  const v = typeof s === 'string' ? s.toLowerCase().trim() : '';
  return v.length === 0 ? 'neutral' : v;
}

function groupBySentiment(cards: GroupCard[], edges: GroupEdge[]): GroupResult {
  // Collect the set of distinct sentiments each card id participates in.
  const seen = new Map<string, Set<string>>();
  const note = (id: string, sentiment: string) => {
    let s = seen.get(id);
    if (!s) {
      s = new Set<string>();
      seen.set(id, s);
    }
    s.add(sentiment);
  };
  for (const e of edges) {
    const sentiment = normaliseSentiment(e.sentiment);
    note(e.fromEntityId, sentiment);
    note(e.toEntityId, sentiment);
  }

  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const s = seen.get(c.id);
    if (!s || s.size === 0) {
      memberOf.set(c.id, NO_SENTIMENT_KEY);
    } else if (s.size === 1) {
      memberOf.set(c.id, SENTIMENT_PREFIX + [...s][0]);
    } else {
      memberOf.set(c.id, MIXED_SENTIMENT);
    }
  }

  const groups = buildGroups(memberOf, (key) => {
    if (key === NO_SENTIMENT_KEY) return 'No sentiment';
    if (key === MIXED_SENTIMENT) return 'Mixed sentiment';
    return titleCase(key.slice(SENTIMENT_PREFIX.length)) + ' (relationship)';
  });
  return { memberOf, groups };
}
```

- [ ] **Step 4: Re-run the full grouping test file and confirm green.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts
```

Expected output: all suites pass, including `groupBy — sentiment`. The cooccurrence/similarity stubs still pass their (not-yet-written) absence.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/grouping.ts src/lib/canvas/intelligence/desk/grouping.test.ts
git commit -m "$(cat <<'EOF'
desk grouping: sentiment dimension

Bucket cards by the sentiment of the relationships they participate in;
single-sentiment → that bucket, differing → mixed, untouched → no-sentiment,
null/blank → neutral. Case-normalised, deterministic, tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: grouping.ts — `cooccurrence` dimension (connected components over shared facts)

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`

Semantics (per SHARED CONTRACT — `cooccurrence=entities/facts sharing a factId via entityMentions`): build a bipartite graph from `entityMentions` (`{entityId, factId}`). Entities and facts that are connected (directly or transitively through shared facts) form one co-occurrence component. Each connected component is a group; its key is the **smallest member id** in the component (deterministic, independent of input order). Cards not present in any mention go to `ISOLATED_KEY`.

- [ ] **Step 1: Append the failing cooccurrence test suite.**

Add at the end of `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`:

```ts
function mention(entityId: string, factId: string): EntityMention {
  return { entityId, factId };
}

describe('groupBy — cooccurrence (shared-fact components)', () => {
  it('puts two entities that share a fact into the same component', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), fact('f1')];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f1')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).toBe(memberOf.get('f1')); // the fact joins too
  });

  it('merges components transitively through a shared entity', () => {
    // e1—f1, e1—f2  ⇒ f1 and f2 join via e1
    const cards = [entity('e1', 'person'), fact('f1'), fact('f2')];
    const mentions = [mention('e1', 'f1'), mention('e1', 'f2')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    expect(memberOf.get('f1')).toBe(memberOf.get('e1'));
  });

  it('keeps disjoint mention sets in separate components', () => {
    const cards = [
      entity('e1', 'person'), fact('f1'),
      entity('e2', 'person'), fact('f2'),
    ];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f2')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('f1'));
    expect(memberOf.get('e2')).toBe(memberOf.get('f2'));
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e2'));
  });

  it('routes a card not present in any mention to the isolated bucket', () => {
    const cards = [entity('e1', 'person'), fact('f1'), entity('lonely', 'person')];
    const mentions = [mention('e1', 'f1')];
    const { memberOf, groups } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('lonely')).toBe(ISOLATED_KEY);
    expect(groups.find((g) => g.key === ISOLATED_KEY)!.count).toBe(1);
  });

  it('uses the smallest member id as the component key (order-independent)', () => {
    const cardsA = [entity('e2', 'person'), entity('e1', 'person'), fact('f1')];
    const cardsB = [fact('f1'), entity('e1', 'person'), entity('e2', 'person')];
    const m = [mention('e1', 'f1'), mention('e2', 'f1')];
    const a = groupBy('cooccurrence', cardsA, NO_EDGES, m, NO_SIM);
    const b = groupBy('cooccurrence', cardsB, NO_EDGES, m, NO_SIM);
    // Same component key regardless of card-array order.
    expect(a.memberOf.get('e1')).toBe(b.memberOf.get('e1'));
    // Key is the lexicographically-smallest id in the component.
    const key = a.memberOf.get('e1')!;
    expect(['e1', 'e2', 'f1'].includes(key)).toBe(true);
    expect(key).toBe('e1'); // 'e1' < 'e2' < 'f1'
  });

  it('ignores mentions whose ids are not loaded as cards', () => {
    // Mention references a fact not in cards; e1 still becomes its own component
    // (a singleton, since its only partner is absent).
    const cards = [entity('e1', 'person')];
    const mentions = [mention('e1', 'ghost-fact')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.has('e1')).toBe(true);
    // e1's only connection is to a non-card; it is effectively isolated.
    expect(memberOf.get('e1')).toBe(ISOLATED_KEY);
  });

  it('is deterministic', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), fact('f1')];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f1')];
    const a = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    const b = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });
});
```

Also add `ISOLATED_KEY` to the test file's import block. Edit the import at the top of `grouping.test.ts`:

```ts
import {
  groupBy,
  ISOLATED_KEY,
  type GroupDim,
  type GroupCard,
  type GroupEdge,
  type EntityMention,
} from './grouping';
```

- [ ] **Step 2: Run the cooccurrence suite and confirm it fails against the stub.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts -t "cooccurrence"
```

Expected output: the `groupBy — cooccurrence` tests FAIL (the stub routes everything to `ISOLATED_KEY`, so the "same component" assertions like `expect(memberOf.get('e1')).toBe(memberOf.get('f1'))` fail because both equal `ISOLATED_KEY` only by accident for connected nodes — the "different components" and "smallest member id" assertions fail outright).

- [ ] **Step 3: Replace the `groupByCooccurrence` stub with a real union-find implementation.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`, delete the temporary `groupByCooccurrence` stub and replace it with:

```ts
// ——— cooccurrence ———
//
// Bipartite graph: entityMentions link an entity to a fact. Entities/facts that
// are connected (transitively, through shared facts/entities) form one
// co-occurrence component. Only ids that are LOADED as cards participate; a
// mention to an absent id is ignored. A card in no component (or whose only
// links are to absent ids) → ISOLATED_KEY. Each component's group key is the
// lexicographically-smallest member id, so the key is order-independent.

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Attach the lexicographically-larger root under the smaller, so find()
    // converges toward the smallest id (deterministic component keys).
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function groupByCooccurrence(cards: GroupCard[], mentions: EntityMention[]): GroupResult {
  const present = new Set(cards.map((c) => c.id));
  const uf = new UnionFind();
  // Only union pairs where BOTH ids are loaded cards.
  const touched = new Set<string>();
  for (const m of mentions) {
    if (!present.has(m.entityId) || !present.has(m.factId)) continue;
    uf.add(m.entityId);
    uf.add(m.factId);
    uf.union(m.entityId, m.factId);
    touched.add(m.entityId);
    touched.add(m.factId);
  }

  // Resolve component roots; the root IS the smallest id by union policy.
  const rootOf = new Map<string, string>();
  for (const id of touched) rootOf.set(id, uf.find(id));

  // A singleton (touched only via absent partners) is effectively isolated.
  const componentSize = new Map<string, number>();
  for (const root of rootOf.values()) {
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  }

  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const root = rootOf.get(c.id);
    if (root !== undefined && (componentSize.get(root) ?? 0) > 1) {
      memberOf.set(c.id, root);
    } else {
      memberOf.set(c.id, ISOLATED_KEY);
    }
  }

  const groups = buildGroups(memberOf, (key) =>
    key === ISOLATED_KEY ? 'Isolated' : `Cluster ${key}`,
  );
  return { memberOf, groups };
}
```

- [ ] **Step 4: Re-run the full grouping test file and confirm green.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts
```

Expected output: all suites pass, including `groupBy — cooccurrence`. (The "ignores mentions whose ids are not loaded" case lands `e1` in `ISOLATED_KEY` because its only partner `ghost-fact` is absent — the `componentSize > 1` guard handles this.)

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/grouping.ts src/lib/canvas/intelligence/desk/grouping.test.ts
git commit -m "$(cat <<'EOF'
desk grouping: cooccurrence dimension

Union-find over entityMentions: entities/facts sharing a fact (transitively)
form components keyed on the smallest member id (order-independent). Mentions
to unloaded ids ignored; singletons → isolated. Tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: grouping.ts — `similarity` dimension (from the passed similarity map)

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`

Semantics (per SHARED CONTRACT — `similarity=from similarityMap (factId->clusterId from the clusters endpoint)`): `similarityMap` maps a card id (the clusters endpoint keys on `factId`) to its `clusterId`. A card present in the map joins its cluster group; a card absent from the map goes to `SIM_UNCLUSTERED_KEY`. Group keys are the cluster ids; labels derive from the cluster id (the endpoint's `clusterLabel` is applied at render time, not here — this module sees only `factId → clusterId`).

- [ ] **Step 1: Append the failing similarity test suite.**

Add `SIM_UNCLUSTERED_KEY` to the test import block (extend the existing import in `grouping.test.ts`):

```ts
import {
  groupBy,
  ISOLATED_KEY,
  SIM_UNCLUSTERED_KEY,
  type GroupDim,
  type GroupCard,
  type GroupEdge,
  type EntityMention,
} from './grouping';
```

Then append at the end of `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.test.ts`:

```ts
describe('groupBy — similarity (server cluster map)', () => {
  it('groups facts by their clusterId from the similarity map', () => {
    const cards = [fact('f1'), fact('f2'), fact('f3')];
    const sim = new Map<string, string>([
      ['f1', 'sc-0'],
      ['f2', 'sc-0'],
      ['f3', 'sc-1'],
    ]);
    const { memberOf } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(memberOf.get('f1')).toBe('sc-0');
    expect(memberOf.get('f2')).toBe('sc-0');
    expect(memberOf.get('f3')).toBe('sc-1');
    expect(memberOf.get('f1')).not.toBe(memberOf.get('f3'));
  });

  it('routes a card absent from the map into the unclustered bucket', () => {
    const cards = [fact('f1'), fact('f2')];
    const sim = new Map<string, string>([['f1', 'sc-0']]);
    const { memberOf, groups } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(memberOf.get('f1')).toBe('sc-0');
    expect(memberOf.get('f2')).toBe(SIM_UNCLUSTERED_KEY);
    expect(groups.find((g) => g.key === SIM_UNCLUSTERED_KEY)!.count).toBe(1);
  });

  it('counts members per cluster correctly and orders by descending count', () => {
    const cards = [fact('f1'), fact('f2'), fact('f3'), fact('f4')];
    const sim = new Map<string, string>([
      ['f1', 'sc-0'],
      ['f2', 'sc-0'],
      ['f3', 'sc-0'],
      ['f4', 'sc-1'],
    ]);
    const { groups } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(groups[0].key).toBe('sc-0');
    expect(groups[0].count).toBe(3);
    expect(groups[1].key).toBe('sc-1');
  });

  it('with an empty map, every card is unclustered (single group)', () => {
    const cards = [fact('f1'), fact('f2')];
    const { memberOf, groups } = groupBy(
      'similarity', cards, NO_EDGES, NO_MENTIONS, new Map(),
    );
    expect(memberOf.get('f1')).toBe(SIM_UNCLUSTERED_KEY);
    expect(memberOf.get('f2')).toBe(SIM_UNCLUSTERED_KEY);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(2);
  });

  it('is deterministic', () => {
    const cards = [fact('f1'), fact('f2')];
    const sim = new Map<string, string>([['f1', 'sc-0'], ['f2', 'sc-1']]);
    const a = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    const b = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });
});
```

- [ ] **Step 2: Run the similarity suite and confirm it fails against the stub.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts -t "similarity"
```

Expected output: the `groupBy — similarity` tests FAIL (the stub routes everything to `SIM_UNCLUSTERED_KEY`, so `expect(memberOf.get('f1')).toBe('sc-0')` fails).

- [ ] **Step 3: Replace the `groupBySimilarity` stub with the real implementation.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/grouping.ts`, delete the temporary `groupBySimilarity` stub and replace it with:

```ts
// ——— similarity ———
//
// The server clusters endpoint returns {factId, clusterId, clusterLabel}[]; the
// caller folds that into similarityMap (cardId → clusterId) and hands it in. A
// card present in the map joins its cluster; a card absent → SIM_UNCLUSTERED_KEY.
// (clusterLabel is applied at render time from the endpoint; this module only
// sees clusterId, so labels here derive from the id.)

function groupBySimilarity(cards: GroupCard[], similarityMap: Map<string, string>): GroupResult {
  const memberOf = new Map<string, string>();
  for (const c of cards) {
    const clusterId = similarityMap.get(c.id);
    memberOf.set(c.id, clusterId != null && clusterId.length > 0 ? clusterId : SIM_UNCLUSTERED_KEY);
  }
  const groups = buildGroups(memberOf, (key) =>
    key === SIM_UNCLUSTERED_KEY ? 'Unclustered' : `Similar group ${key}`,
  );
  return { memberOf, groups };
}
```

- [ ] **Step 4: Run the FULL grouping test file and confirm every suite is green.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/grouping.test.ts
```

Expected output: all six dimensions plus the common-contract suite pass. No remaining stubs.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/grouping.ts src/lib/canvas/intelligence/desk/grouping.test.ts
git commit -m "$(cat <<'EOF'
desk grouping: similarity dimension (server cluster map)

Map cards by clusterId from the passed similarityMap (factId→clusterId);
absent cards → unclustered. All six GroupDim axes now real + tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: layout.ts — `pileLayout()` (fanned pile anchors, collapsed/expanded)

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/layout.ts`
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/pileLayout.test.ts`

Semantics (per SHARED CONTRACT — `pileLayout(groups, memberOf, cards, expanded:Set<string>):Map<string,{x,y}>`): a grid of pile anchors packed left→right (one anchor per group, in `groups[]` order). Each **collapsed** group is a fanned stack — its members at `anchor + i*{dx:6,dy:8}` with descending z (top member highest z), capped to `~5 visible` (members past the cap stack at the cap position so they're hidden behind the visible fan). Each **expanded** group spreads its members into a vertical column at the anchor. Output covers every card that appears in a group; manual/pinned overrides are NOT applied here — they still win later in `posOf` (this is a pure geometry function). Deterministic.

This task adds `pileLayout` and a `PILE` geometry block to `layout.ts`. It does NOT delete `organisedLayout`/`themeLayout` (a later milestone swaps the callsites).

- [ ] **Step 1: Write the failing `pileLayout` tests first.**

Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/pileLayout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pileLayout, PILE, GRID, type Pos } from './layout';
import type { Group, GroupCard } from './grouping';

// ——— fixtures ———

function card(id: string): GroupCard {
  return { id, kind: 'fact', fields: {} };
}

/** Build the (groups, memberOf, cards) triple for G groups of the given sizes. */
function scenario(sizes: number[]): {
  groups: Group[];
  memberOf: Map<string, string>;
  cards: GroupCard[];
} {
  const groups: Group[] = [];
  const memberOf = new Map<string, string>();
  const cards: GroupCard[] = [];
  sizes.forEach((n, gi) => {
    const key = `g${gi}`;
    groups.push({ key, label: key.toUpperCase(), count: n });
    for (let i = 0; i < n; i++) {
      const id = `g${gi}-c${i}`;
      memberOf.set(id, key);
      cards.push(card(id));
    }
  });
  return { groups, memberOf, cards };
}

const NONE = new Set<string>();

describe('pileLayout — anchors', () => {
  it('returns a position for every card that belongs to a group', () => {
    const { groups, memberOf, cards } = scenario([3, 2]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    expect(m.size).toBe(5);
    for (const c of cards) expect(m.has(c.id)).toBe(true);
  });

  it('ignores cards whose group key is not in groups[]', () => {
    const { groups, memberOf, cards } = scenario([2]);
    const orphan = card('orphan'); // not in memberOf
    const m = pileLayout(groups, memberOf, [...cards, orphan], NONE);
    expect(m.has('orphan')).toBe(false);
    expect(m.size).toBe(2);
  });

  it('packs collapsed pile anchors left→right with non-overlapping footprints', () => {
    const { groups, memberOf, cards } = scenario([2, 2, 2]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    // The anchor of each pile is its first member's position minus the fan
    // offset (i=0 member sits AT the anchor). Top members:
    const a0 = m.get('g0-c0')!;
    const a1 = m.get('g1-c0')!;
    const a2 = m.get('g2-c0')!;
    // Left→right: strictly increasing X, same row Y.
    expect(a1.x).toBeGreaterThan(a0.x);
    expect(a2.x).toBeGreaterThan(a1.x);
    expect(a0.y).toBe(a1.y);
    expect(a1.y).toBe(a2.y);
    // Horizontal stride ≥ the pile footprint so collapsed piles don't overlap.
    expect(a1.x - a0.x).toBeGreaterThanOrEqual(PILE.colStride);
  });

  it('wraps pile anchors to a new row past PILE.perRow', () => {
    const sizes = new Array(PILE.perRow + 1).fill(1);
    const { groups, memberOf, cards } = scenario(sizes);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const first = m.get('g0-c0')!;
    const wrapped = m.get(`g${PILE.perRow}-c0`)!; // first pile on row 2
    expect(wrapped.y).toBeGreaterThan(first.y);
    expect(wrapped.x).toBe(first.x); // restarts at the left edge
  });

  it('snaps every position to the grid', () => {
    const { groups, memberOf, cards } = scenario([4, 3]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    for (const p of m.values()) {
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
    }
  });

  it('is deterministic', () => {
    const { groups, memberOf, cards } = scenario([3, 2]);
    const a = pileLayout(groups, memberOf, cards, NONE);
    const b = pileLayout(groups, memberOf, cards, NONE);
    for (const c of cards) expect(a.get(c.id)).toEqual(b.get(c.id));
  });
});

describe('pileLayout — collapsed fan', () => {
  it('fans visible members by {dx:6, dy:8} per index (snapped)', () => {
    const { groups, memberOf, cards } = scenario([3]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const c0 = m.get('g0-c0')!;
    const c1 = m.get('g0-c1')!;
    const c2 = m.get('g0-c2')!;
    // Each successive visible member is offset by the fan delta (pre-snap 6/8).
    // Assert the trend (down-right) and that the offset matches snap(i*delta).
    expect(c1.x).toBe(snapTo(c0.x, PILE.fanDx, 1));
    expect(c1.y).toBe(snapTo(c0.y, PILE.fanDy, 1));
    expect(c2.x).toBe(snapTo(c0.x, PILE.fanDx, 2));
    expect(c2.y).toBe(snapTo(c0.y, PILE.fanDy, 2));
  });

  it('caps the visible fan: members past maxVisible stack at the cap position', () => {
    const n = PILE.maxVisible + 3;
    const { groups, memberOf, cards } = scenario([n]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const capIdx = PILE.maxVisible - 1;
    const capped = m.get(`g0-c${capIdx}`)!;
    // Every member at or past the cap shares the cap member's position.
    for (let i = capIdx; i < n; i++) {
      expect(m.get(`g0-c${i}`)).toEqual(capped);
    }
  });

  it('collapsed piles from different groups never overlap card footprints', () => {
    const { groups, memberOf, cards } = scenario([5, 5, 5]);
    const m = pileLayout(groups, memberOf, cards, NONE);
    const boxes = cards.map((c) => {
      const p = m.get(c.id)!;
      return { g: memberOf.get(c.id)!, x0: p.x, y0: p.y, x1: p.x + PILE.cardW, y1: p.y + PILE.cardH };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].g === boxes[j].g) continue; // same pile may overlap (fan)
        const a = boxes[i], b = boxes[j];
        const overlapX = a.x0 < b.x1 && b.x0 < a.x1;
        const overlapY = a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
});

describe('pileLayout — expanded', () => {
  it('an expanded group spreads its members into a vertical column at the anchor', () => {
    const { groups, memberOf, cards } = scenario([4]);
    const m = pileLayout(groups, memberOf, cards, new Set(['g0']));
    const c0 = m.get('g0-c0')!;
    const c1 = m.get('g0-c1')!;
    const c2 = m.get('g0-c2')!;
    // Same X column, increasing Y by the row stride.
    expect(c1.x).toBe(c0.x);
    expect(c2.x).toBe(c1.x);
    expect(c1.y - c0.y).toBe(PILE.rowStride);
    expect(c2.y - c1.y).toBe(PILE.rowStride);
    // No visible-count cap when expanded — every member gets a distinct slot.
    expect(m.get('g0-c3')!.y).toBe(c0.y + 3 * PILE.rowStride);
  });

  it('expanding one pile does not move the anchors of other (collapsed) piles', () => {
    const { groups, memberOf, cards } = scenario([3, 3]);
    const collapsed = pileLayout(groups, memberOf, cards, NONE);
    const expanded = pileLayout(groups, memberOf, cards, new Set(['g0']));
    // g1's anchor (top member) is unchanged regardless of g0's expansion.
    expect(expanded.get('g1-c0')).toEqual(collapsed.get('g1-c0'));
  });

  it('is deterministic when expanded', () => {
    const { groups, memberOf, cards } = scenario([3]);
    const exp = new Set(['g0']);
    const a = pileLayout(groups, memberOf, cards, exp);
    const b = pileLayout(groups, memberOf, cards, exp);
    for (const c of cards) expect(a.get(c.id)).toEqual(b.get(c.id));
  });
});

// Local helper mirroring the implementation's snap(anchor + i*delta) idiom so
// the fan assertions are exact rather than approximate.
function snapTo(anchorCoord: number, delta: number, i: number): number {
  return Math.round((anchorCoord + i * delta) / GRID) * GRID;
}
```

- [ ] **Step 2: Run the pileLayout tests and confirm they fail because `pileLayout`/`PILE` are not exported.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/pileLayout.test.ts
```

Expected output: failure — `pileLayout`/`PILE` are not exported from `./layout` (e.g. `pileLayout is not a function` / type-import errors).

- [ ] **Step 3: Implement `PILE` geometry + `pileLayout()` in `layout.ts`.**

Append to the end of `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/layout.ts`:

```ts
// ——— PILE LAYOUT (Milestone 4) ———
//
// A grid of overlapping "piles". Each group from grouping.ts becomes one pile,
// packed left→right (wrapping past PILE.perRow). A COLLAPSED pile is a fanned
// stack: member i sits at anchor + i*{fanDx, fanDy} (snapped), capped at
// maxVisible so members past the cap stack at the cap position (hidden behind
// the visible fan; the desk renders a "+N" badge for them). An EXPANDED pile
// spreads its members into a vertical column at the anchor (rowStride apart, no
// cap). Pure + deterministic + grid-snapped. Manual/pinned overrides are NOT
// applied here — posOf re-asserts those after this layout (priority unchanged).
//
// Imports are local to keep layout.ts free of a hard dependency cycle: grouping
// imports themes (not layout), so layout may type-only import grouping safely.

import type { Group, GroupCard } from './grouping';

export const PILE = {
  /** Top-left origin of the pile grid (reuses the synthesis zone origin). */
  originX: SYNTHESIS_ZONE_ORIGIN.x,
  originY: SYNTHESIS_ZONE_ORIGIN.y,
  /** Card box — kept in sync with the desk card footprint. */
  cardW: CARD_W,
  cardH: CARD_H,
  /** Horizontal distance between pile anchor columns (≥ a fanned pile's width). */
  colStride: 320,
  /** Vertical distance between pile anchor rows (≥ a fanned pile's height). */
  pileRowStride: 360,
  /** Piles per row before wrapping to the next anchor row. */
  perRow: 5,
  /** Fan offset applied per visible member in a collapsed pile. */
  fanDx: 6,
  fanDy: 8,
  /** Max members rendered in the collapsed fan; the rest stack at the cap. */
  maxVisible: 5,
  /** Vertical stride between members of an EXPANDED pile's column (row 0 = anchor). */
  rowStride: 160,
} as const;

/**
 * Place every grouped card into a pile.
 *
 * @param groups       Ordered groups (drives left→right anchor packing).
 * @param memberOf     cardId → groupKey (from grouping.ts).
 * @param cards        All desk cards; only those whose memberOf key is a known
 *                     group get a position (orphans are skipped).
 * @param expanded     Set of group keys currently expanded (spread to a column);
 *                     groups not in the set render as a collapsed fan.
 * @returns            Map<cardId, Pos>, grid-snapped, deterministic.
 */
export function pileLayout(
  groups: Group[],
  memberOf: Map<string, string>,
  cards: GroupCard[],
  expanded: Set<string>,
): Map<string, Pos> {
  // Anchor (top-left of the i=0 member) for each group, in groups[] order.
  const anchorOf = new Map<string, Pos>();
  groups.forEach((g, gi) => {
    const col = gi % PILE.perRow;
    const row = Math.floor(gi / PILE.perRow);
    anchorOf.set(g.key, {
      x: snap(PILE.originX + col * PILE.colStride),
      y: snap(PILE.originY + row * PILE.pileRowStride),
    });
  });

  // Bucket member cards per group, preserving input order (stable stacking).
  const membersByGroup = new Map<string, string[]>();
  for (const c of cards) {
    const key = memberOf.get(c.id);
    if (key === undefined || !anchorOf.has(key)) continue; // orphan — skip
    let arr = membersByGroup.get(key);
    if (!arr) {
      arr = [];
      membersByGroup.set(key, arr);
    }
    arr.push(c.id);
  }

  const out = new Map<string, Pos>();
  for (const [key, anchor] of anchorOf) {
    const members = membersByGroup.get(key) ?? [];
    const isExpanded = expanded.has(key);
    members.forEach((id, i) => {
      if (isExpanded) {
        // Vertical column at the anchor — every member a distinct slot.
        out.set(id, {
          x: snap(anchor.x),
          y: snap(anchor.y + i * PILE.rowStride),
        });
      } else {
        // Collapsed fan; members past the cap stack at the cap position.
        const fanI = Math.min(i, PILE.maxVisible - 1);
        out.set(id, {
          x: snap(anchor.x + fanI * PILE.fanDx),
          y: snap(anchor.y + fanI * PILE.fanDy),
        });
      }
    });
  }

  return out;
}
```

Note for the implementer: `SYNTHESIS_ZONE_ORIGIN`, `CARD_W`, `CARD_H`, `snap`, `Pos` are all already defined earlier in `layout.ts` (verified). The `import type { Group, GroupCard } from './grouping'` is a **type-only** import — safe even though `grouping.ts` is in the same directory, because `grouping.ts` imports `themes.ts` (not `layout.ts`), so there is no runtime cycle. Keep it as `import type`.

- [ ] **Step 4: Re-run the pileLayout tests and confirm green.**

```bash
npm run test -- src/lib/canvas/intelligence/desk/pileLayout.test.ts
```

Expected output: all `pileLayout — anchors`, `collapsed fan`, and `expanded` tests pass.

- [ ] **Step 5: Run the WHOLE desk test suite to confirm no regression in the existing layout/themes/positioning tests (which still import `organisedLayout`/`themeLayout`, untouched).**

```bash
npm run test -- src/lib/canvas/intelligence/desk/
```

Expected output: every desk `*.test.ts` passes — `grouping.test.ts`, `pileLayout.test.ts`, `layout.test.ts`, `themes.test.ts`, `positioning.test.ts`, `accumulation.test.ts`, `synthesis-reducer.test.ts`, etc. No failures, no unhandled errors.

- [ ] **Step 6: Type-check the two new modules to confirm the type-only cross-import resolves.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "desk/(grouping|layout|pileLayout)" || echo "no type errors in grouping/layout/pileLayout"
```

Expected output: `no type errors in grouping/layout/pileLayout`. (If sandbox EPERM, retry with `dangerouslyDisableSandbox: true`. A full repo `tsc` may surface unrelated pre-existing errors elsewhere; the `grep` scopes the gate to this milestone's files.)

- [ ] **Step 7: Commit.**

```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/pileLayout.test.ts
git commit -m "$(cat <<'EOF'
desk layout: pileLayout() — fanned pile anchors, collapsed/expanded

Grid of left→right pile anchors (wrap past perRow). Collapsed = fanned stack
(anchor + i*{6,8}, descending z, capped at maxVisible — overflow stacks at the
cap). Expanded = vertical column at the anchor (no cap). Grid-snapped,
deterministic, orphan-safe. Manual/pinned overrides still re-asserted by posOf.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```


I have everything needed. I'll now write the milestone. Since I can't browser-verify, I'll include svelte-check verification and explicit prod-walkthrough manual steps. Note that M5 only adds a *placeholder* GroupDim slot (real wiring is M9), keeps `typeFilters`/`visibleCards`, and moves filter controls out of LeftFeed into FloatingFilters.

Here is the milestone:

## Milestone 5: Canvas restyle + floating filters + remove sidebar

This milestone restyles `ResearchDesk.svelte` to read as the same visual family as the `/jkai/canvas/[slug]` workflow editor: a panning/zooming dotted grid background, a `.wf-node`-style frame treatment on cards, workflow-grade edge strokes, and the workflow toolbar/zoom chrome. It introduces `desk/FloatingFilters.svelte` — a view-locked box pinned top-left that holds the artefact-type filters (lifted out of `LeftFeed`) plus a *placeholder* GroupDim selector slot (the real GroupDim wiring lands in M9). Finally it removes the `LeftFeed` left sidebar entirely while keeping the bottom `ActivityTicker`.

**Scope guardrails (read before starting):**
- This milestone is purely presentational + the filter relocation. Do **not** add the node palette, the `groupBy`/`pileLayout` engine, or any new endpoints here — those are other milestones. The GroupDim selector in `FloatingFilters.svelte` is a disabled placeholder this milestone.
- Keep `typeFilters` and `visibleCards` exactly as they are (the artefact-type filter still gates the render); only the *controls* move from `LeftFeed` into `FloatingFilters`.
- The desk's existing `orthPath`, pan/zoom math, `positionById` memo, minimap, and `morphIds` derivation are correct — do not rewrite them. We only restyle the markup/CSS around them.
- Svelte 5 footguns apply: do **not** `$state` an interval/AbortController handle read inside a function called from an `$effect`; when an `$effect` syncs props into local `$state`, hoist prop reads to consts and `untrack()` the writes. This milestone introduces no new `$effect`s, so the main risk is accidental ones — prefer `$derived`.

Real-code anchors confirmed (line refs may have drifted; re-confirm by content):
- Desk world container is `.desk-world-wrap` in `ResearchDesk.svelte` (the bind:this `viewportEl`, currently `~877`), with the transformed child `.desk-world` (currently `~891`). The current background is a radial-dot gradient on `.desk-world-wrap` (`~1115`).
- Lift-source CSS in `src/routes/jkai/canvas/[slug]/+page.svelte`: `.viewport` grid (`~5945-5964`), `--grid-offset-x/y` + `--grid-cell` style bindings (`~3394-3396`), `.wf-node` frame (`~6431-6476`), `.wf-node.is-selected` (`~6561-6564`), `.edges .edge-hit` (`~6427-6429`), edge `.edge-stroke` markup (styled inline via attributes, `~3496-3510`), `.hifi-toolbar` (`~5798`), `.composer-pill` (`~5875`), `.hifi-zoomctl` (`~5920-5942`).
- Design tokens are global in `src/app.css`: `--bg`, `--accent` (#c4570a), `--surface-elevated`, `--card-border`, `--divider`, `--text-primary`, `--text-muted`, `--text-ghost`, `--font-mono`, `--bg-section`, `--accent-tint-08`, `--accent-tint-25`. No new fonts/colors.

---

### Task 1: Add the panning-grid background to the desk viewport

Replace the desk's radial-dot background with the workflow canvas's two-layer linear-gradient grid, wired to `panX`/`panY`/`zoom` via the `--grid-offset-x`, `--grid-offset-y`, and `--grid-cell` CSS vars (so the grid pans and scales with the world). The grid lives on `.desk-world-wrap` (the viewport element), which is the **sibling-parent** of the transformed `.desk-world` — the grid must NOT be inside the `transform`ed child, otherwise it would scale twice.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Wire the three grid CSS vars onto the `.desk-world-wrap` element.**
  Find the desk viewport element (currently `~877`):
  ```svelte
      <div
        class="desk-world-wrap"
        class:panning={panStart !== null}
        bind:this={viewportEl}
        bind:clientWidth={viewportW}
        bind:clientHeight={viewportH}
        role="application"
        aria-label="Research desk"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onwheel={onWheel}
      >
  ```
  Add the three `style:` bindings (mirrors `+page.svelte:3394-3396`). The new element opening tag becomes:
  ```svelte
      <div
        class="desk-world-wrap"
        class:panning={panStart !== null}
        bind:this={viewportEl}
        bind:clientWidth={viewportW}
        bind:clientHeight={viewportH}
        role="application"
        aria-label="Research desk"
        style:--grid-offset-x="{panX}px"
        style:--grid-offset-y="{panY}px"
        style:--grid-cell="{32 * zoom}px"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onwheel={onWheel}
      >
  ```
  These read the existing `$state` `panX`/`panY`/`zoom` (declared `~598-600`) — no new state. CSS-var style bindings do not invalidate the layout memos, so this is reactive-cost-free.

- [ ] **Step 2: Replace the radial-dot background on `.desk-world-wrap` with the linear-gradient grid.**
  Find the current `.desk-world-wrap` CSS rule (currently `~1108`):
  ```css
    .desk-world-wrap {
      position: relative;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      touch-action: none;
      cursor: grab;
      background:
        radial-gradient(circle, rgba(26, 16, 8, 0.06) 1px, transparent 1px) 0 0 / 32px 32px;
    }
  ```
  Replace it with the workflow canvas grid (lifted from `+page.svelte:5945-5961`, mapped onto the desk's existing layout properties):
  ```css
    .desk-world-wrap {
      position: relative;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      touch-action: none;
      cursor: grab;
      background-color: var(--bg);
      background-image:
        linear-gradient(var(--divider) 1px, transparent 1px),
        linear-gradient(90deg, var(--divider) 1px, transparent 1px);
      background-size:
        var(--grid-cell, 32px) var(--grid-cell, 32px),
        var(--grid-cell, 32px) var(--grid-cell, 32px);
      background-position:
        var(--grid-offset-x, 0) var(--grid-offset-y, 0),
        var(--grid-offset-x, 0) var(--grid-offset-y, 0);
    }
  ```
  Leave the existing `.desk-world-wrap.panning { cursor: grabbing; }` rule (currently `~1118`) untouched — it already matches `.viewport.panning`.

- [ ] **Step 3: Run svelte-check (clean).**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | tail -20
  ```
  Expected: the run completes with `svelte-check found 0 errors` for `ResearchDesk.svelte` (any pre-existing warnings elsewhere are unchanged; there must be **0 new errors** in this file). If a Bash command fails with EPERM/permission, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 4: Manual verification (note: cannot browser-verify in this environment — prod walkthrough deferred).**
  Cannot drive a browser here. Record this for the prod walkthrough at the end of the feature: open `/deepdive/<a session id>`, confirm the desk shows a fine 32px lined grid (not dots); pan with a left-drag on empty space and confirm the grid translates with the cards; zoom with the wheel and confirm the grid cells scale (32px × zoom). The grid lines use `var(--divider)` so they read as faint hairlines on `var(--bg)`.

- [ ] **Step 5: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2 (M5): panning-grid background on the desk viewport

Replace the desk's radial-dot background with the workflow canvas's
two-layer linear-gradient grid, wired to panX/panY/zoom via
--grid-offset-x/y and --grid-cell so the grid pans and scales with the
world. Grid lives on .desk-world-wrap (sibling-parent of the transformed
.desk-world) so it never scales twice.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Reconcile the card frame + edges to the workflow canvas style

Bring the desk's card-host and edge rendering visually in line with `.wf-node` (selection outline, `data-kind` 3px left bar) and the workflow `.edge-stroke`/`.edge-hit` treatment + non-scaling stroke. The card *bodies* (`ArtefactCard`) are NOT replaced — the reconciliation lands on the `.desk-card-host` wrapper (left-bar + selection outline) and on the existing edge `<path>`s.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Add a `kindOf` pure helper for the `data-kind` left-bar color.**
  In the `<script>` of `ResearchDesk.svelte`, near the other card-geometry helpers (after `cardH`, currently `~279`), add a small pure function mapping a `DeskCard` to a workflow `data-kind` token (reusing the desk's own kind/counterfactual logic, identical to `cardFilterKey`'s spirit):
  ```ts
    // Map a card to a workflow-canvas `data-kind` token so the 3px left bar on
    // the card host matches the .wf-node[data-kind] color canon. Pure; no state.
    function kindOf(c: DeskCard): 'source' | 'fact' | 'entity' | 'counterfactual' {
      if (c.kind === 'entity') return 'entity';
      if (c.kind === 'source') return 'source';
      return (c.fields.isCounterfactual as boolean) ? 'counterfactual' : 'fact';
    }
  ```

- [ ] **Step 2: Apply `data-kind` + `.is-selected` to the card host.**
  Find the card host in the `{#each visibleCards ...}` loop (currently `~977`):
  ```svelte
            <div
              class="desk-card-host"
              class:morphing={!c.pinned && c.canvasX == null && !dragOverrides[c.id] && morphIds.has(c.id)}
              style:transform="translate({p.x}px, {p.y}px)"
              onpointerdown={(e) => onCardPointerDown(e, c)}
              onpointermove={onCardPointerMove}
              onpointerup={(e) => onCardPointerUp(e, c)}
              onpointercancel={(e) => onCardPointerUp(e, c)}
            >
  ```
  Add `data-kind` and the `is-selected` class (the host already knows `selectedId`):
  ```svelte
            <div
              class="desk-card-host"
              class:morphing={!c.pinned && c.canvasX == null && !dragOverrides[c.id] && morphIds.has(c.id)}
              class:is-selected={selectedId === c.id}
              data-kind={kindOf(c)}
              style:transform="translate({p.x}px, {p.y}px)"
              onpointerdown={(e) => onCardPointerDown(e, c)}
              onpointermove={onCardPointerMove}
              onpointerup={(e) => onCardPointerUp(e, c)}
              onpointercancel={(e) => onCardPointerUp(e, c)}
            >
  ```
  (`ArtefactCard` keeps its own `selected` prop for its internal body styling — this only adds the host-level outline + left bar so cards read as the `.wf-node` family.)

- [ ] **Step 3: Add the `.wf-node`-derived host CSS (left bar + selection outline).**
  Find the `.desk-card-host` CSS rule (currently `~1121`):
  ```css
    .desk-card-host { position: absolute; top: 0; left: 0; touch-action: none; will-change: transform; }
  ```
  Replace it with the reconciled version (mirrors `.wf-node::before` left-bar canon `+page.svelte:6447-6476` and `.wf-node.is-selected` `+page.svelte:6561-6564`):
  ```css
    .desk-card-host {
      position: absolute;
      top: 0;
      left: 0;
      touch-action: none;
      will-change: transform;
    }
    /* 3px left bar keyed off data-kind, matching .wf-node[data-kind]::before. */
    .desk-card-host::before {
      content: '';
      position: absolute;
      left: -4px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--text-ghost);
      pointer-events: none;
      z-index: 1;
    }
    .desk-card-host[data-kind='source']::before { background: var(--text-muted); }
    .desk-card-host[data-kind='fact']::before { background: var(--accent); }
    .desk-card-host[data-kind='entity']::before { background: var(--text-primary); }
    .desk-card-host[data-kind='counterfactual']::before { background: #c44; }
    /* Selection outline, matching .wf-node.is-selected. */
    .desk-card-host.is-selected {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      z-index: 3;
    }
  ```
  Leave the `.desk-card-host.morphing` rule (currently `~1123`) and the reduced-motion override untouched.

- [ ] **Step 4: Reconcile the relationship + synthesis edges to the workflow stroke + hit-target.**
  Find the relationship edges block inside the `<svg class="desk-edges">` (currently `~894`):
  ```svelte
          {#each edgePaths as e (e.id)}
            <path d={e.d} fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.45" vector-effect="non-scaling-stroke" />
          {/each}
  ```
  Replace it with a wide transparent hit path + a thin styled stroke (mirrors `+page.svelte:3476-3510`; the desk edges are non-interactive in M5, so the hit path has `pointer-events: none` for now — interactivity is out of scope):
  ```svelte
          {#each edgePaths as e (e.id)}
            <path class="edge-hit" d={e.d} stroke="transparent" stroke-width="14" fill="none" pointer-events="none" />
            <path class="edge-stroke" d={e.d} fill="none" stroke="var(--text-ghost)" stroke-width="1.25" vector-effect="non-scaling-stroke" pointer-events="none" />
          {/each}
  ```
  Then find the synthesis edges block (currently `~911`):
  ```svelte
            {#each synthEdgePaths as e (e.id)}
              <path
                d={e.d}
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.25"
                stroke-opacity="0.45"
                vector-effect="non-scaling-stroke"
                class="syn-edge"
              />
            {/each}
  ```
  Reconcile it to the active-edge styling from the workflow canvas (`+page.svelte:3500-3506`: active edges use `var(--accent)`, `stroke-dasharray="3 3"`), keeping the existing `.syn-edge` fade-in class:
  ```svelte
            {#each synthEdgePaths as e (e.id)}
              <path
                d={e.d}
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
                class="syn-edge"
              />
            {/each}
  ```
  Leave the provenance-spark `{#each sparkPaths ...}` block between them unchanged (it is a separate animated affordance).

- [ ] **Step 5: Add the `.edge-hit` cursor rule.**
  In the `<style>` block, next to `.desk-edges` (currently `~1120`), add the workflow `.edges .edge-hit` rule (lifted from `+page.svelte:6427-6429`). Since the desk edges are not yet clickable, scope a non-interactive default:
  ```css
    .desk-edges .edge-hit { cursor: default; pointer-events: none; }
  ```
  (When edge interactivity is added in a later milestone, this becomes `cursor: pointer; pointer-events: stroke;`.)

- [ ] **Step 6: Run svelte-check (clean).**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | tail -20
  ```
  Expected: 0 new errors in `ResearchDesk.svelte`. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 7: Manual verification (deferred to prod walkthrough).**
  Record: on `/deepdive/<id>`, each card shows a 3px left bar colored by kind (source = muted, fact = accent orange, entity = dark, counterfactual = red); selecting a card shows a 2px accent outline at the host level; relationship edges render as thin ghost-gray hairlines (non-scaling at any zoom); in SYNTHESIZE mode the synthesis connector edges render as dashed accent strokes that fade in.

- [ ] **Step 8: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2 (M5): reconcile card frame + edges to workflow canvas

Card hosts gain a data-kind 3px left bar (kindOf helper) and a host-level
.is-selected accent outline matching .wf-node. Relationship edges adopt
the .edge-stroke/.edge-hit pair with a thin ghost-gray non-scaling
stroke; synthesis edges adopt the dashed-accent active-edge styling.
Card bodies (ArtefactCard) are unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Adopt the workflow toolbar/zoom chrome (composer-pill + hifi-zoomctl)

Reskin the desk's bottom-left zoom controls to the workflow `.hifi-zoomctl` look and add `.composer-pill`/`.hifi-zoomctl` class hooks so the desk chrome reads as the same family. The arrange-by-theme toolbar (`.desk-arrange`, currently top-left) is **removed in Task 5** when `FloatingFilters` takes the top-left slot — do not touch it here beyond leaving it where it is.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Reskin the zoom-control cluster to `.hifi-zoomctl`.**
  Find the zoom controls markup (currently `~1055`):
  ```svelte
        <!-- zoom controls -->
        <div class="desk-zoom">
          <button type="button" onclick={() => zoomCentered(1.2)} aria-label="Zoom in">+</button>
          <button type="button" onclick={() => zoomCentered(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" onclick={fit} aria-label="Fit">⤢</button>
          <button type="button" onclick={reset} aria-label="Reset">⌂</button>
        </div>
  ```
  Replace it with a horizontal `.hifi-zoomctl` bar that also surfaces the live zoom percentage (mirrors `+page.svelte:5920-5942`; the desk already derives `zoomPct` `~601`):
  ```svelte
        <!-- zoom controls (workflow .hifi-zoomctl chrome) -->
        <div class="desk-zoom hifi-zoomctl" role="group" aria-label="Zoom controls">
          <button type="button" onclick={() => zoomCentered(1 / 1.2)} aria-label="Zoom out">−</button>
          <span class="zv">{zoomPct}%</span>
          <button type="button" onclick={() => zoomCentered(1.2)} aria-label="Zoom in">+</button>
          <button type="button" onclick={fit} aria-label="Fit">⤢</button>
          <button type="button" onclick={reset} aria-label="Reset">⌂</button>
        </div>
  ```

- [ ] **Step 2: Replace the `.desk-zoom` CSS with `.hifi-zoomctl`-derived styling.**
  Find the `.desk-zoom` CSS (currently `~1273`):
  ```css
    .desk-zoom {
      position: absolute;
      bottom: 12px;
      left: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .desk-zoom button {
      width: 28px;
      height: 28px;
      font-family: var(--font-mono);
      font-size: 14px;
      background: var(--surface-elevated);
      color: var(--text-primary);
      border: 1px solid rgba(26, 16, 8, 0.18);
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
      cursor: pointer;
    }
    .desk-zoom button:hover { border-color: var(--accent); color: var(--accent); }
  ```
  Replace it with the workflow zoom-control look (lifted from `+page.svelte:5920-5942`, anchored bottom-left as before, on `--surface-elevated` so it reads above the grid):
  ```css
    /* Zoom controls — workflow .hifi-zoomctl chrome, anchored bottom-left. */
    .desk-zoom {
      position: absolute;
      bottom: 12px;
      left: 12px;
    }
    .hifi-zoomctl {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--card-border);
      background: var(--surface-elevated);
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .hifi-zoomctl button {
      background: transparent;
      border: none;
      padding: 5px 9px;
      cursor: pointer;
      color: var(--text-primary);
      font-family: inherit;
      font-size: inherit;
    }
    .hifi-zoomctl button + button {
      border-left: 1px solid var(--card-border);
    }
    .hifi-zoomctl button:hover {
      color: var(--accent);
    }
    .hifi-zoomctl .zv {
      padding: 0 8px;
      color: var(--text-muted);
      border-left: 1px solid var(--card-border);
    }
  ```
  Note: `.zv` sits between the `−` and `+` buttons; the `button + button` rule does not apply across the `<span>`, so `.zv` carries its own left border, and the `+` button (which immediately follows `.zv`, not a button) gets a left border via... it does NOT — to keep dividers consistent, the `+`/`⤢`/`⌂` buttons each follow another button so `button + button` covers them. The only seam is `.zv`'s own `border-left`. This matches the workflow canvas's `.hifi-zoomctl` rendering.

- [ ] **Step 3: Run svelte-check (clean).**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | tail -20
  ```
  Expected: 0 new errors in `ResearchDesk.svelte`. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 4: Manual verification (deferred to prod walkthrough).**
  Record: bottom-left zoom control is now a single horizontal pill `[ − | 100% | + | ⤢ | ⌂ ]` on the elevated surface with hairline dividers; clicking `−`/`+` zooms (and the percentage updates live), `⤢` fits, `⌂` resets.

- [ ] **Step 5: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2 (M5): adopt workflow .hifi-zoomctl zoom chrome

Reskin the desk's bottom-left zoom cluster into a single horizontal
.hifi-zoomctl pill with a live zoom-% readout, matching the workflow
canvas chrome.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Create `desk/FloatingFilters.svelte` (view-locked top-left filter box)

A new self-contained component holding the artefact-type filters (source/fact/entity/counterfactual — the controls lifted out of `LeftFeed`) plus a **placeholder, disabled** GroupDim selector (real wiring in M9). It is styled `--surface-elevated` with `.composer-pill`-derived controls and is designed to be mounted as a **sibling of the transformed `.desk-world`** so it stays view-locked.

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/FloatingFilters.svelte`

- [ ] **Step 1: Decide the component interface (props).**
  The component is controlled by `ResearchDesk` (same pattern `LeftFeed` used for filters):
  - `filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean }` — current toggle state (mirrors `typeFilters`).
  - `counts: { sources: number; facts: number; entities: number; counterfactuals: number }` — for the per-filter count badges (subset of the desk's existing `counts` derived).
  - `onfilter: (key: 'source' | 'fact' | 'entity' | 'counterfactual', value: boolean) => void` — toggle callback (same signature as `LeftFeed`'s `onfilter`, so `handleFilter` is reused verbatim).
  - The GroupDim selector is a **disabled placeholder** in M5 (no prop) — M9 will add `groupDim` + `ongroupdim` props.

- [ ] **Step 2: Write the component.**
  Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/FloatingFilters.svelte`:
  ```svelte
  <!-- src/lib/canvas/intelligence/desk/FloatingFilters.svelte -->
  <!--
    View-locked floating filter box, pinned top-left over the desk viewport.
    MUST be mounted as a SIBLING of the transformed .desk-world (a direct child
    of .desk-world-wrap), NOT inside it — otherwise it would pan/scale with the
    world. Mirrors how the minimap/zoom chrome are anchored.

    Holds the artefact-type filters (moved out of LeftFeed) + a placeholder
    GroupDim selector slot (wired in M9).
  -->
  <script lang="ts">
    type FilterKey = 'source' | 'fact' | 'entity' | 'counterfactual';

    let {
      filters,
      counts,
      onfilter,
    }: {
      filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean };
      counts: { sources: number; facts: number; entities: number; counterfactuals: number };
      onfilter: (key: FilterKey, value: boolean) => void;
    } = $props();

    const filterDefs: { key: FilterKey; label: string; swatch: string; countKey: keyof typeof counts }[] = [
      { key: 'source', label: 'Sources', swatch: 'src', countKey: 'sources' },
      { key: 'fact', label: 'Facts', swatch: 'fact', countKey: 'facts' },
      { key: 'entity', label: 'Entities', swatch: 'ent', countKey: 'entities' },
      { key: 'counterfactual', label: 'Challenges', swatch: 'chal', countKey: 'counterfactuals' },
    ];
  </script>

  <div class="floating-filters" role="group" aria-label="Desk filters">
    <section class="ff-sec">
      <h3>FILTERS</h3>
      <div class="ff-filters">
        {#each filterDefs as f (f.key)}
          <label class="ff-row" class:off={!filters[f.key]}>
            <input
              type="checkbox"
              checked={filters[f.key]}
              onchange={(e) => onfilter(f.key, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="ff-swatch ff-swatch-{f.swatch}"></span>
            <span class="ff-label">{f.label}</span>
            <span class="ff-count">{counts[f.countKey]}</span>
          </label>
        {/each}
      </div>
    </section>

    <!-- GroupDim selector placeholder — wired in M9. Kept disabled so the
         layout/position is locked in now and the wiring is a drop-in later. -->
    <section class="ff-sec ff-groupby">
      <h3>GROUP BY</h3>
      <select class="ff-select" disabled aria-label="Group by dimension (coming soon)">
        <option>Similarity</option>
      </select>
      <span class="ff-soon">soon</span>
    </section>
  </div>

  <style>
    .floating-filters {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 6;
      width: 200px;
      background: var(--surface-elevated);
      border: 1px solid var(--card-border);
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      user-select: none;
    }
    .ff-sec h3 {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-ghost);
      margin: 0 0 8px;
    }
    .ff-filters { display: flex; flex-direction: column; gap: 6px; }
    .ff-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
      cursor: pointer;
    }
    .ff-row.off { color: var(--text-ghost); }
    .ff-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
    .ff-swatch-src { background: var(--surface-elevated); border: 1px solid var(--card-border); }
    .ff-swatch-fact { background: var(--accent-tint-25); border: 1px solid var(--accent); }
    .ff-swatch-ent { background: var(--text-primary); }
    .ff-swatch-chal { background: rgba(196, 68, 68, 0.18); border: 1px solid #c44; }
    .ff-label { flex: 1; }
    .ff-count {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
    }

    .ff-groupby { display: flex; flex-direction: column; gap: 6px; }
    .ff-groupby h3 { margin: 0; }
    .ff-select {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 4px 8px;
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      cursor: not-allowed;
      width: 100%;
    }
    .ff-soon {
      align-self: flex-start;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-ghost);
    }
  </style>
  ```
  Notes: this is the ONLY filter UI after Task 5 removes `LeftFeed`. The swatch colors mirror `LeftFeed`'s (`swatch-src`/`swatch-fact`/`swatch-ent`/`swatch-chal`) but use global tokens (`LeftFeed` used a literal `#faf6ee` and `--error-bg`/`--error`; we use `--surface-elevated` and `#c44`/`rgba(196,68,68,…)` to stay within the documented palette). No new `$effect`; controlled component, so no Svelte 5 state-sync footgun.

- [ ] **Step 3: Type-check the new component in isolation.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | tail -20
  ```
  Expected: 0 errors for `FloatingFilters.svelte`. (The component isn't mounted yet — this confirms it compiles standalone.) Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 4: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/FloatingFilters.svelte && git commit -m "Research Desk v2 (M5): add FloatingFilters.svelte (view-locked top-left box)

New self-contained, controlled component holding the artefact-type
filters (source/fact/entity/counterfactual, with count badges) plus a
disabled placeholder GroupDim selector (wired in M9). Styled
--surface-elevated; designed to mount as a sibling of the transformed
.desk-world so it stays view-locked. Not yet mounted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Mount FloatingFilters, remove the LeftFeed sidebar, prune dead state

Wire `FloatingFilters` into `ResearchDesk` as a sibling of `.desk-world`, delete the `LeftFeed` sidebar and the now-orphaned `.desk-mid` flex row + the old `.desk-arrange` theme toolbar (its top-left slot is now owned by `FloatingFilters`), and remove the state/derivations that only fed `LeftFeed`. Keep `typeFilters`, `handleFilter`, `visibleCards`, and the bottom `ActivityTicker`.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Build a slim `filterCounts` derived for the floating box.**
  `FloatingFilters` needs per-filter counts. The desk already computes `counts` (`~111`) with `sources/facts/entities/counterfactuals`. Reuse it directly — `counts` already has the exact shape `FloatingFilters` expects (`sources`, `facts`, `entities`, `counterfactuals`), so no new derived is needed. (Confirm by re-reading the `counts` derived: it returns `{ sources, facts, entities, links, counterfactuals }`; the extra `links` key is harmless.)

- [ ] **Step 2: Import `FloatingFilters` and drop the `LeftFeed` import.**
  In the `<script>` imports (currently `~10`), remove:
  ```ts
    import LeftFeed from './desk/LeftFeed.svelte';
  ```
  and add (next to the other desk-component imports):
  ```ts
    import FloatingFilters from './desk/FloatingFilters.svelte';
  ```

- [ ] **Step 3: Remove the LeftFeed-only state + derivations.**
  Delete the following from the `<script>` (they fed only `LeftFeed`):
  - `let feedCollapsed = $state(false);` (currently `~61`).
  - The `feedSources` derived (currently `~83-94`):
    ```ts
    let feedSources = $derived(
      store.cards
        .filter((c) => c.kind === 'source')
        .map((c) => ({
          id: c.id,
          url: (c.fields.url as string) ?? '',
          title: (c.fields.title as string | null) ?? null,
          domain: (c.fields.domain as string) ?? '',
          credibilityType: (c.fields.credibilityType as string | null) ?? null,
          credibilityScore: (c.fields.credibilityScore as number | null) ?? null,
        })),
    );
    ```
  - The `synthesisRuns` derived (currently `~97-108`):
    ```ts
    let synthesisRuns = $derived(
      store.synthStatus !== 'idle'
        ? [
            {
              runId: 'current',
              status: store.synthStatus,
              summary: store.synthSummary ? store.synthSummary.slice(0, 120) : undefined,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
    );
    ```
  - The `handleSelectRun` function (currently `~233-235`):
    ```ts
    function handleSelectRun(_runId: string) {
      mode = 'synthesize';
    }
    ```
  **Keep** `typeFilters` (`~68`), `handleFilter` (`~229`), `cardFilterKey` (`~337`), and `visibleCards` (`~345`) — `visibleCards` still consumes `typeFilters`.

- [ ] **Step 4: Remove the `<LeftFeed>` element and unwrap the `.desk-mid` row.**
  Find the mid region (currently `~864-1062`):
  ```svelte
    <div class="desk-mid">
      <LeftFeed
        logs={store.logs}
        sources={feedSources}
        filters={typeFilters}
        {synthesisRuns}
        bind:collapsed={feedCollapsed}
        onfilter={handleFilter}
        onselectrun={handleSelectRun}
      />

      <!-- desk world -->
      <div
        class="desk-world-wrap"
        ...
      >
        ...
      </div>
    </div>
  ```
  Remove the `<LeftFeed ... />` element entirely, and remove the now-single-child `.desk-mid` wrapper (the `.desk-world-wrap` becomes the direct flex child of `.desk-shell`). Concretely: delete the `<div class="desk-mid">` open tag + the whole `<LeftFeed .../>` block, and delete the matching `</div>` that closed `.desk-mid` (the one immediately before `<ActivityTicker`). The `.desk-world-wrap` element and everything inside it stays.

- [ ] **Step 5: Mount `FloatingFilters` as a sibling of `.desk-world` (view-locked).**
  Inside `.desk-world-wrap`, AFTER the transformed `.desk-world` closing `</div>` and alongside the minimap/zoom chrome (so it is NOT inside the `transform`), add the floating box. Place it right where the old `.desk-arrange` toolbar was (top-left). The block to remove is the arrange toolbar (currently `~1003-1025`):
  ```svelte
        <!-- arrange-by-theme toolbar (screen-fixed, top-left of the canvas) -->
        <div class="desk-arrange" role="group" aria-label="Arrange by theme">
          <button ...>&#9637; Arrange by theme</button>
          <button ...>
            <span class="arr-knob" aria-hidden="true"></span>
            <span class="arr-label">keep arranged</span>
          </button>
        </div>
  ```
  Replace that entire `.desk-arrange` block with:
  ```svelte
        <!-- view-locked floating filter box (sibling of the transformed world) -->
        <FloatingFilters
          filters={typeFilters}
          {counts}
          onfilter={handleFilter}
        />
  ```
  IMPORTANT: the `arrange` theme toolbar is being removed in M5 because the floating box owns the top-left slot. The underlying `arrange`/`themeSnapshot`/`liveThemeLayout`/`arrangeByThemeOnce`/`toggleKeepArranged` logic is replaced wholesale by the M9 `pileLayout`/`groupBy` engine, so leaving the now-unreachable buttons removed is correct. **Do NOT delete the `arrange` state/derivations/`posOf` theme branch in this milestone** — `posOf` still references them and removing them now would break the layout; they are retired in the layout milestone. Only the UI toolbar buttons go here.

- [ ] **Step 6: Remove the now-orphaned `.desk-mid` and `.desk-arrange` CSS.**
  Delete the `.desk-mid` CSS rule (currently `~1102-1106`):
  ```css
    .desk-mid {
      flex: 1;
      display: flex;
      min-height: 0;
    }
  ```
  and the whole arrange-toolbar CSS group (currently `~1149-1215`): the `.desk-arrange`, `.arr-btn`, `.arr-btn:hover`, `.arr-btn.active`, `.arr-btn:disabled`, `.arr-toggle`, `.arr-toggle:hover`, `.arr-toggle.on`, `.arr-knob`, `.arr-knob::after`, `.arr-toggle.on .arr-knob`, and `.arr-toggle.on .arr-knob::after` rules.
  Because `.desk-mid` is removed, ensure `.desk-world-wrap` still fills the shell: it already has `flex: 1` so as a direct child of the `display:flex; flex-direction:column` `.desk-shell` it expands correctly between the `CommandBar` and the `ActivityTicker`. Verify the `.desk-shell` rule (currently `~1084`) is `display: flex; flex-direction: column;` — it is; no change needed.

- [ ] **Step 7: Verify no dangling references to removed symbols.**
  ```bash
  cd /home/john/strange_rambling_svelte && grep -n "LeftFeed\|feedCollapsed\|feedSources\|synthesisRuns\|handleSelectRun\|desk-mid\|desk-arrange\|arr-btn\|arr-toggle\|arr-knob\|arr-label" src/lib/canvas/intelligence/ResearchDesk.svelte</parameter>
  ```
  Expected output: **no matches** (empty). If any line prints, it is a dangling reference — remove it. (The `arrange` state itself is intentionally NOT in this grep list; it survives until the layout milestone.)

- [ ] **Step 8: Run svelte-check (clean).**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check 2>&1 | tail -25
  ```
  Expected: completes with 0 errors in `ResearchDesk.svelte` and 0 errors in `FloatingFilters.svelte`. Common failure: an unused-import or unused-`function` warning for a symbol you partially removed — finish removing it. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 9: Run the existing desk test suite (no regressions).**
  The desk's co-located Vitest suite covers the pure layout/store logic this milestone does not touch; run it to confirm nothing regressed.
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk 2>&1 | tail -20
  ```
  Expected: all desk `*.test.ts` files pass (no new failures). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 10: Manual verification (deferred to prod walkthrough — cannot browser-verify here).**
  Record for the end-of-feature prod walkthrough on strangeramblings.com: open `/deepdive/<id>` and `/quickanswer/<id>`; confirm the left sidebar is gone and the desk world fills the full width under the command bar; a compact filter box is pinned top-left and stays put while panning/zooming (view-locked); toggling Sources/Facts/Entities/Challenges in the box shows/hides the matching cards (same behaviour the sidebar had); the GroupDim selector shows "Similarity / soon" and is disabled; the bottom ActivityTicker still renders. Then run the full `ship` flow (deploy + verify-live) per repo discipline — local-only visual checks waste cycles.

- [ ] **Step 11: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2 (M5): mount FloatingFilters, remove LeftFeed sidebar

Mount FloatingFilters as a view-locked sibling of the transformed
.desk-world (top-left), fed by typeFilters/counts/handleFilter. Remove
the LeftFeed sidebar, the now-single-child .desk-mid flex row, and the
old arrange-by-theme toolbar UI (the floating box owns the top-left
slot). Prune LeftFeed-only state (feedCollapsed/feedSources/
synthesisRuns/handleSelectRun) and their CSS. typeFilters/handleFilter/
visibleCards and the bottom ActivityTicker are retained; the arrange
layout logic survives until the pileLayout milestone.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```


I have everything needed. The `screenToWorld` in the desk must subtract `vp.left/vp.top` since the desk's `viewportEl` is `desk-world-wrap` (not full-screen). The +page.svelte `screenToWorld` already does this. The desk's existing zoom helpers use `cx/cy` relative to viewport rect, so I'll mirror the +page.svelte version exactly.

Now I'll write the milestone. I have all the verbatim code, types, paths, and insertion points.

## Milestone 6: Right-click NodePalette + node-type registration

> **Context for the executor (zero repo knowledge assumed).** This milestone brings the workflow-canvas "right-click → add node" menu onto the **embedded Research Desk** (`src/lib/canvas/intelligence/ResearchDesk.svelte`, mounted at `/deepdive/[id]` and `/quickanswer/[id]`), and registers two brand-new node types — `research-chat` and `research-report` — through the canvas node registry's *multiple* required lists. The full renderers for those two nodes are built in M7/M8; here you only add **placeholder** renderer branches so a node visibly appears when added. Desk nodes are **client-only ephemeral `$state`** — you MUST strip every server `addNode`/edge `POST`/`PATCH` call from the lifted code (the desk is session-scoped, not workflow-id-backed). Source of truth to lift FROM is `src/routes/jkai/canvas/[slug]/+page.svelte` ("the workflow canvas"). All design tokens (`--bg`, `--accent` = `#c4570a`, `--surface-elevated`, `--card-border`, `--divider`, `--text-primary`, `--font-mono`) are already global — introduce no new fonts/colors.
>
> **Key facts verified against current code (line refs may drift — match by content):**
> - `ResearchDesk.svelte` already owns a pan/zoom world: `panX`/`panY`/`zoom` `$state` (≈:598-600), `viewportEl: HTMLDivElement` bound to `.desk-world-wrap` (≈:879), `viewportW`/`viewportH` (≈:603-604), the transformed `.desk-world` child (≈:891). It does NOT yet have `screenToWorld`/`resolveOverlap`/palette state, nor any `NodePalette` mount.
> - The desk card loop is `{#each visibleCards as c (c.id)}` (≈:974). Desk cards are `DeskCard` objects from `store.svelte.ts` — that loop renders research artefacts and must remain untouched; the new ephemeral nodes get a **separate** `{#each deskNodes ...}` loop.
> - `NodePalette.svelte` (`src/lib/canvas/NodePalette.svelte`) is self-contained; its props are `{ open, anchor, mode, canvasNodes: {type:string}[], onPick, onClose }`. It pulls candidates from `allTypes()` (adapter), filters out `group === 'Annotations'`.
> - `adapter.ts` exports `NodeKind` union (≈:5-20), `CANVAS_NODE_TYPES` frozen array (≈:91), `mapTypeToKind()` (≈:978-1005), `byType()`/`allTypes()`.
> - Panels need registration in BOTH `src/lib/canvas/nodes/panels/registry.ts` (`specialized` map, ≈:89-150) AND the `SPECIALISED_PANEL_TYPES` Set in `+page.svelte` (≈:38-89). For the desk these panels won't actually be mounted in M6 (no inspector wiring on the desk yet), but they MUST be registered now so the types are first-class and M7/M8 can open them.
> - `KIND_COLOR` map lives in `+page.svelte` (≈:1055-1068) — add the two new kinds there too.
>
> **Scope guard:** the palette on the desk is scoped to a small **research** node set (the two new types + the existing intelligence family) via a `paletteGroupFilter`, NOT the full workflow palette. Do this by passing an explicit allow-list down to `NodePalette` (Task 4).

---

### Task 1: Add `research-chat` + `research-report` NodeKinds, palette entries, and `mapTypeToKind` cases in `adapter.ts`

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/adapter.ts`
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/adapter.research-nodes.test.ts`

- [ ] **Step 1: Write the failing test for the new registry entries + kind mapping.**

Create `/home/john/strange_rambling_svelte/src/lib/canvas/adapter.research-nodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { byType, mapTypeToKind, type NodeKind } from './adapter';

describe('research desk node types', () => {
  it('registers research-chat in CANVAS_NODE_TYPES', () => {
    const t = byType('research-chat');
    expect(t).toBeDefined();
    expect(t!.kind).toBe<NodeKind>('research-chat');
    expect(t!.group).toBe('Intelligence');
    expect(t!.label).toBe('Research Chat');
    // chat node: one text input (a trigger/wire), one text output
    expect(t!.handles.inputs.length).toBe(1);
    expect(t!.handles.outputs.length).toBe(1);
  });

  it('registers research-report in CANVAS_NODE_TYPES', () => {
    const t = byType('research-report');
    expect(t).toBeDefined();
    expect(t!.kind).toBe<NodeKind>('research-report');
    expect(t!.group).toBe('Intelligence');
    expect(t!.label).toBe('Research Report');
    expect(t!.handles.inputs.length).toBe(1);
    expect(t!.handles.outputs.length).toBe(1);
  });

  it('maps the new types to their dedicated kinds', () => {
    expect(mapTypeToKind('research-chat')).toBe<NodeKind>('research-chat');
    expect(mapTypeToKind('research-report')).toBe<NodeKind>('research-report');
  });

  it('exposes the new types via byType with a defaultConfig object', () => {
    expect(byType('research-chat')!.defaultConfig).toBeTypeOf('object');
    expect(byType('research-report')!.defaultConfig).toBeTypeOf('object');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails (types not registered yet).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/adapter.research-nodes.test.ts
```

Expected: failures like `expect(t).toBeDefined()` received `undefined` (byType returns undefined) and `mapTypeToKind` returns `'output'`. If Bash fails with EPERM/permission, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Add `'research-chat'` and `'research-report'` to the `NodeKind` union.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/adapter.ts`, the union currently ends:

```ts
  | 'builder'
  | 'postit'
  | 'annotation';
```

Replace with:

```ts
  | 'builder'
  | 'research-chat'
  | 'research-report'
  | 'postit'
  | 'annotation';
```

- [ ] **Step 4: Add the two palette entries to `CANVAS_NODE_TYPES`.**

In `adapter.ts`, find the `// ————————————————————————— Intelligence` section. Immediately after the `deep-research` entry (the one whose `defaultConfig` contains `depth: 'medium'`) and before the `// ————————————————————————— Intel & Web` comment, insert:

```ts
  {
    type: 'research-chat',
    label: 'Research Chat',
    kind: 'research-chat',
    group: 'Intelligence',
    description: 'Chat grounded in this research session — answers cite the session\'s facts and sources.',
    defaultConfig: { size: { w: 380, h: 460 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
  {
    type: 'research-report',
    label: 'Research Report',
    kind: 'research-report',
    group: 'Intelligence',
    description: 'Expandable report preview for this session, with regenerate + docx/markdown export.',
    defaultConfig: { size: { w: 420, h: 520 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'research-result', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
  },
```

- [ ] **Step 5: Add the two `mapTypeToKind` cases.**

In `adapter.ts`'s `mapTypeToKind`, the block currently reads:

```ts
  if (type === 'intelligence' || type === 'research-result') return 'intelligence';
  if (type === 'quick-answer') return 'intel';
  if (type === 'deep-research') return 'intel';
```

Replace with:

```ts
  if (type === 'intelligence' || type === 'research-result') return 'intelligence';
  if (type === 'research-chat') return 'research-chat';
  if (type === 'research-report') return 'research-report';
  if (type === 'quick-answer') return 'intel';
  if (type === 'deep-research') return 'intel';
```

- [ ] **Step 6: Re-run the test — confirm it passes.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/adapter.research-nodes.test.ts
```

Expected: `4 passed`. (Retry with `dangerouslyDisableSandbox: true` on EPERM.)

- [ ] **Step 7: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/adapter.ts src/lib/canvas/adapter.research-nodes.test.ts && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: register research-chat/research-report node types in adapter

Add two new NodeKinds, CANVAS_NODE_TYPES palette entries (Intelligence group),
and mapTypeToKind cases. Renderers/panels follow in later tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `KIND_COLOR` entries + `SPECIALISED_PANEL_TYPES` membership in the workflow canvas

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/routes/jkai/canvas/[slug]/+page.svelte`

This task keeps the workflow canvas's own colour/legend/minimap consistent for the new kinds (they share the registry), and pre-registers the panel types so the inspector resolver in M7/M8 finds them. No test (Svelte page module); verified by `svelte-check` in Task 6.

- [ ] **Step 1: Add the two new kinds to `KIND_COLOR`.**

In `+page.svelte`, the map currently ends:

```ts
    intelligence: '#5dbea3',
    builder: '#d28a3a',
  };
```

Replace with:

```ts
    intelligence: '#5dbea3',
    builder: '#d28a3a',
    'research-chat': 'var(--accent)',
    'research-report': '#7a6cd4',
  };
```

- [ ] **Step 2: Add the two types to `SPECIALISED_PANEL_TYPES`.**

In `+page.svelte`, the Set currently ends:

```ts
    'builder-chat',
    'builder-pi',
    'build-view',
  ]);
```

Replace with:

```ts
    'builder-chat',
    'builder-pi',
    'build-view',
    'research-chat',
    'research-report',
  ]);
```

- [ ] **Step 3: Type-check the page compiles.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -20
```

Expected: no NEW errors referencing `KIND_COLOR`, `SPECIALISED_PANEL_TYPES`, or the `[slug]/+page.svelte` lines you edited. (Pre-existing unrelated errors in other files, if any, are acceptable — note the baseline count.) Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add 'src/routes/jkai/canvas/[slug]/+page.svelte' && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: add research node KIND_COLOR + SPECIALISED_PANEL_TYPES

So the workflow canvas legend/minimap colour the new kinds and the inspector
resolver mounts their config panels.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Clone `DelayPanel` into two minimal config panels and register them

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/nodes/panels/ResearchChatPanel.svelte`
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/nodes/panels/ResearchReportPanel.svelte`
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/nodes/panels/registry.ts`

The config surface for these client-only nodes is minimal in v1 (a title label only). Cloned from `DelayPanel.svelte`'s shape (props `{ config, onChange, definition }`, raw-JSON disclosure, SR token styling) but stripped of the duration logic.

- [ ] **Step 1: Create `ResearchChatPanel.svelte`.**

```svelte
<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // Client-only desk node. The only editable field in v1 is a display title;
  // the chat thread + retrieval live in the in-graph renderer (M7).
  const title = $derived(typeof config.title === 'string' ? config.title : '');

  let showRawJson = $state(false);
  void definition;
</script>

<div class="rc">
  <section class="rc-sec">
    <label class="rc-field">
      <span class="rc-label">Title</span>
      <input
        type="text"
        placeholder="Research chat"
        value={title}
        oninput={(e) => onChange({ ...config, title: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <p class="rc-readout">Answers are grounded in this session's facts &amp; sources, with <code>[n]</code> citations.</p>
  </section>

  <details class="rc-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="rc-code"
      rows="8"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .rc { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .rc-sec { display: flex; flex-direction: column; gap: 8px; }
  .rc-field { display: flex; flex-direction: column; gap: 4px; }
  .rc-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .rc-readout { margin: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .rc-readout code { color: var(--accent); }
  .rc-code {
    width: 100%; padding: 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .rc-code:focus { border-color: var(--text-muted); }
  input[type='text'], textarea {
    width: 100%; padding: 6px 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font: inherit; box-sizing: border-box; outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
  .rc-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .rc-raw summary { cursor: pointer; }
</style>
```

- [ ] **Step 2: Create `ResearchReportPanel.svelte`.**

```svelte
<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // Client-only desk node. In v1 the only editable field is a display title;
  // the report preview + regenerate + export buttons live in the renderer (M8).
  const title = $derived(typeof config.title === 'string' ? config.title : '');
  const expanded = $derived(config.expanded === true);

  let showRawJson = $state(false);
  void definition;
</script>

<div class="rr">
  <section class="rr-sec">
    <label class="rr-field">
      <span class="rr-label">Title</span>
      <input
        type="text"
        placeholder="Research report"
        value={title}
        oninput={(e) => onChange({ ...config, title: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <label class="rr-check">
      <input
        type="checkbox"
        checked={expanded}
        onchange={(e) => onChange({ ...config, expanded: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span class="rr-label">Start expanded</span>
    </label>
    <p class="rr-readout">Previews this session's report; regenerate &amp; export wired in the node body.</p>
  </section>

  <details class="rr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="rr-code"
      rows="8"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .rr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .rr-sec { display: flex; flex-direction: column; gap: 8px; }
  .rr-field { display: flex; flex-direction: column; gap: 4px; }
  .rr-check { display: flex; align-items: center; gap: 8px; }
  .rr-check input { width: auto; }
  .rr-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .rr-readout { margin: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .rr-code {
    width: 100%; padding: 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .rr-code:focus { border-color: var(--text-muted); }
  input[type='text'], textarea {
    width: 100%; padding: 6px 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font: inherit; box-sizing: border-box; outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
  .rr-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .rr-raw summary { cursor: pointer; }
</style>
```

- [ ] **Step 3: Register both panels in `registry.ts`.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/nodes/panels/registry.ts`, add the imports after the existing `import AppleCalendarPanel from './AppleCalendarPanel.svelte';` line:

```ts
import ResearchChatPanel from './ResearchChatPanel.svelte';
import ResearchReportPanel from './ResearchReportPanel.svelte';
```

Then in the `specialized` map, the final two entries currently read:

```ts
  'build-view': BuildViewPanel as unknown as Component<PanelProps>,
  'apple-calendar': AppleCalendarPanel as unknown as Component<PanelProps>,
};
```

Replace with:

```ts
  'build-view': BuildViewPanel as unknown as Component<PanelProps>,
  'apple-calendar': AppleCalendarPanel as unknown as Component<PanelProps>,
  'research-chat': ResearchChatPanel as unknown as Component<PanelProps>,
  'research-report': ResearchReportPanel as unknown as Component<PanelProps>,
};
```

- [ ] **Step 4: Type-check the new panels + registry.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "ResearchChatPanel|ResearchReportPanel|registry.ts" ; echo "exit: ${PIPESTATUS[0]}"
```

Expected: no lines printed for the three files (no errors in them). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/nodes/panels/ResearchChatPanel.svelte src/lib/canvas/nodes/panels/ResearchReportPanel.svelte src/lib/canvas/nodes/panels/registry.ts && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: config panels for research-chat/research-report

Minimal DelayPanel-shaped panels (title field + raw-JSON disclosure), registered
in panels/registry.ts. Full renderers build in M7/M8.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Lift palette state + helpers into `ResearchDesk.svelte` (client-only, server calls STRIPPED)

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

This is the core lift. We add a client-only ephemeral node store (`deskNodes`), the lifted helpers (`screenToWorld`, `resolveOverlap`, `viewportCenterInWorld`), the palette state/handlers (`openPalette`/`closePalette`/`onPalettePick`), the `oncontextmenu` handler, and the `<NodePalette>` mount scoped to the research node set. **No `fetch` to `/api/workflows/...`** anywhere — `onPalettePick` mutates `deskNodes` in memory only.

- [ ] **Step 1: Add imports + the ephemeral node type + palette `$state`.**

In `ResearchDesk.svelte`, the `<script>` import list currently includes (near the top):

```ts
  import { onMount } from 'svelte';
  import ArtefactCard from './desk/ArtefactCard.svelte';
```

Insert after the `import { onMount } from 'svelte';` line:

```ts
  import NodePalette, { type Mode as PaletteMode } from '$lib/canvas/NodePalette.svelte';
  import { byType as byNodeType, mapTypeToKind, type NodeKind } from '$lib/canvas/adapter';
```

- [ ] **Step 2: Add the client-only node model + palette state.**

Find the pan/zoom block — it begins with the comment `// ——— pan/zoom ———` and the lines:

```ts
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
```

Immediately ABOVE the `// ——— pan/zoom ———` comment, insert:

```ts
  // ——— client-only desk nodes (research-chat / research-report) ———
  // The Research Desk is session-scoped, NOT workflow-id-backed, so these nodes
  // are ephemeral $state — created on right-click, never persisted to the
  // workflow_nodes table (no /api/workflows/<id>/nodes POST). Positions live in
  // world-space alongside the artefact cards.
  type DeskNode = {
    id: string;
    type: string; // adapter node type, e.g. 'research-chat'
    kind: NodeKind;
    x: number;
    y: number;
    config: Record<string, unknown>;
  };
  let deskNodes = $state.raw<DeskNode[]>([]);
  let selectedNodeId = $state<string | null>(null);

  // Which node types the desk palette offers — scoped to the research set, not
  // the full workflow palette.
  const DESK_PALETTE_TYPES = [
    'research-chat',
    'research-report',
    'intelligence',
    'research-result',
  ];
```

- [ ] **Step 3: Add the lifted geometry helpers.**

The desk has no `screenToWorld`/`resolveOverlap`/`viewportCenterInWorld` yet. Find the existing `zoomCentered` helper (it contains `const vp = viewportEl?.getBoundingClientRect();`). Immediately AFTER the closing `}` of `zoomCentered`, insert:

```ts
  // ——— lifted from the workflow canvas (screen↔world + overlap avoidance) ———
  const DESK_NODE_W = 200;
  const DESK_NODE_H = 120;

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    if (!viewportEl) return { x: 0, y: 0 };
    const vp = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - vp.left - panX) / zoom,
      y: (clientY - vp.top - panY) / zoom,
    };
  }

  function viewportCenterInWorld(): { x: number; y: number } {
    if (!viewportEl) return { x: 320, y: 120 };
    const vp = viewportEl.getBoundingClientRect();
    const cx = (vp.width / 2 - panX) / zoom;
    const cy = (vp.height / 2 - panY) / zoom;
    const x = Math.round((cx - DESK_NODE_W / 2) / 20) * 20;
    const y = Math.round((cy - DESK_NODE_H / 2) / 20) * 20;
    return { x, y };
  }

  // Nudge a new node off any existing node so they don't stack exactly.
  function resolveOverlap(p: { x: number; y: number }): { x: number; y: number } {
    let { x, y } = p;
    const limit = 20;
    for (let i = 0; i < limit; i++) {
      const clashes = deskNodes.some((n) => Math.hypot(n.x - x, n.y - y) < 40);
      if (!clashes) return { x, y };
      x += 24;
      y += 24;
    }
    return { x, y };
  }
```

> Note: `resolveOverlap` in the desk only checks the ephemeral `deskNodes` (artefact cards have their own packing). This is the deliberate strip of the workflow canvas's `canvas?.nodes` reference.

- [ ] **Step 4: Add palette state + handlers — with the server `addNode`/edge calls STRIPPED.**

Immediately AFTER the `resolveOverlap` function you just added, insert:

```ts
  // ——— node palette (right-click → add node) ———
  // Lifted from src/routes/jkai/canvas/[slug]/+page.svelte, but the server
  // addNode (POST /api/workflows/<id>/nodes) and edge POST are REMOVED: desk
  // nodes are client-only ephemeral $state (decision §2.1).
  let paletteOpen = $state(false);
  let paletteAnchor = $state<{ x: number; y: number } | 'center'>('center');
  let paletteMode = $state<PaletteMode>({ kind: 'workflow-ranked' });
  let palettePositionOverride = $state<{ x: number; y: number } | null>(null);

  function openPalette(opts: {
    anchor: { x: number; y: number } | 'center';
    mode: PaletteMode;
    worldPosition?: { x: number; y: number } | null;
  }) {
    if (readonly || deskMode === 'quick') return;
    paletteAnchor = opts.anchor;
    paletteMode = opts.mode;
    palettePositionOverride = opts.worldPosition ?? null;
    paletteOpen = true;
  }
  function closePalette() {
    paletteOpen = false;
    palettePositionOverride = null;
  }

  function onPalettePick(type: string) {
    const meta = byNodeType(type);
    if (!meta) {
      closePalette();
      return;
    }
    const worldPos = palettePositionOverride ?? viewportCenterInWorld();
    const placement = resolveOverlap(worldPos);
    const id = `desknode-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const node: DeskNode = {
      id,
      type: meta.type,
      kind: mapTypeToKind(meta.type),
      x: placement.x,
      y: placement.y,
      config: { ...(meta.defaultConfig as Record<string, unknown>) },
    };
    deskNodes = [...deskNodes, node];
    selectedNodeId = id;
    closePalette();
  }

  // The candidate list NodePalette consumes — scoped to the research set above.
  const palettePickTypes = $derived(DESK_PALETTE_TYPES.map((t) => ({ type: t })));
```

> **`NodePalette` candidate-scoping clarification:** `NodePalette.svelte` builds its visible list from `allTypes()` internally (not from the `canvasNodes` prop — that prop is only used for handle-compatibility ranking). To genuinely *restrict* what the desk palette shows, we filter inside `onPalettePick` is NOT enough — Step 6 wires a `restrictTypes` prop. Proceed to Step 5 and 6 first; this `palettePickTypes` derived feeds the `canvasNodes` prop for ranking continuity.

- [ ] **Step 5: Type-check after the script additions.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep "ResearchDesk.svelte" ; echo "exit ok"
```

Expected: zero `ResearchDesk.svelte` lines printed (no errors), OR only an "unused `palettePickTypes`/`selectedNodeId`/`NodePalette`" hint that the next steps consume — those are warnings, not errors, and `--threshold error` suppresses them. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 6: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: lift palette state + screenToWorld/resolveOverlap (client-only)

Add ephemeral deskNodes $state, openPalette/closePalette/onPalettePick, and
geometry helpers. Server addNode/edge POST stripped — desk nodes never persist.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add `restrictTypes` scoping to `NodePalette`, the `oncontextmenu` handler, the `<NodePalette>` mount, and placeholder renderer branches

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/NodePalette.svelte`
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Add an optional `restrictTypes` prop to `NodePalette.svelte` so the desk can scope it.**

In `/home/john/strange_rambling_svelte/src/lib/canvas/NodePalette.svelte`, the props type currently reads:

```ts
  type Props = {
    open: boolean;
    anchor: { x: number; y: number } | 'center';
    mode: Mode;
    canvasNodes: { type: string }[];
    onPick: (type: string) => void;
    onClose: () => void;
  };

  let { open, anchor, mode, canvasNodes, onPick, onClose }: Props = $props();
```

Replace with:

```ts
  type Props = {
    open: boolean;
    anchor: { x: number; y: number } | 'center';
    mode: Mode;
    canvasNodes: { type: string }[];
    onPick: (type: string) => void;
    onClose: () => void;
    /**
     * Optional allow-list of node `type`s. When provided, the palette only
     * offers these types (used by the Research Desk to scope to the research
     * node set). When omitted, all non-Annotation types are offered.
     */
    restrictTypes?: string[];
  };

  let { open, anchor, mode, canvasNodes, onPick, onClose, restrictTypes }: Props = $props();
```

Then the `allCandidates` derived currently reads:

```ts
  const allCandidates: CandidateType[] = $derived(
    allTypes()
      // Annotation primitives (post-it, annotation box) live on the canvas
      // toolbar, not in the DAG palette — they're inert decoration, not nodes.
      .filter((t) => t.group !== 'Annotations')
      .map((t) => ({
        type: t.type,
        handles: t.handles,
        defaultWeight: t.defaultWeight ?? 0,
      }))
  );
```

Replace with:

```ts
  const allCandidates: CandidateType[] = $derived(
    allTypes()
      // Annotation primitives (post-it, annotation box) live on the canvas
      // toolbar, not in the DAG palette — they're inert decoration, not nodes.
      .filter((t) => t.group !== 'Annotations')
      // Optional allow-list (Research Desk scopes to its research node set).
      .filter((t) => !restrictTypes || restrictTypes.includes(t.type))
      .map((t) => ({
        type: t.type,
        handles: t.handles,
        defaultWeight: t.defaultWeight ?? 0,
      }))
  );
```

> The workflow canvas mount (`+page.svelte`) does not pass `restrictTypes`, so it is `undefined` there and behaviour is unchanged.

- [ ] **Step 2: Add the `oncontextmenu` handler to the desk's viewport element.**

In `ResearchDesk.svelte`, the `.desk-world-wrap` element currently has these handlers:

```svelte
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onwheel={onWheel}
    >
```

Replace with:

```svelte
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onwheel={onWheel}
      oncontextmenu={(e) => {
        if (readonly || deskMode === 'quick') return;
        const target = e.target as HTMLElement;
        // Don't hijack right-clicks landing on a card or an existing desk node.
        if (target.closest('.desk-card-host, .desk-node-host')) return;
        e.preventDefault();
        const world = screenToWorld(e.clientX, e.clientY);
        openPalette({
          anchor: { x: e.clientX, y: e.clientY },
          mode: { kind: 'workflow-ranked' },
          worldPosition: world,
        });
      }}
    >
```

- [ ] **Step 3: Add the placeholder renderer loop for `deskNodes` inside the world layer.**

The artefact-card loop ends with:

```svelte
            </CardLiveWrapper>
          </div>
        {/each}
      </div>
```

That trailing `</div>` closes `.desk-world`. Insert the new node loop BEFORE that closing `</div>` — i.e. between the `{/each}` and the `</div>`:

```svelte
            </CardLiveWrapper>
          </div>
        {/each}

        <!-- client-only desk nodes (research-chat / research-report) — placeholder
             frames in M6; full renderers branch here in M7/M8. -->
        {#each deskNodes as n (n.id)}
          <div
            class="desk-node-host"
            class:is-selected={selectedNodeId === n.id}
            style:transform="translate({n.x}px, {n.y}px)"
            data-kind={n.kind}
            role="button"
            tabindex="0"
            onpointerdown={(e) => { e.stopPropagation(); selectedNodeId = n.id; }}
          >
            <span class="desk-node-bar" style:background={n.kind === 'research-chat' ? 'var(--accent)' : '#7a6cd4'}></span>
            <div class="desk-node-body">
              {#if n.kind === 'research-chat'}
                <span class="desk-node-label">Research Chat</span>
                <span class="desk-node-hint">grounded chat · M7</span>
              {:else if n.kind === 'research-report'}
                <span class="desk-node-label">Research Report</span>
                <span class="desk-node-hint">report preview · M8</span>
              {:else}
                <span class="desk-node-label">{byNodeType(n.type)?.label ?? n.type}</span>
                <span class="desk-node-hint">{n.type}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
```

- [ ] **Step 4: Mount `<NodePalette>` at the end of the component, scoped to the research set.**

Find the end of the top-level `.desk-shell` markup. The component's root element opens with `<div class="desk-shell" class:embedded>`; locate its matching closing `</div>` (the last top-level closing tag before `<style>`). Immediately AFTER that closing `</div>` (and before `<style>`), insert:

```svelte
<NodePalette
  open={paletteOpen}
  anchor={paletteAnchor}
  mode={paletteMode}
  canvasNodes={palettePickTypes}
  restrictTypes={DESK_PALETTE_TYPES}
  onPick={onPalettePick}
  onClose={closePalette}
/>
```

> If you cannot unambiguously identify the closing `</div>`, run `grep -n "^</div>\|^<style>" src/lib/canvas/intelligence/ResearchDesk.svelte` — the `<NodePalette>` block goes on the line directly before `<style>`.

- [ ] **Step 5: Add the placeholder node CSS.**

In `ResearchDesk.svelte`'s `<style>` block, append these rules at the end (just before the final closing `</style>`):

```css
  .desk-node-host {
    position: absolute;
    top: 0;
    left: 0;
    min-width: 180px;
    display: flex;
    align-items: stretch;
    background: var(--surface-elevated);
    border: 1.5px solid var(--card-border);
    border-radius: 2px;
    overflow: hidden;
    cursor: grab;
    user-select: none;
  }
  .desk-node-host.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 0;
  }
  .desk-node-bar {
    width: 3px;
    flex: 0 0 3px;
  }
  .desk-node-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
  }
  .desk-node-label {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
  .desk-node-hint {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
```

- [ ] **Step 6: Type-check the whole edit.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "ResearchDesk.svelte|NodePalette.svelte" ; echo "done"
```

Expected: no lines printed for either file (zero errors). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 7: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/NodePalette.svelte src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: right-click palette + placeholder node renderers on the desk

Add restrictTypes scoping to NodePalette, wire oncontextmenu on the desk
viewport, render ephemeral deskNodes as placeholder frames (full renderers in
M7/M8), and mount the scoped palette.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification — type-check, unit tests, and manual E2E on the running desk

**Files:** none (verification only).

- [ ] **Step 1: Run the adapter unit test (regression guard).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/adapter.research-nodes.test.ts
```

Expected: `4 passed`. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 2: Run a full `svelte-check` and confirm no NEW errors vs. baseline.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -25
```

Expected: the summary line (`svelte-check found N errors`) shows no errors in any file you touched this milestone: `adapter.ts`, `+page.svelte`, `registry.ts`, `ResearchChatPanel.svelte`, `ResearchReportPanel.svelte`, `NodePalette.svelte`, `ResearchDesk.svelte`. Pre-existing unrelated errors elsewhere are acceptable; if `N` increased relative to before M6, fix the regression before proceeding. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 3: Start the dev server (background) and wait until it is listening.**

```bash
cd /home/john/strange_rambling_svelte && npm run dev > /tmp/m6-dev.log 2>&1 &
```

Then poll until ready (do NOT use a bare `sleep`):

```bash
cd /home/john/strange_rambling_svelte && for i in $(seq 1 30); do grep -q "Local:" /tmp/m6-dev.log && break; done; grep -E "Local:|error" /tmp/m6-dev.log | head
```

Expected: a `Local: http://localhost:5173/` line. If the dev start fails under the sandbox, retry the `npm run dev` line with `dangerouslyDisableSandbox: true`.

- [ ] **Step 4: Manual verification (the executor performs these in a browser — John is on the same LAN, so use `http://homeserv:5173`).**

Open an existing deep-research session in the embedded desk: navigate to `http://homeserv:5173/deepdive/<an existing session id>` (find one via `/jkai/research` history, or any `/deepdive/...` link). Confirm ALL of:

1. **Right-click on empty desk space** (not on a card) opens the NodePalette at the cursor, styled as the warm-brutalist box (`--surface-elevated` bg, hard 6px shadow, mono search field).
2. The palette shows **only** the scoped research set: `Research Chat`, `Research Report`, `Intelligence`, `Research Result` — and NOT the full workflow node list (no `Delay`, `Gmail`, `HTTP Request`, etc.).
3. **Picking "Research Chat"** closes the palette and drops a placeholder node at the right-click position with an accent (`#c4570a`) left bar, the label "Research Chat", and the hint "grounded chat · M7".
4. **Picking "Research Report"** drops a node with a purple (`#7a6cd4`) left bar, label "Research Report", hint "report preview · M8".
5. Adding a second node near the first **offsets it** (resolveOverlap) so they don't perfectly stack.
6. **Panning/zooming** the desk moves the placeholder nodes WITH the world (they live inside `.desk-world`), and a node stays put across pan (its world position is fixed).
7. Clicking a node gives it the **accent selection outline** (`.is-selected`).
8. Right-clicking **on** a placeholder node or an artefact card does NOT open the palette (the `closest('.desk-card-host, .desk-node-host')` guard).
9. On a **read-only** or **quick** session (`/quickanswer/<id>`), right-click does NOT open the palette (the `readonly || deskMode === 'quick'` guard).
10. Reloading the page **clears** the added nodes (they are ephemeral client-only state — expected for v1).

Record PASS/FAIL for each numbered item in the task report. All must PASS.

- [ ] **Step 5: Stop the dev server.**

```bash
pkill -f "vite dev" || pkill -f "npm run dev" || true
```

- [ ] **Step 6: Commit (verification log only — no code).**

If Steps 1-2 required any follow-up fixes, they were committed in their own task above. This milestone introduces no code in Task 6, so there is nothing to commit here unless a regression fix was applied. If a fix WAS applied, commit it:

```bash
cd /home/john/strange_rambling_svelte && git add -A && git commit -m "$(cat <<'EOF'
Research Desk v2 M6: verification fixes (svelte-check / manual E2E)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

If `git status` is clean (no fixes needed), skip the commit — M6 is complete.

---

**Milestone 6 done-when:** `adapter.research-nodes.test.ts` is green; `svelte-check` shows no new errors in the seven touched files; right-clicking the embedded Research Desk opens a research-scoped NodePalette; picking `research-chat`/`research-report` drops a styled placeholder node (client-only, world-anchored, overlap-avoiding, selectable), guarded off on readonly/quick sessions. Full chat (M7) and report (M8) renderers replace the placeholder branches next.


I have everything I need. M7 builds `ResearchChatNode.svelte` and wires it as the `research-chat` node's renderer (replacing M6's placeholder). The chat endpoint and node registration come from earlier milestones; M7 consumes the `POST /api/deepdive/[id]/chat` contract. Let me check how M6's desk-node store/loop is expected to pass props (nodeId, kind) so the renderer interface matches, by inspecting the existing default node template approach — but since M6 is a sibling milestone in the same plan, I'll reference its established structure (desk-node `{#each deskNodes}` with `n.config.sessionId` falling back to the desk `sessionId`). 

I now have enough real-code grounding to write M7 exhaustively. Here is the milestone.

## Milestone 7: Research chat node renderer

> **Context for the executing engineer (read first).** This milestone builds the in-graph chat renderer for the `research-chat` node type and wires it as that node's renderer on the Research Desk, replacing the placeholder branch added in Milestone 6. By the time you start this milestone the following already exist (do not re-create them):
> - The `POST /api/deepdive/[id]/chat` SSE-over-POST endpoint (Milestone — backend), which streams `data:{type:'sources',sources}`, then `data:{type:'token',token}` frames, then `data:{type:'done'}`. Body is `{ question, history? }`.
> - The `research-chat` node type registered in `src/lib/canvas/adapter.ts` `CANVAS_NODE_TYPES`, its `NodeKind`, `KIND_COLOR`, `mapTypeToKind` entry, its cloned config panel, and a **client-only desk-node store** holding ephemeral nodes (created by Milestone 6 when lifting `NodePalette` into `ResearchDesk.svelte`).
> - A desk-node `{#each}` loop in `src/lib/canvas/intelligence/ResearchDesk.svelte` (added by Milestone 6) that renders each ephemeral node and currently shows a **placeholder** `{:else if n.type === 'research-chat'}` branch (a stub div reading "Chat node — renderer pending").
>
> If the placeholder branch in `ResearchDesk.svelte` does not yet exist (Milestone 6 incomplete), STOP and complete Milestone 6 first — M7 only swaps the renderer.
>
> **Real-code anchors confirmed by reading the repo (line refs may have drifted — re-confirm by content):**
> - SSE-over-POST reader pattern: `src/routes/projects/policy-engine/components/AskModel.svelte` (the `res.body.getReader()` + `TextDecoder` + `buf.split('\n\n')` + `data:`-frame loop, ~lines 84–125). Note its footgun comment: hydration is done in `onMount`, NOT an `$effect` that both reads and writes `messages`.
> - Markdown rendering: `src/lib/canvas/ChatMarkdown.svelte` — exports `renderMarkdown(src)` from a `<script module>` and a default component taking `{ content, role }`. It already calls `sanitizeChatHtml`.
> - Sanitiser: `src/lib/security/sanitize-chat.ts` — `sanitizeChatHtml(html)` (allows `sup`? **No** — `sup` is NOT in `allowedTags`). Citation chips must therefore be rendered as Svelte elements, NOT injected as HTML through the markdown/sanitiser path.
> - Renderer-as-flex-child pattern + token vocabulary: `src/lib/canvas/intelligence/ResearchResultNode.svelte` (the `.rr-root { flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; }` discipline, `--font-mono`, `--bg`, `--text-primary`, `--divider`, `--text-muted` usage).
> - The desk passes `sessionId` as a prop (`src/lib/canvas/intelligence/ResearchDesk.svelte` `$props` block).
>
> **Svelte 5 footguns (mandatory):**
> - The `reader` (`ReadableStreamDefaultReader`) and `AbortController` are **plain `let`**, never `$state`. Never read a `$state`-held stream handle from inside an `$effect` (triggers `effect_update_depth_exceeded` — see `feedback_svelte5_state_in_effect_loop.md`).
> - Reassign `messages = [...messages]` after each mutation to trigger reactivity (mirror AskModel).
> - Hydrate/scroll in `onMount` or event handlers, never an `$effect` that reads+writes `messages`.

---

### Task 1: Pure helper for SSE frame parsing + message accumulation (TDD)

Extract the per-frame parse/accumulate logic into a pure, tested module so the streaming reducer is verified independently of the DOM. The Svelte component will call these helpers.

**Files:**
- Create: `src/lib/canvas/intelligence/desk/chatStream.ts`
- Create: `src/lib/canvas/intelligence/desk/chatStream.test.ts`

- [ ] **Step 1: Write the failing test first.** Create `src/lib/canvas/intelligence/desk/chatStream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseSseFrames,
  type ChatFrame,
  type ChatSource,
  applyFrame,
  type ChatMessage,
} from './chatStream';

describe('parseSseFrames', () => {
  it('splits a buffer on blank lines and keeps the trailing partial', () => {
    const buf =
      'data: {"type":"token","token":"He"}\n\n' +
      'data: {"type":"token","token":"llo"}\n\n' +
      'data: {"type":"to';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toEqual([
      { type: 'token', token: 'He' },
      { type: 'token', token: 'llo' },
    ]);
    expect(rest).toBe('data: {"type":"to');
  });

  it('ignores non-data lines and malformed JSON', () => {
    const buf =
      ': keep-alive comment\n\n' +
      'data: not-json\n\n' +
      'data: {"type":"done"}\n\n';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toEqual([{ type: 'done' }]);
    expect(rest).toBe('');
  });

  it('parses a sources frame', () => {
    const src: ChatSource[] = [{ n: 1, title: 'A study', domain: 'gov.uk', url: 'https://gov.uk/x' }];
    const buf = `data: ${JSON.stringify({ type: 'sources', sources: src })}\n\n`;
    const { frames } = parseSseFrames(buf);
    expect(frames).toEqual([{ type: 'sources', sources: src }]);
  });
});

describe('applyFrame', () => {
  const baseAssistant = (): ChatMessage => ({ role: 'assistant', content: '', sources: undefined });

  it('appends a token to the assistant content', () => {
    const msg = baseAssistant();
    applyFrame(msg, { type: 'token', token: 'Hi' });
    applyFrame(msg, { type: 'token', token: ' there' });
    expect(msg.content).toBe('Hi there');
  });

  it('stashes sources without touching content', () => {
    const msg = baseAssistant();
    const sources: ChatSource[] = [{ n: 2, title: 'T', domain: 'd', url: null }];
    applyFrame(msg, { type: 'sources', sources });
    expect(msg.sources).toEqual(sources);
    expect(msg.content).toBe('');
  });

  it('appends an error note in italics', () => {
    const msg = baseAssistant();
    applyFrame(msg, { type: 'error', message: 'rate limited' } as ChatFrame);
    expect(msg.content).toContain('rate limited');
  });

  it('done is a no-op on content/sources', () => {
    const msg = baseAssistant();
    msg.content = 'final';
    applyFrame(msg, { type: 'done' });
    expect(msg.content).toBe('final');
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails (module missing).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/chatStream.test.ts
```
Expected: failure with `Failed to resolve import "./chatStream"` (or "Cannot find module"). If the Bash tool reports `EPERM`/permission, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 3: Implement the module to make the test pass.** Create `src/lib/canvas/intelligence/desk/chatStream.ts`:

```ts
// Pure, DOM-free helpers for the research-chat node's SSE-over-POST stream.
// Frames arrive as `data: {json}\n\n`; see POST /api/deepdive/[id]/chat which
// emits {type:'sources'}, then {type:'token'} per delta, then {type:'done'}.

export interface ChatSource {
  n: number;
  title: string;
  domain: string;
  url: string | null;
}

export type ChatFrame =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'token'; token: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

/**
 * Split an accumulated decode buffer on the SSE record separator ("\n\n").
 * Returns the parsed `data:` frames and the trailing partial record (`rest`)
 * to carry into the next read. Non-`data:` lines and malformed JSON are dropped.
 */
export function parseSseFrames(buffer: string): { frames: ChatFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: ChatFrame[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data:')) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (evt && typeof evt === 'object' && typeof (evt as { type?: unknown }).type === 'string') {
      frames.push(evt as ChatFrame);
    }
  }
  return { frames, rest };
}

/**
 * Mutate a single (assistant) message in place from one frame. The component
 * is responsible for reassigning `messages = [...messages]` afterwards so
 * Svelte 5 reactivity fires.
 */
export function applyFrame(msg: ChatMessage, frame: ChatFrame): void {
  switch (frame.type) {
    case 'token':
      msg.content += frame.token;
      break;
    case 'sources':
      msg.sources = frame.sources;
      break;
    case 'error':
      msg.content += `\n\n_(${frame.message})_`;
      break;
    case 'done':
    default:
      break;
  }
}
```

- [ ] **Step 4: Run the test — confirm it passes.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/chatStream.test.ts
```
Expected: `Test Files  1 passed (1)` and `Tests  N passed` (all green). Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/chatStream.ts src/lib/canvas/intelligence/desk/chatStream.test.ts && git commit -m "$(cat <<'EOF'
M7 task 1: pure SSE frame parse + message accumulation helpers for research-chat node

Extracts parseSseFrames + applyFrame (DOM-free, tested) so the streaming
reducer is verified independently of Svelte. Consumed by ResearchChatNode.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Build `desk/ResearchChatNode.svelte` (in-graph chat thread renderer)

Build the chat-thread component bound to the desk's `sessionId`. It POSTs to `/api/deepdive/[id]/chat`, reads the SSE-over-POST stream, renders assistant messages via `ChatMarkdown`, and shows citation chips from the `sources` frame. Warm-brutalist styling using the global SR tokens.

**Files:**
- Create: `src/lib/canvas/intelligence/desk/ResearchChatNode.svelte`

- [ ] **Step 1: Define the component interface.** The desk-node `{#each}` (M6) renders this as a direct flex child of the node frame, exactly like `ResearchResultNode.svelte` is rendered. Props:

```ts
let {
  sessionId,
  nodeId,
  readonly = false,
} = $props<{
  sessionId: string;   // the desk's session (deepdive id). The chat endpoint is /api/deepdive/{sessionId}/chat
  nodeId: string;      // for stable keys / future per-node persistence
  readonly?: boolean;  // when true, hide the composer (deep-readonly embed)
}>();
```

- [ ] **Step 2: Write the complete component.** Create `src/lib/canvas/intelligence/desk/ResearchChatNode.svelte`:

```svelte
<!--
  ResearchChatNode — in-graph chat thread for the research-chat desk node.
  Bound to the desk's sessionId; grounds answers in the session's facts/sources
  via POST /api/deepdive/[id]/chat (SSE-over-POST). Rendered as a DIRECT flex
  child of the desk node frame (position:absolute; display:flex; column;
  overflow:hidden) — so .rc-root must be flex:1; min-height:0; no position here.

  Svelte 5 footguns honoured:
   - `reader` and `abort` are plain `let`, never $state (never read a $state
     stream handle from an $effect → effect_update_depth_exceeded).
   - messages are reassigned (messages = [...messages]) to fire reactivity.
   - scrolling happens in handlers / queueMicrotask, never an $effect that
     reads+writes messages.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import { parseSseFrames, applyFrame, type ChatMessage, type ChatSource } from './chatStream';

  let {
    sessionId,
    nodeId,
    readonly = false,
  } = $props<{
    sessionId: string;
    nodeId: string;
    readonly?: boolean;
  }>();

  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let busy = $state(false);
  let errorText = $state<string | null>(null);
  let scrollEl: HTMLDivElement | undefined;

  // Plain lets — NOT $state. Read only inside handlers, never inside an $effect.
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let abort: AbortController | null = null;

  const SUGGESTIONS = [
    'Summarise the strongest findings in this session.',
    'What do the sources disagree about?',
    'Which claims are weakest / least supported?',
  ];

  function scrollToEnd() {
    queueMicrotask(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));
  }

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy || readonly) return;
    input = '';
    errorText = null;
    messages = [...messages, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    const aIdx = messages.length - 1;
    busy = true;
    scrollToEnd();

    abort = new AbortController();
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          question,
          history: messages
            .slice(0, aIdx - 1)
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        messages[aIdx].content =
          res.status === 429
            ? 'Too many questions — give it a moment.'
            : `Sorry, that didn't go through (${res.status}).`;
        messages = [...messages];
        return;
      }

      reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buf);
        buf = rest;
        for (const frame of frames) {
          applyFrame(messages[aIdx], frame);
        }
        if (frames.length) {
          messages = [...messages];
          scrollEl?.scrollTo({ top: scrollEl.scrollHeight });
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        messages[aIdx].content ||= 'Sorry — the connection dropped. Please try again.';
        messages = [...messages];
      }
    } finally {
      reader = null;
      abort = null;
      busy = false;
      scrollToEnd();
    }
  }

  function stop() {
    abort?.abort();
  }

  function clearChat() {
    if (busy) return;
    messages = [];
    errorText = null;
  }

  // Cancel any in-flight stream when the node unmounts (drag-delete, route change).
  onDestroy(() => {
    abort?.abort();
    reader?.cancel().catch(() => {});
  });

  function srcLabel(s: ChatSource): string {
    return s.domain || s.title || `source ${s.n}`;
  }
</script>

<div class="rc-root" data-node={nodeId}>
  <div class="rc-header">
    <span class="kind-bar"></span>
    <span class="title">Research chat</span>
    {#if busy}
      <button type="button" class="rc-stop" onclick={stop}>stop</button>
    {:else if messages.length}
      <button type="button" class="rc-clear" onclick={clearChat}>clear</button>
    {/if}
  </div>

  <div class="rc-scroll" bind:this={scrollEl}>
    {#if messages.length === 0}
      <div class="rc-intro">
        <p class="rc-lede">
          Ask about <b>this research session</b>. Answers are grounded in its facts and sources,
          with citations shown. It only answers from this session's corpus.
        </p>
        {#if !readonly}
          <div class="rc-suggest">
            {#each SUGGESTIONS as s}
              <button type="button" class="sg" onclick={() => send(s)}>{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#each messages as m, i (i)}
      <div class="msg {m.role}">
        <span class="role">{m.role === 'user' ? 'You' : 'Research'}</span>
        {#if m.content}
          {#if m.role === 'assistant'}
            <div class="body"><ChatMarkdown content={m.content} role="assistant" /></div>
          {:else}
            <div class="body plain">{m.content}</div>
          {/if}
        {:else if busy}
          <div class="body thinking"><span></span><span></span><span></span></div>
        {/if}
        {#if m.sources?.length}
          <div class="sources">
            <span class="src-lab">Sources</span>
            {#each m.sources as s (s.n)}
              {#if s.url}
                <a class="src" href={s.url} target="_blank" rel="noopener noreferrer"
                   title={s.title}>{s.n}. {srcLabel(s)}</a>
              {:else}
                <span class="src" title={s.title}>{s.n}. {srcLabel(s)}</span>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if !readonly}
    <form class="rc-input" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <input
        type="text"
        bind:value={input}
        placeholder="Ask this session…"
        disabled={busy}
        aria-label="Ask the research session"
      />
      <button type="submit" class="ask" disabled={busy || !input.trim()}>{busy ? '…' : 'Ask'}</button>
    </form>
  {/if}
</div>

<style>
  /* Direct flex child of the desk node frame: fill it, no position:absolute here. */
  .rc-root {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-elevated);
    color: var(--text-primary);
    font-family: var(--font-mono);
  }
  .rc-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .kind-bar { width: 3px; align-self: stretch; background: var(--accent); flex-shrink: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rc-stop, .rc-clear {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: 10px;
    padding: 0 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .rc-stop:hover, .rc-clear:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .rc-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
  }
  .rc-intro { padding: 2px; }
  .rc-lede {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 56ch;
  }
  .rc-suggest { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .sg {
    text-align: left;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 6px 9px;
    cursor: pointer;
  }
  .sg:hover { border-color: var(--accent); color: var(--accent); }

  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg .role {
    font-family: var(--font-mono);
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .msg.user .role { color: var(--accent); }
  .msg .body { font-size: 12px; line-height: 1.45; color: var(--text-primary); }
  .msg .body.plain { white-space: pre-wrap; word-break: break-word; color: var(--text-primary); }

  .thinking { display: flex; gap: 4px; padding: 4px 0; }
  .thinking span {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-muted);
    animation: rc-bounce 1.2s infinite ease-in-out;
  }
  .thinking span:nth-child(2) { animation-delay: 0.15s; }
  .thinking span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes rc-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-4px); opacity: 1; }
  }

  .sources {
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    margin-top: 4px; padding-top: 6px;
    border-top: 1px solid var(--divider);
  }
  .src-lab {
    font-family: var(--font-mono);
    font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted); margin-right: 2px;
  }
  .src {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 1px 6px;
    text-decoration: none;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.src:hover { border-color: var(--accent); color: var(--accent); }

  .rc-input {
    display: flex; gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--divider);
    flex-shrink: 0;
  }
  .rc-input input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 7px 9px;
    outline: none;
  }
  .rc-input input:focus { border-color: var(--accent); }
  .ask {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--bg);
    background: var(--accent);
    border: none;
    border-radius: 4px;
    padding: 7px 14px;
    cursor: pointer;
  }
  .ask:disabled { opacity: 0.5; cursor: default; }
</style>
```

> **Note on citation chips vs. the sanitiser:** `sanitize-chat.ts` does **not** allow `<sup>`, so citation chips are rendered as Svelte `.src` chips from the `sources` frame (above) — NOT injected into the markdown HTML. Inline `[n]` markers inside the assistant text remain plain text through `ChatMarkdown`, which is correct: the chips below the message are the authoritative citation surface.

- [ ] **Step 3: Type-check the new component in isolation (fast feedback).** `svelte-check` runs over the whole project, so the meaningful check is "no NEW errors referencing ResearchChatNode/chatStream":

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -iE "ResearchChatNode|chatStream" || echo "NO ResearchChatNode/chatStream errors"
```
Expected: `NO ResearchChatNode/chatStream errors`. If `svelte-check` itself OOMs, the `NODE_OPTIONS` env above is required (per `reference_svelte_dev_env.md`); retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/ResearchChatNode.svelte && git commit -m "$(cat <<'EOF'
M7 task 2: ResearchChatNode renderer — SSE-over-POST chat grounded in the session

Chat thread bound to the desk sessionId; POSTs to /api/deepdive/[id]/chat,
streams sources+token+done frames via getReader()+TextDecoder, renders via
ChatMarkdown + sanitize-chat, citation chips from the sources frame.
reader/AbortController are plain lets (no $state-in-$effect footgun).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `ResearchChatNode` as the `research-chat` renderer (replace M6 placeholder)

Swap the Milestone-6 placeholder branch in the desk's node `{#each}` loop for the real renderer, passing the desk's `sessionId`.

**Files:**
- Modify: `src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Locate the M6 placeholder branch.** Confirm where the desk-node loop renders the `research-chat` placeholder:

```bash
cd /home/john/strange_rambling_svelte && grep -n "research-chat\|renderer pending\|ResearchChatNode\|deskNodes\|{#each.*node" src/lib/canvas/intelligence/ResearchDesk.svelte
```
Expected: at least one hit on `research-chat` inside a `{#each ... node}` block (M6's placeholder div). Read the surrounding 25 lines to capture the exact placeholder markup and the loop variable name (`n`) and how it exposes the per-node session (`n.config?.sessionId ?? sessionId`).

- [ ] **Step 2: Add the import.** In the `<script>` import block of `ResearchDesk.svelte` (alongside the other `./desk/*` imports such as `ArtefactCard`, `CommandBar`), add:

```svelte
  import ResearchChatNode from './desk/ResearchChatNode.svelte';
```

Use the `Edit` tool to insert it immediately after the existing `import InspectorDrawer from './desk/InspectorDrawer.svelte';` line (or the last `./desk/*` import present), so the import order stays grouped.

- [ ] **Step 3: Replace the placeholder branch.** Using the exact placeholder text found in Step 1 as the `old_string`, replace the M6 stub with the real renderer. The M6 placeholder is expected to look like:

```svelte
            {:else if n.type === 'research-chat'}
              <div class="node-placeholder">Chat node — renderer pending</div>
```

Replace it with (re-confirm the loop variable `n` and the per-node session field by content — adjust `n.config?.sessionId` to whatever M6 named the node config object):

```svelte
            {:else if n.type === 'research-chat'}
              <ResearchChatNode
                sessionId={n.config?.sessionId ?? sessionId}
                nodeId={n.id}
                {readonly}
              />
```

> If the M6 placeholder used `n.kind === 'research-chat'` instead of `n.type`, match that exact condition. The `{readonly}` shorthand forwards the desk's `readonly` prop so the embedded deep-readonly desk hides the composer.

- [ ] **Step 4: Type-check the desk wiring.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -iE "ResearchDesk\.svelte|ResearchChatNode" || echo "NO ResearchDesk/ResearchChatNode errors"
```
Expected: `NO ResearchDesk/ResearchChatNode errors`. Retry with `dangerouslyDisableSandbox: true` on EPERM.

- [ ] **Step 5: Full unit-test pass (no regressions in the desk suite).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/
```
Expected: all desk test files pass, including the new `chatStream.test.ts`. Retry sandbox-disabled on EPERM.

- [ ] **Step 6: Manual verification (real app — required by verify-live discipline).** Build is sandbox-sensitive; run the dev server with the sandbox disabled and exercise the node end to end.

```bash
cd /home/john/strange_rambling_svelte && npm run dev -- --host 0.0.0.0 --port 5173
```
(Run this with `dangerouslyDisableSandbox: true`; it binds for LAN access so John can open it at `http://homeserv:5173`.)

Then, in a browser at `http://homeserv:5173`:
1. Open a completed deepdive session: `http://homeserv:5173/deepdive/<a-real-session-id>` (pick any `complete` session; `GET /api/deepdive` or the research index lists them).
2. Right-click empty desk canvas → the `NodePalette` (lifted in M6) opens → pick **Research chat**. A `research-chat` node appears at the cursor.
3. Confirm the node body shows the `.rc-intro` lede + the three suggestion chips, styled warm-brutalist (`--surface-elevated` body, `--accent` "Ask" button and kind-bar).
4. Click a suggestion (or type a question + **Ask**). Confirm:
   - A thinking indicator (3 bouncing dots) appears, then assistant tokens stream in progressively (rendered as markdown via `ChatMarkdown`).
   - A **Sources** row of citation chips appears (from the `sources` frame); chips with URLs are links opening in a new tab.
   - The **stop** button cancels mid-stream (click it during a long answer → streaming halts, no console error, `busy` clears).
   - **clear** empties the thread when not busy.
5. Open the same session embedded read-only (a deep `research-result` node, or `/deepdive/<id>` inside a `ResearchResultNode`) and confirm a `research-chat` node there hides the composer (`readonly` path) but still renders prior messages.
6. Open DevTools console — confirm **no** `effect_update_depth_exceeded` and no unhandled errors during streaming, cancellation, or node deletion.

Record the observations (token streaming seen, citations seen, stop worked, no console errors) as the verification evidence for this task. Stop the dev server (Ctrl-C / kill the background job) when done.

- [ ] **Step 7: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
M7 task 3: wire ResearchChatNode as the research-chat node renderer on the desk

Replaces the M6 placeholder branch in the desk node {#each} with the real
ResearchChatNode, forwarding the desk sessionId (per-node override aware) and
readonly. Manually verified: right-click → add chat node → grounded streamed
answers with citation chips; stop/clear work; no effect-depth errors.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Milestone 7 done when:** `chatStream.test.ts` and the full `desk/` Vitest suite pass; `svelte-check` reports no new errors referencing `ResearchChatNode`/`chatStream`/`ResearchDesk.svelte`; and the manual E2E (right-click → add Research chat node → streamed, source-cited answers grounded in the session; stop/clear; readonly hides composer; no console errors) is observed in the running app.


I have everything. The pure logic worth testing in this milestone is the `fact_ids`/`entity_centrality` join + the data-shaping helper that turns the raw `report` JSON + desk cards into a renderable view-model. I'll extract that into a pure module `report-view.ts` with co-located tests, then build the Svelte component around it. Let me write the milestone now.

## Milestone 8: Report/export node renderer

This milestone builds the `desk/ReportNode.svelte` in-graph renderer and wires it as the `'research-report'` node kind, replacing the M6 placeholder branch in `ResearchDesk.svelte`'s node `{#each}`. The node fetches `GET /api/deepdive/[id]/report`, joins `fact_ids`/`entity_centrality` against the desk's already-held `/data` cards, renders an expandable preview (executive summary, collapsible cluster sections, knowledge-gap chips colored via `display.severityColor`, hypotheses, suggested follow-ups, source diversity), and offers Regenerate (`POST /report/regenerate`, fire-and-forget, then refetch when the SSE session status reaches `complete`) plus Download `.docx` / `.md` via the existing `handleExport` mechanism.

The view-model assembly (the join logic) is pure and TDD-tested first in `desk/report-view.ts`; the Svelte component is then built around it with explicit manual verification.

> Assumptions confirmed against the live tree (re-confirmed by content, not line number):
> - `ResearchReport` is in `src/lib/deepdive/types.ts` with optional `knowledge_gaps` (`{gap,type,severity,goal_index?}`), `hypotheses` (`{hypothesis,supporting_fact_ids,tension_fact_ids,testability,suggested_queries}`), `suggested_followups` (`{question,context,seed_fact_ids}`), `source_diversity` (`{total_domains,by_type,concentration_index}`), plus always-set `clusters[{title,summary,fact_ids}]`, `executive_summary`, `entity_centrality: Record<entityId,number>`, `ranked_facts`.
> - `display.ts` exports `severityColor(severity)`, `confidenceColor`, `confidenceLabel`, `ENTITY_TYPE_COLORS`, `SENTIMENT_COLORS` — all use the global tokens.
> - `ResearchDesk.svelte` `handleExport(kind)` currently maps `'docx' | 'narrative-docx' | 'narrative-md'` to export paths via a transient `<a download>`; it does NOT yet know `'md'` (report-as-markdown). This milestone extends it to a `'md'` kind hitting `/api/deepdive/[id]/export/md`.
> - The desk store exposes `store.cards` (each `{id, kind:'source'|'fact'|'entity', fields:Record<string,unknown>}`; facts carry `fields.content`, entities carry `fields.name`/`fields.type`, sources carry `fields.title`/`fields.domain`/`fields.url`) and `store.sessionStatus` (`'draft'|'phase1'|'phase2'|'phase3'|'post_processing'|'complete'|'failed'`).
> - Backend endpoints `GET /report`, `POST /report/regenerate`, `GET /export/md` and `generateReportMarkdown` are delivered by earlier backend milestones per the SHARED CONTRACT. M6 registered the `'research-report'` node kind + a placeholder renderer branch in the desk node `{#each}`. This milestone replaces that placeholder.

---

### Task 1: Pure report view-model assembly (`report-view.ts`) — TDD

Extract the `fact_ids`/`entity_centrality` join into a pure, testable module so the Svelte component carries only presentation. Given the raw `ResearchReport` JSON and the desk's flat card list, produce a render-ready view-model: clusters with resolved fact previews, knowledge-gap chips with severity colors, hypotheses with resolved supporting/tension facts, follow-ups, and top entities sorted by centrality.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/report-view.ts`
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/report-view.test.ts`

- [ ] **Step 1: Write the failing test first.** Create `report-view.test.ts` with the complete spec below. It exercises the fact/entity joins, the centrality sort, severity coloring, the empty/null-report path, and graceful handling of missing fact ids.

```ts
import { describe, it, expect } from 'vitest';
import { buildReportView, type DeskCardLite } from './report-view';
import type { ResearchReport } from '$lib/deepdive/types';

const cards: DeskCardLite[] = [
  { id: 'f1', kind: 'fact', fields: { content: 'GDP rose 2% in Q1.' } },
  { id: 'f2', kind: 'fact', fields: { content: 'Inflation fell to 3%.' } },
  { id: 'f3', kind: 'fact', fields: { content: 'Unemployment held at 4%.' } },
  { id: 'e1', kind: 'entity', fields: { name: 'Bank of England', type: 'organisation' } },
  { id: 'e2', kind: 'entity', fields: { name: 'Rachel Reeves', type: 'person' } },
  { id: 's1', kind: 'source', fields: { title: 'ONS Release', domain: 'ons.gov.uk', url: 'https://ons.gov.uk/a' } },
];

const report: ResearchReport = {
  ranked_facts: ['f1', 'f2', 'f3'],
  timeline: [],
  clusters: [
    { title: 'Macro indicators', summary: 'Headline economic moves.', fact_ids: ['f1', 'f2'] },
    { title: 'Labour market', summary: 'Jobs picture.', fact_ids: ['f3', 'missing-fact'] },
  ],
  executive_summary: 'The economy is mixed.',
  entity_centrality: { e1: 0.9, e2: 0.4 },
  knowledge_gaps: [
    { gap: 'No regional breakdown.', type: 'geographic', severity: 'high' },
    { gap: 'Pre-2020 baseline missing.', type: 'temporal', severity: 'low' },
  ],
  hypotheses: [
    {
      hypothesis: 'Rate cuts drove growth.',
      supporting_fact_ids: ['f1'],
      tension_fact_ids: ['f2'],
      testability: 'medium',
      suggested_queries: ['BoE rate decisions 2026'],
    },
  ],
  suggested_followups: [
    { question: 'What about wages?', context: 'Wage growth uncited.', seed_fact_ids: ['f3'] },
  ],
  source_diversity: { total_domains: 4, by_type: { government: 2, news: 2 }, concentration_index: 0.25 },
};

describe('buildReportView', () => {
  it('returns hasReport=false for a null report', () => {
    const v = buildReportView(null, cards);
    expect(v.hasReport).toBe(false);
    expect(v.clusters).toEqual([]);
    expect(v.executiveSummary).toBe('');
  });

  it('returns hasReport=false for an empty-object report (no executive_summary/clusters)', () => {
    const v = buildReportView({} as ResearchReport, cards);
    expect(v.hasReport).toBe(false);
  });

  it('surfaces the executive summary and marks hasReport', () => {
    const v = buildReportView(report, cards);
    expect(v.hasReport).toBe(true);
    expect(v.executiveSummary).toBe('The economy is mixed.');
  });

  it('joins cluster fact_ids to fact content and skips unknown ids', () => {
    const v = buildReportView(report, cards);
    expect(v.clusters).toHaveLength(2);
    const macro = v.clusters[0];
    expect(macro.title).toBe('Macro indicators');
    expect(macro.summary).toBe('Headline economic moves.');
    expect(macro.factCount).toBe(2);
    expect(macro.facts.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(macro.facts.map((f) => f.content)).toEqual(['GDP rose 2% in Q1.', 'Inflation fell to 3%.']);
    // 'missing-fact' has no card → dropped from the resolved list but still counted in factCount.
    const labour = v.clusters[1];
    expect(labour.factCount).toBe(2);
    expect(labour.facts.map((f) => f.id)).toEqual(['f3']);
  });

  it('colors knowledge gaps by severity', () => {
    const v = buildReportView(report, cards);
    expect(v.knowledgeGaps).toHaveLength(2);
    expect(v.knowledgeGaps[0]).toMatchObject({ gap: 'No regional breakdown.', severity: 'high', color: '#8b3a1a' });
    expect(v.knowledgeGaps[1].color).toBe('var(--text-muted)');
  });

  it('resolves hypothesis supporting/tension facts', () => {
    const v = buildReportView(report, cards);
    expect(v.hypotheses).toHaveLength(1);
    const h = v.hypotheses[0];
    expect(h.hypothesis).toBe('Rate cuts drove growth.');
    expect(h.testability).toBe('medium');
    expect(h.supporting.map((f) => f.content)).toEqual(['GDP rose 2% in Q1.']);
    expect(h.tension.map((f) => f.content)).toEqual(['Inflation fell to 3%.']);
    expect(h.suggestedQueries).toEqual(['BoE rate decisions 2026']);
  });

  it('passes follow-ups through with seed-fact resolution', () => {
    const v = buildReportView(report, cards);
    expect(v.followups).toHaveLength(1);
    expect(v.followups[0].question).toBe('What about wages?');
    expect(v.followups[0].seedFacts.map((f) => f.content)).toEqual(['Unemployment held at 4%.']);
  });

  it('sorts top entities by centrality descending and joins names/types', () => {
    const v = buildReportView(report, cards);
    expect(v.topEntities.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(v.topEntities[0]).toMatchObject({ name: 'Bank of England', type: 'organisation', centrality: 0.9 });
  });

  it('caps top entities at the requested limit', () => {
    const v = buildReportView(report, cards, { entityLimit: 1 });
    expect(v.topEntities).toHaveLength(1);
    expect(v.topEntities[0].id).toBe('e1');
  });

  it('exposes source diversity verbatim', () => {
    const v = buildReportView(report, cards);
    expect(v.sourceDiversity).toEqual({ total_domains: 4, by_type: { government: 2, news: 2 }, concentration_index: 0.25 });
  });

  it('tolerates a report missing all optional sections', () => {
    const minimal: ResearchReport = {
      ranked_facts: [],
      timeline: [],
      clusters: [{ title: 'Only', summary: '', fact_ids: [] }],
      executive_summary: 'Sparse.',
      entity_centrality: {},
    };
    const v = buildReportView(minimal, cards);
    expect(v.hasReport).toBe(true);
    expect(v.knowledgeGaps).toEqual([]);
    expect(v.hypotheses).toEqual([]);
    expect(v.followups).toEqual([]);
    expect(v.topEntities).toEqual([]);
    expect(v.sourceDiversity).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails (module does not exist yet).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/report-view.test.ts
```

Expected: failure with `Failed to resolve import "./report-view"` (or `buildReportView is not a function`). This proves the test runs and the module is genuinely absent.

- [ ] **Step 3: Implement `report-view.ts` to make the test pass.** Create the module with the complete code below.

```ts
// src/lib/canvas/intelligence/desk/report-view.ts
// Pure assembly of the ResearchReport jsonb + the desk's flat card list into a
// render-ready view-model for ReportNode.svelte. No Svelte, no DOM — unit-tested.
import { severityColor } from '$lib/deepdive/display';
import type {
  ResearchReport,
  KnowledgeGap,
  Hypothesis,
  FollowUpSuggestion,
  SourceDiversity,
} from '$lib/deepdive/types';

/** The minimal slice of a desk card this module needs (kind + fields). */
export interface DeskCardLite {
  id: string;
  kind: 'source' | 'fact' | 'entity';
  fields: Record<string, unknown>;
}

export interface FactRef {
  id: string;
  content: string;
}

export interface ClusterView {
  title: string;
  summary: string;
  /** Total fact_ids in the cluster (incl. ids with no matching card). */
  factCount: number;
  /** Resolved facts (ids with a matching fact card, order-preserved). */
  facts: FactRef[];
}

export interface GapView {
  gap: string;
  type: KnowledgeGap['type'];
  severity: KnowledgeGap['severity'];
  color: string;
}

export interface HypothesisView {
  hypothesis: string;
  testability: Hypothesis['testability'];
  supporting: FactRef[];
  tension: FactRef[];
  suggestedQueries: string[];
}

export interface FollowupView {
  question: string;
  context: string;
  seedFacts: FactRef[];
}

export interface EntityView {
  id: string;
  name: string;
  type: string;
  centrality: number;
}

export interface ReportView {
  hasReport: boolean;
  executiveSummary: string;
  clusters: ClusterView[];
  knowledgeGaps: GapView[];
  hypotheses: HypothesisView[];
  followups: FollowupView[];
  topEntities: EntityView[];
  sourceDiversity: SourceDiversity | null;
}

const EMPTY: ReportView = {
  hasReport: false,
  executiveSummary: '',
  clusters: [],
  knowledgeGaps: [],
  hypotheses: [],
  followups: [],
  topEntities: [],
  sourceDiversity: null,
};

export interface BuildReportViewOpts {
  /** Max entities shown in the "key players" strip (default 12). */
  entityLimit?: number;
}

export function buildReportView(
  report: ResearchReport | null | undefined,
  cards: ReadonlyArray<DeskCardLite>,
  opts: BuildReportViewOpts = {},
): ReportView {
  if (!report) return { ...EMPTY };
  const hasContent =
    (typeof report.executive_summary === 'string' && report.executive_summary.length > 0) ||
    (Array.isArray(report.clusters) && report.clusters.length > 0);
  if (!hasContent) return { ...EMPTY };

  const entityLimit = opts.entityLimit ?? 12;

  // Index fact content + entity meta by id for O(1) joins.
  const factContent = new Map<string, string>();
  const entityMeta = new Map<string, { name: string; type: string }>();
  for (const c of cards) {
    if (c.kind === 'fact') {
      factContent.set(c.id, String(c.fields.content ?? ''));
    } else if (c.kind === 'entity') {
      entityMeta.set(c.id, {
        name: String(c.fields.name ?? c.id),
        type: String(c.fields.type ?? 'other'),
      });
    }
  }

  const resolveFacts = (ids: string[] | undefined): FactRef[] => {
    if (!Array.isArray(ids)) return [];
    const out: FactRef[] = [];
    for (const id of ids) {
      const content = factContent.get(id);
      if (content != null) out.push({ id, content });
    }
    return out;
  };

  const clusters: ClusterView[] = (report.clusters ?? []).map((cl) => ({
    title: cl.title ?? '',
    summary: cl.summary ?? '',
    factCount: Array.isArray(cl.fact_ids) ? cl.fact_ids.length : 0,
    facts: resolveFacts(cl.fact_ids),
  }));

  const knowledgeGaps: GapView[] = (report.knowledge_gaps ?? []).map((g: KnowledgeGap) => ({
    gap: g.gap,
    type: g.type,
    severity: g.severity,
    color: severityColor(g.severity),
  }));

  const hypotheses: HypothesisView[] = (report.hypotheses ?? []).map((h: Hypothesis) => ({
    hypothesis: h.hypothesis,
    testability: h.testability,
    supporting: resolveFacts(h.supporting_fact_ids),
    tension: resolveFacts(h.tension_fact_ids),
    suggestedQueries: Array.isArray(h.suggested_queries) ? h.suggested_queries : [],
  }));

  const followups: FollowupView[] = (report.suggested_followups ?? []).map((f: FollowUpSuggestion) => ({
    question: f.question,
    context: f.context,
    seedFacts: resolveFacts(f.seed_fact_ids),
  }));

  const topEntities: EntityView[] = Object.entries(report.entity_centrality ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, entityLimit)
    .map(([id, centrality]) => {
      const meta = entityMeta.get(id);
      return {
        id,
        name: meta?.name ?? id,
        type: meta?.type ?? 'other',
        centrality,
      };
    });

  return {
    hasReport: true,
    executiveSummary: report.executive_summary ?? '',
    clusters,
    knowledgeGaps,
    hypotheses,
    followups,
    topEntities,
    sourceDiversity: report.source_diversity ?? null,
  };
}
```

- [ ] **Step 4: Run the test and confirm all cases pass.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/report-view.test.ts
```

Expected: `Test Files  1 passed (1)` with `13 passed` test cases (the 13 `it` blocks above). If a Bash sandbox EPERM error appears, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/report-view.ts src/lib/canvas/intelligence/desk/report-view.test.ts && git commit -m "Research Desk v2: pure report view-model assembly (report-view.ts) + tests

buildReportView joins ResearchReport fact_ids/entity_centrality against the
desk's loaded /data cards: resolved cluster facts, severity-colored knowledge
gaps, hypotheses with supporting/tension facts, follow-ups, centrality-sorted
top entities, source diversity. Pure + unit-tested (13 cases).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extend `handleExport` for report-as-markdown (`'md'`)

The report node offers Download `.docx` (existing `/export/docx`) and Download `.md` (the new `/export/md` from the backend milestone). The desk's `handleExport` only knows `'docx' | 'narrative-docx' | 'narrative-md'`. Add a `'md'` kind hitting `/api/deepdive/[id]/export/md` so the node reuses the verbatim `<a download>` mechanism (no new blob handling).

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Widen the `handleExport` signature and path map.** Replace the existing `handleExport` function (the one that maps `'docx' | 'narrative-docx' | 'narrative-md'`) with this version that also handles `'md'`.

```ts
  function handleExport(kind: 'docx' | 'narrative-docx' | 'narrative-md' | 'md') {
    const path =
      kind === 'docx'
        ? `/api/deepdive/${sessionId}/export/docx`
        : kind === 'md'
          ? `/api/deepdive/${sessionId}/export/md`
          : kind === 'narrative-docx'
            ? `/api/deepdive/${sessionId}/export/narrative-docx`
            : `/api/deepdive/${sessionId}/export/narrative-md`;
    const a = document.createElement('a');
    a.href = path;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
```

- [ ] **Step 2: Manual-verify the signature is consistent.** `handleExport` is passed to `CommandBar` as `onexport`; widening the union is backward-compatible (CommandBar only ever calls it with the three narrower kinds). The new `'md'` value is used only by the ReportNode wiring in Task 4. No CommandBar change is required. Confirm by reading the `CommandBar` prop type — it remains `(kind: 'docx' | 'narrative-docx' | 'narrative-md') => void`, which is assignable to the widened `handleExport`.

- [ ] **Step 3: Typecheck.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tspaths ./tsconfig.json --threshold error 2>&1 | tail -20
```

Expected: `svelte-check found 0 errors` (warnings tolerated). If EPERM appears, retry with `dangerouslyDisableSandbox: true`. Build/deploy steps run sandbox-disabled.

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2: handleExport supports report-as-markdown ('md' -> /export/md)

Widen handleExport to route the new auto-report markdown download through the
existing transient <a download> mechanism, alongside docx + narrative exports.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Build `desk/ReportNode.svelte` (expandable report renderer)

The in-graph renderer for the `'research-report'` node. On mount it fetches `GET /api/deepdive/[id]/report`. If `report` is null it shows the "Report not generated — Regenerate" empty state; otherwise it renders the expandable preview via `buildReportView`. It exposes Regenerate, Download .docx, Download .md actions and a refetch-on-complete contract driven by the desk's session status.

**Component interface (props):**

```ts
let {
  sessionId,
  cards,          // ReadonlyArray<DeskCardLite> — the desk's loaded /data cards (store.cards), for fact/entity joins
  sessionStatus,  // DeskStatus — passed from ResearchDesk so the node can refetch when it flips to 'complete'
  canRegenerate,  // boolean — (!readonly && deskMode !== 'quick'); gates Regenerate + downloads
  onexport,       // (kind: 'docx' | 'md') => void — delegates to ResearchDesk.handleExport
}: {
  sessionId: string;
  cards: ReadonlyArray<import('./report-view').DeskCardLite>;
  sessionStatus: import('./positioning').DeskStatus;
  canRegenerate: boolean;
  onexport: (kind: 'docx' | 'md') => void;
} = $props();
```

> Note on `DeskStatus`: it is exported from `desk/deskControls.ts` and re-exported through `positioning.ts` in this codebase. Confirm the exact import path by content at implementation time; if `positioning.ts` does not re-export it, import from `./deskControls`. The component only needs the string union `'draft'|'phase1'|'phase2'|'phase3'|'post_processing'|'complete'|'failed'`.

**Files:**
- Create `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/ReportNode.svelte`

- [ ] **Step 1: Confirm the `DeskStatus` import path by content.**

```bash
cd /home/john/strange_rambling_svelte && grep -rn "export type DeskStatus\|export { .*DeskStatus\|export type { .*DeskStatus" src/lib/canvas/intelligence/desk/
```

Expected: a hit in `deskControls.ts` (`export type DeskStatus = ...`). Use `import { type DeskStatus } from './deskControls';` in the component (the canonical source) rather than guessing the positioning re-export.

- [ ] **Step 2: Create `ReportNode.svelte` with the complete code below.** Key behaviours: fetch on mount; loading/empty/loaded states; collapsible cluster sections (`<details>`); severity-colored gap chips; regenerate posts to `/report/regenerate` (202 fire-and-forget) and flips a local `regenerating` flag; a `$effect` watches `sessionStatus` and refetches once when it transitions into `complete` while `regenerating` is true, then clears the flag.

```svelte
<!-- src/lib/canvas/intelligence/desk/ReportNode.svelte -->
<script lang="ts">
  import { buildReportView, type DeskCardLite, type ReportView } from './report-view';
  import { type DeskStatus } from './deskControls';
  import type { ResearchReport } from '$lib/deepdive/types';

  let {
    sessionId,
    cards,
    sessionStatus,
    canRegenerate,
    onexport,
  }: {
    sessionId: string;
    cards: ReadonlyArray<DeskCardLite>;
    sessionStatus: DeskStatus;
    canRegenerate: boolean;
    onexport: (kind: 'docx' | 'md') => void;
  } = $props();

  type LoadState = 'loading' | 'ready' | 'error';
  let loadState = $state<LoadState>('loading');
  let report = $state.raw<ResearchReport | null>(null);
  let regenerating = $state(false);
  // Snapshot of sessionStatus at the moment regenerate fires, so the $effect can
  // detect a *transition* into 'complete' (not a node mounted while already complete).
  let prevStatus = $state<DeskStatus>(sessionStatus);

  // Pure view-model: recomputes when the report json or the joined cards change.
  const view = $derived<ReportView>(buildReportView(report, cards));

  async function load() {
    loadState = 'loading';
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/report`);
      if (!res.ok) {
        loadState = 'error';
        return;
      }
      const body = (await res.json()) as { report: ResearchReport | null };
      report = body.report ?? null;
      loadState = 'ready';
    } catch (err) {
      console.error('[report-node] load error', err);
      loadState = 'error';
    }
  }

  async function regenerate() {
    if (!canRegenerate || regenerating) return;
    regenerating = true;
    prevStatus = sessionStatus;
    try {
      // Fire-and-forget: the endpoint returns 202 and runs runPostProcessing
      // in the background. We poll for completion via sessionStatus (below).
      await fetch(`/api/deepdive/${sessionId}/report/regenerate`, { method: 'POST' });
    } catch (err) {
      console.error('[report-node] regenerate error', err);
      regenerating = false;
    }
  }

  // When a regenerate is in flight and the worker SSE status transitions INTO
  // 'complete', refetch the now-fresh report and clear the regenerating flag.
  $effect(() => {
    const status = sessionStatus;
    const wasRegenerating = regenerating;
    const previous = prevStatus;
    // untracked bookkeeping is fine: we only act on a rising edge into complete.
    if (status !== previous) {
      if (wasRegenerating && status === 'complete') {
        regenerating = false;
        load();
      }
      prevStatus = status;
    }
  });

  $effect(() => {
    load();
  });

  // ——— expand / collapse the whole preview body ———
  let expanded = $state(false);

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
</script>

<div class="report-node" data-state={loadState}>
  <header class="rn-head">
    <span class="rn-title">REPORT</span>
    {#if loadState === 'ready' && view.hasReport}
      <button
        type="button"
        class="rn-expand"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >{expanded ? '\u2212 collapse' : '+ expand'}</button>
    {/if}
  </header>

  {#if loadState === 'loading'}
    <p class="rn-muted">Loading report\u2026</p>
  {:else if loadState === 'error'}
    <p class="rn-muted rn-error">Could not load report.</p>
    <button type="button" class="rn-btn" onclick={load}>Retry</button>
  {:else if !view.hasReport}
    <p class="rn-muted">Report not generated.</p>
    {#if canRegenerate}
      <button type="button" class="rn-btn rn-accent" disabled={regenerating} onclick={regenerate}>
        {regenerating ? 'regenerating\u2026' : 'Regenerate'}
      </button>
    {/if}
  {:else}
    <!-- executive summary -->
    <section class="rn-exec">
      <p class:rn-clamp={!expanded}>{view.executiveSummary}</p>
    </section>

    {#if expanded}
      <!-- clusters -->
      {#if view.clusters.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Clusters</h4>
          {#each view.clusters as cl (cl.title)}
            <details class="rn-cluster">
              <summary>
                <span class="rn-cl-title">{cl.title}</span>
                <span class="rn-cl-count">{cl.factCount}</span>
              </summary>
              {#if cl.summary}<p class="rn-cl-summary">{cl.summary}</p>{/if}
              <ul class="rn-fact-list">
                {#each cl.facts as f (f.id)}
                  <li>{f.content}</li>
                {/each}
              </ul>
            </details>
          {/each}
        </section>
      {/if}

      <!-- knowledge gaps -->
      {#if view.knowledgeGaps.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Knowledge gaps</h4>
          <div class="rn-chips">
            {#each view.knowledgeGaps as g (g.gap)}
              <span class="rn-chip" style:--chip={g.color} title={`${g.type} \u00b7 ${g.severity}`}>{g.gap}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- hypotheses -->
      {#if view.hypotheses.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Hypotheses</h4>
          {#each view.hypotheses as h (h.hypothesis)}
            <div class="rn-hyp">
              <p class="rn-hyp-text">{h.hypothesis}</p>
              <span class="rn-hyp-meta">testability: {h.testability}</span>
              {#if h.supporting.length}
                <p class="rn-hyp-line"><b>+</b> {h.supporting.map((f) => f.content).join(' \u00b7 ')}</p>
              {/if}
              {#if h.tension.length}
                <p class="rn-hyp-line rn-tension"><b>\u2013</b> {h.tension.map((f) => f.content).join(' \u00b7 ')}</p>
              {/if}
            </div>
          {/each}
        </section>
      {/if}

      <!-- suggested follow-ups -->
      {#if view.followups.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Suggested follow-ups</h4>
          <ul class="rn-fu-list">
            {#each view.followups as fu (fu.question)}
              <li><span class="rn-fu-q">{fu.question}</span><span class="rn-fu-c">{fu.context}</span></li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- top entities -->
      {#if view.topEntities.length}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Key players</h4>
          <div class="rn-chips">
            {#each view.topEntities as e (e.id)}
              <span class="rn-ent">{e.name} <i>{pct(e.centrality)}</i></span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- source diversity -->
      {#if view.sourceDiversity}
        <section class="rn-sec">
          <h4 class="rn-sec-h">Source diversity</h4>
          <p class="rn-muted">
            {view.sourceDiversity.total_domains} domains \u00b7
            concentration {pct(view.sourceDiversity.concentration_index)}
          </p>
        </section>
      {/if}
    {/if}

    <!-- actions -->
    <footer class="rn-actions">
      {#if canRegenerate}
        <button type="button" class="rn-btn" disabled={regenerating} onclick={regenerate}>
          {regenerating ? 'regenerating\u2026' : 'Regenerate report'}
        </button>
        <button type="button" class="rn-btn" onclick={() => onexport('docx')}>Download .docx</button>
        <button type="button" class="rn-btn" onclick={() => onexport('md')}>Download .md</button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .report-node {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
    max-height: 460px;
    overflow-y: auto;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1.5px solid var(--card-border);
    border-radius: 4px;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
  .rn-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .rn-title {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .rn-expand,
  .rn-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    border-radius: 3px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .rn-expand:hover,
  .rn-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rn-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .rn-accent {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rn-muted {
    font-size: 12px;
    color: var(--divider);
    margin: 0;
  }
  .rn-error {
    color: #8b3a1a;
  }
  .rn-exec p {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
  }
  .rn-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .rn-sec {
    border-top: 1px solid var(--divider);
    padding-top: 6px;
  }
  .rn-sec-h {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--divider);
    margin: 0 0 4px;
  }
  .rn-cluster {
    border: 1px solid var(--card-border);
    border-radius: 3px;
    padding: 4px 6px;
    margin-bottom: 4px;
  }
  .rn-cluster summary {
    display: flex;
    justify-content: space-between;
    cursor: pointer;
    font-size: 12px;
  }
  .rn-cl-count {
    color: var(--accent);
  }
  .rn-cl-summary {
    font-size: 11px;
    color: var(--divider);
    margin: 4px 0;
  }
  .rn-fact-list,
  .rn-fu-list {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .rn-fact-list li,
  .rn-fu-list li {
    font-size: 11px;
    line-height: 1.45;
    margin-bottom: 3px;
  }
  .rn-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rn-chip {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--chip);
    color: var(--chip);
    background: transparent;
  }
  .rn-ent {
    font-size: 11px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    border-radius: 3px;
  }
  .rn-ent i {
    color: var(--accent);
    font-style: normal;
  }
  .rn-hyp {
    margin-bottom: 6px;
  }
  .rn-hyp-text {
    font-size: 12px;
    margin: 0;
  }
  .rn-hyp-meta {
    font-size: 10px;
    color: var(--divider);
  }
  .rn-hyp-line {
    font-size: 11px;
    margin: 2px 0 0;
  }
  .rn-tension {
    color: #8b3a1a;
  }
  .rn-fu-q {
    display: block;
    font-size: 12px;
  }
  .rn-fu-c {
    display: block;
    font-size: 11px;
    color: var(--divider);
  }
  .rn-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-top: 1px solid var(--divider);
    padding-top: 6px;
  }
</style>
```

- [ ] **Step 3: Typecheck the component in isolation.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tspaths ./tsconfig.json --threshold error 2>&1 | grep -A3 "ReportNode" || echo "no ReportNode errors"
```

Expected: `no ReportNode errors` (the grep finds nothing because there are no errors mentioning ReportNode). If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/ReportNode.svelte && git commit -m "Research Desk v2: ReportNode.svelte expandable report renderer

Fetches GET /api/deepdive/[id]/report on mount. Null report -> empty state with
Regenerate; otherwise expandable preview (exec summary, collapsible cluster
sections, severity-colored gap chips, hypotheses w/ supporting/tension facts,
follow-ups, centrality-sorted key players, source diversity) via buildReportView.
Regenerate posts /report/regenerate (202 fire-and-forget) + refetches on the SSE
session status rising into 'complete'. Download .docx/.md delegate to onexport.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire `ReportNode` as the `'research-report'` renderer (replace M6 placeholder)

Replace the M6 placeholder branch in `ResearchDesk.svelte`'s node `{#each}` loop with the real `ReportNode`, passing the desk's loaded cards, session status, the regenerate/download gate, and the export delegate.

**Files:**
- Modify `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Locate the M6 placeholder branch by content.** M6 added a node `{#each}` loop (client-only node store) with a placeholder branch for `kind === 'research-report'`.

```bash
cd /home/john/strange_rambling_svelte && grep -n "research-report\|ReportNode\|ResearchChatNode\|research-chat" src/lib/canvas/intelligence/ResearchDesk.svelte
```

Expected: hits showing the placeholder branch (e.g. a `{:else if ...kind === 'research-report'}` with a stub div) and, after M7, the chat-node branch. Note the exact node-loop variable name (the spec uses `n` for the node in the `{#each}`; confirm by content — it may be `node`). The steps below assume the loop binds `n` with `n.id` and a client-only node `n.config` object; adapt the field reads to the actual M6 node shape.

- [ ] **Step 2: Add the `ReportNode` import** next to the other desk-component imports at the top of `<script>` (after the `CommandBar`/`LeftFeed` imports).

```ts
  import ReportNode from './desk/ReportNode.svelte';
```

- [ ] **Step 3: Add a `canRegenerate` derived gate** alongside the other deriveds in `<script>` (mirrors the `handleExport`/`handleShare` guard `!readonly && deskMode !== 'quick'`).

```ts
  // Report node: regenerate + downloads are gated exactly like handleExport/handleShare.
  const canRegenerate = $derived(!readonly && deskMode !== 'quick');
```

- [ ] **Step 4: Replace the placeholder branch.** Swap the M6 stub for the real component. Use the actual node-loop variable confirmed in Step 1 (shown here as `n`).

Replace the placeholder (whose exact text is whatever M6 wrote, e.g.):

```svelte
            {:else if n.kind === 'research-report'}
              <div class="wf-node-placeholder">report node</div>
```

with:

```svelte
            {:else if n.kind === 'research-report'}
              <ReportNode
                {sessionId}
                cards={store.cards}
                sessionStatus={sessionStatus}
                {canRegenerate}
                onexport={(kind) => handleExport(kind)}
              />
```

`store.cards` is the desk's live `/data`-hydrated card list (kind/id/fields) — directly assignable to `ReportNode`'s `cards: ReadonlyArray<DeskCardLite>` because `DeskCard` is a structural superset of `DeskCardLite`. `sessionStatus` is the existing `$derived` `DeskStatus` in this component. `handleExport` already accepts `'docx' | 'md'` after Task 2.

- [ ] **Step 5: Typecheck the desk.**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tspaths ./tsconfig.json --threshold error 2>&1 | tail -20
```

Expected: `svelte-check found 0 errors`. A common failure is the `cards` prop type mismatch — if `store.cards` is typed `ReadonlyArray<DeskCard>` and `DeskCard.fields` differs, confirm `DeskCard` has `{id; kind; fields}` (it does, per `store.svelte.ts`) so it is assignable. If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 6: Run the full desk test suite to confirm no regressions in the pure modules.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/ 2>&1 | tail -15
```

Expected: all desk test files pass, including the new `report-view.test.ts`. If EPERM, retry sandbox-disabled.

- [ ] **Step 7: Manual verification (dev server, real app).** The CLAUDE.md discipline is verify-live, but the node renderer must be confirmed locally first since it is interactive.

```bash
cd /home/john/strange_rambling_svelte && npm run dev -- --host 0.0.0.0
```

Then in a browser at `http://homeserv:5173`:
  1. Open a completed deep-dive session: `http://homeserv:5173/deepdive/<a-session-id-with-a-report>`.
  2. Right-click empty canvas → palette → add a **Report** node (`research-report`). The node appears as a `.wf-node` frame with a `ReportNode` body.
  3. Confirm the **executive summary** renders (3-line clamp collapsed), and `+ expand` reveals collapsible **cluster** sections whose facts match `/data` content, **knowledge-gap chips** colored by severity (high = dark red `#8b3a1a`, medium = `--accent`, low = `--text-muted`), **hypotheses** (supporting `+` / tension `–` lines), **follow-ups**, **key players** sorted by centrality, and **source diversity**.
  4. Open a session whose `report` is null (a draft/in-progress session) → node shows **"Report not generated"** + a **Regenerate** button (only when not readonly and not quick mode).
  5. Click **Regenerate report** → button flips to `regenerating…`; the backend runs `runPostProcessing` fire-and-forget. When the worker SSE status flips to `complete`, the node auto-refetches and renders the fresh report (the `regenerating…` flag clears).
  6. Click **Download .docx** → a `deepdive-*.docx` downloads. Click **Download .md** → a markdown file downloads from `/export/md`.
  7. On a **share/readonly** desk (`/deepdive/share/<token>`) and a **quick** desk, confirm Regenerate/Download buttons are **absent** (gated by `canRegenerate`).

Record the observed result for each numbered check.

- [ ] **Step 8: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "Research Desk v2: wire ReportNode as the research-report renderer

Replace the M6 placeholder branch in the desk node {#each} with the real
ReportNode, passing store.cards (for fact/entity joins), the derived
sessionStatus (for refetch-on-complete), a canRegenerate gate
(!readonly && deskMode !== 'quick'), and handleExport as the docx/md delegate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Deploy + verify live

Per CLAUDE.md verify-live discipline: deploy and confirm the report node works on production before declaring the milestone done.

**Files:** none (deploy only).

- [ ] **Step 1: Clean rebuild + deploy (sandbox-disabled).** Build/deploy fails under the Bash sandbox at the adapter-node step, so run with `dangerouslyDisableSandbox: true`. Suspect stale `.svelte-kit/output` on any build failure and rebuild clean.

```bash
cd /home/john/strange_rambling_svelte && rm -rf .svelte-kit/output && NODE_OPTIONS=--max-old-space-size=8192 npm run build && ~/strange_rambling_svelte/scripts/deploy.sh
```

Expected: build completes, `deploy.sh` reports a successful push/restart to the VPS. Run this step with `dangerouslyDisableSandbox: true`.

- [ ] **Step 2: Verify the new export route is live (no auth-gated 500/404).**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://strangeramblings.com/api/deepdive/__nonexistent__/export/md"
```

Expected: `404` (route exists, session not found) — NOT `500` and not a generic SvelteKit 404 page for a missing route. A `401/redirect` is acceptable if the `/api/*` hook gates it; the key signal is the route resolves rather than 404-ing as an unknown path.

- [ ] **Step 3: Live E2E on production.** Open a completed deep-dive at `https://strangeramblings.com/deepdive/<session-id>`, add a Report node via right-click, confirm the preview renders, expand/collapse works, gap-chip colors match severity, and both downloads succeed. Confirm Regenerate is present on the owner view and absent on a `/deepdive/share/<token>` view. Record observed results.

- [ ] **Step 4: Commit any deploy-config drift** (only if `deploy.sh` or VPS config changed; otherwise skip). If nothing changed, this task has no commit.

```bash
cd /home/john/strange_rambling_svelte && git status --porcelain
```

Expected: empty output (no uncommitted changes after deploy). If files changed, commit them with the standard footer.

---

**Milestone 8 done when:** `report-view.test.ts` passes (13 cases), `svelte-check` reports 0 errors, the `'research-report'` node renders the full expandable preview with severity-colored gaps and fact/entity joins, Regenerate fires `/report/regenerate` and auto-refetches on `complete`, `.docx`/`.md` downloads work via `handleExport`, the regenerate/download controls are correctly gated by `canRegenerate`, and all of this is verified live on `strangeramblings.com`.


I have everything I need. Now let me check how a single test file is run (filter syntax) and quickly confirm FloatingFilters is an M8 deliverable by checking the desk store's lack of entityMentions in DeskStore interface — confirmed it's not there.

I have full context. Let me draft the milestone. This is M9, downstream of M4 (grouping.ts + pileLayout) and M8 (FloatingFilters with artefact-type filters). I'll write it to consume those verbatim contracts, wire them into ResearchDesk.svelte, add the GroupDim selector, the similarity fetch+cache, entityMentions store plumbing, pile rendering, and remove the `arrange`/organisedLayout/themeLayout callsites.

---

## Milestone 9: Group-by selector + pile rendering

This milestone wires the M4 grouping primitives (`groupBy` in `desk/grouping.ts` and `pileLayout` in `desk/layout.ts`) into `ResearchDesk.svelte`, replacing the legacy boolean `arrange` toggle and the `organisedLayout`/`themeLayout` callsites with a single `GroupDim`-driven pile renderer. It depends on M3 (`/data` now returns `entityMentions`), M4 (the two pure modules + their tests), and M8 (`FloatingFilters.svelte` already exists and renders the artefact-type filters). M9 adds the `GroupDim` selector to that floating box, fetches `GET /clusters?by=similarity` once-per-fact-count and caches it, surfaces `entityMentions` through the desk store, renders each group as a fanned, collapsible pile (label + count badge reusing `CategoryHeader`/`ThemeHeader` hosts), and keeps the coalescer / `positionById` memo / `morphIds` transition unregressed.

**Pre-flight assumptions (re-confirm by content before editing — line numbers drift):**
- `src/lib/canvas/intelligence/desk/grouping.ts` exists (M4) and exports, verbatim:
  ```ts
  export type GroupDim = 'cluster' | 'theme' | 'entityType' | 'sentiment' | 'cooccurrence' | 'similarity';
  export interface GroupCard { id: string; kind: string; deskCategory?: string | null; fields?: Record<string, unknown>; }
  export interface GroupEdge { id: string; fromEntityId: string; toEntityId: string; sentiment?: string | null; }
  export interface GroupMention { entityId: string; factId: string; }
  export interface GroupResult { memberOf: Map<string, string>; groups: { key: string; label: string; count: number }[]; }
  export function groupBy(
    dim: GroupDim,
    cards: GroupCard[],
    edges: GroupEdge[],
    mentions: GroupMention[],
    similarityMap: Map<string, string>, // factId -> clusterId
  ): GroupResult;
  ```
- `src/lib/canvas/intelligence/desk/layout.ts` exists with, verbatim (M4):
  ```ts
  export function pileLayout(
    groups: { key: string; label: string; count: number }[],
    memberOf: Map<string, string>,
    cards: { id: string; kind: string }[],
    expanded: Set<string>,
  ): Map<string, Pos>; // returns a position for EVERY card in `cards`
  ```
  with pile-anchor constants (grid left→right packing) and the fan offset `{ dx: 6, dy: 8 }`, descending z, ~5 visible collapsed; expanded groups spread members into a column. `pileLayout` does **not** snap pinned/manual overrides — those still win in `posOf`.
- `src/routes/api/deepdive/[id]/clusters/+server.ts` exists (M2) and answers `GET ?by=similarity` → `{ clusters: { factId: string; clusterId: string; clusterLabel: string }[] }`.
- `FloatingFilters.svelte` exists (M8) and already renders the 4 artefact-type filters; M9 extends it with the `GroupDim` selector.

If any export signature has drifted from the above, STOP and reconcile against the real M4/M2/M8 code before continuing — do not invent a parallel shape.

---

### Task 1: Surface `entityMentions` through the desk store

The co-occurrence dimension needs `{ entityId, factId }[]` on the client. M3 added `entityMentions` to the `/data` payload; this task plumbs it through `store.svelte.ts` so the desk can hand it to `groupBy`.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/store.svelte.ts`
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/store.test.ts`

- [ ] **Step 1: Re-confirm the `/data` payload includes `entityMentions`.** Read the real file before editing.
  ```bash
  cd /home/john/strange_rambling_svelte && grep -n "entityMentions" src/routes/api/deepdive/\[id\]/data/+server.ts
  ```
  Expected: at least one line returning `entityMentions: [...]` inside the `json({...})`. If absent, the M3 dependency is unmet — STOP and complete M3 first.

- [ ] **Step 2 (test-first): add a store contract test for `entityMentions`.** In `store.test.ts`, add a test that the `DeskStore` interface surface exposes an `entityMentions` getter defaulting to an empty array before hydrate. Add this `it` block inside the existing top-level `describe`:
  ```ts
  it('exposes entityMentions, empty before hydrate', () => {
    const s = createDeskStore('sess-em-test', { mode: 'deep' });
    expect(Array.isArray(s.entityMentions)).toBe(true);
    expect(s.entityMentions.length).toBe(0);
    s.dispose();
  });
  ```
  Confirm `createDeskStore` and `dispose` are already imported/used in this test file (they are used by the existing tests — match their import line). Run it and watch it FAIL (no `entityMentions` getter yet):
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/store.test.ts -t "entityMentions"
  ```
  Expected: `1 failed` with a TypeError/undefined on `s.entityMentions`.

- [ ] **Step 3: add the `entityMentions` field to the `DeskStore` interface.** In `store.svelte.ts`, in the `export interface DeskStore { ... }` block, add after the `edges` line:
  ```ts
  /** Entity→fact mentions for the co-occurrence grouping dimension.
   *  Hydrated from /data; never streamed (co-occurrence regroups on flush). */
  entityMentions: ReadonlyArray<{ entityId: string; factId: string }>;
  ```

- [ ] **Step 4: add backing state + hydrate it.** Near the other `$state.raw` declarations inside `createDeskStore` (alongside `edgeMap`), add:
  ```ts
  let mentionList = $state.raw<{ entityId: string; factId: string }[]>([]);
  ```
  In `hydrate()`, immediately after the `edgeMap = edges;` line, add:
  ```ts
    mentionList = ((body.entityMentions ?? []) as Array<{ entityId: unknown; factId: unknown }>).map((m) => ({
      entityId: String(m.entityId),
      factId: String(m.factId),
    }));
  ```

- [ ] **Step 5: add the getter.** In the returned object literal (the `return { get cards() {...}, ... }` block), add after the `get edges()` getter:
  ```ts
    get entityMentions() {
      return mentionList;
    },
  ```

- [ ] **Step 6: run the store test — expect PASS.**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/store.test.ts
  ```
  Expected: all tests pass, including `exposes entityMentions, empty before hydrate`. If Bash reports EPERM/permission, retry the same command with `dangerouslyDisableSandbox: true`.

- [ ] **Step 7: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/store.svelte.ts src/lib/canvas/intelligence/desk/store.test.ts && git commit -m "$(cat <<'EOF'
desk(store): surface entityMentions for co-occurrence grouping

Hydrate the new /data entityMentions field into a $state.raw list and
expose it via a getter so ResearchDesk can pass it to groupBy().

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

---

### Task 2: Add the `GroupDim` selector to `FloatingFilters.svelte`

M8 created `FloatingFilters.svelte` with the artefact-type filters. M9 adds the group-by selector to the same view-locked box and emits a typed change event.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/FloatingFilters.svelte`

- [ ] **Step 1: Read the real M8 component first.** Confirm its current props and event names before editing.
  ```bash
  cd /home/john/strange_rambling_svelte && sed -n '1,60p' src/lib/canvas/intelligence/desk/FloatingFilters.svelte
  ```
  Expected: a `$props()` block with the artefact-type filter props (e.g. `filters`, `onfilter`) and SR-token styling. Note the exact prop/event names so the additions below match the file's existing conventions; if M8 named them differently, adapt the snippet names to match rather than introducing a second style.

- [ ] **Step 2: extend the component interface.** Add `groupBy` (current selected dimension) + an `ongroupby` callback to the existing `$props()` destructure. The component contract M9 relies on:
  - `groupBy: GroupDim` — controlled value (parent owns state).
  - `ongroupby: (dim: GroupDim) => void` — fired on selection change.

  Add the import at the top of the `<script lang="ts">` block:
  ```ts
  import type { GroupDim } from './grouping';
  ```
  Add to the `$props()` destructure (merge with the existing one — do not create a second `$props()` call):
  ```ts
    groupBy = 'similarity',
    ongroupby = (_d: GroupDim) => {},
  ```
  and to its type literal:
  ```ts
    groupBy?: GroupDim;
    ongroupby?: (dim: GroupDim) => void;
  ```

- [ ] **Step 3: add the selector option model + change handler** in the `<script>`:
  ```ts
  const GROUP_DIMS: { value: GroupDim; label: string; hint: string }[] = [
    { value: 'similarity', label: 'Similarity', hint: 'Piles of semantically-related facts' },
    { value: 'cluster', label: 'Cluster', hint: 'Synthesis topic clusters' },
    { value: 'theme', label: 'Theme', hint: 'By artefact kind (sites / facts / people…)' },
    { value: 'entityType', label: 'Entity type', hint: 'Group entities by their type' },
    { value: 'sentiment', label: 'Sentiment', hint: 'By relationship sentiment' },
    { value: 'cooccurrence', label: 'Co-occurrence', hint: 'Entities & facts sharing a fact' },
  ];

  function onDimChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value as GroupDim;
    ongroupby(v);
  }
  ```

- [ ] **Step 4: add the selector markup** below the artefact-type filter group (inside the existing floating box root, after the filter controls block):
  ```svelte
  <div class="ff-group" role="group" aria-label="Group by">
    <span class="ff-group-label">GROUP BY</span>
    <select
      class="ff-select"
      aria-label="Group artefacts by dimension"
      value={groupBy}
      onchange={onDimChange}
    >
      {#each GROUP_DIMS as d (d.value)}
        <option value={d.value} title={d.hint}>{d.label}</option>
      {/each}
    </select>
  </div>
  ```

- [ ] **Step 5: add the selector styling** to the component `<style>` (reuse `.composer-pill`-style chrome + SR tokens; no new colors/fonts):
  ```css
  .ff-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .ff-group-label {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--text-muted, rgba(26, 16, 8, 0.55));
  }
  .ff-select {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.02em;
    padding: 5px 8px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    cursor: pointer;
  }
  .ff-select:hover,
  .ff-select:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
    outline: none;
  }
  ```

- [ ] **Step 6: manual-verification step (deferred to Task 5's render check).** This component is not independently mounted; its visual verification happens once wired into the desk in Task 5. For now, type-check only:
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -15
  ```
  Expected: `svelte-check found 0 errors` (warnings tolerated). If Bash reports EPERM, retry with `dangerouslyDisableSandbox: true`. (If `--threshold error` is unsupported by the installed `svelte-check`, drop the flag and confirm there are no new errors versus the pre-task baseline.)

- [ ] **Step 7: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/FloatingFilters.svelte && git commit -m "$(cat <<'EOF'
desk(filters): add GroupDim selector to FloatingFilters

Controlled select (similarity/cluster/theme/entityType/sentiment/
cooccurrence) co-located with the artefact-type filters; emits ongroupby.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

---

### Task 3: Add a client-side similarity-cluster fetcher with per-fact-count cache

`groupBy('similarity', ...)` needs a `Map<factId, clusterId>`. Extract a tiny pure cache wrapper so it is unit-testable and only hits `GET /clusters?by=similarity` once per distinct fact-count.

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/similarityCache.ts`
- Create: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/similarityCache.test.ts`

- [ ] **Step 1 (test-first): write `similarityCache.test.ts`.**
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { createSimilarityCache } from './similarityCache';

  function fakeFetch(payload: unknown, status = 200) {
    return vi.fn(async () =>
      ({ ok: status < 400, status, json: async () => payload }) as unknown as Response,
    );
  }

  describe('createSimilarityCache', () => {
    it('fetches once and maps factId -> clusterId', async () => {
      const fetchImpl = fakeFetch({
        clusters: [
          { factId: 'f1', clusterId: 'c0', clusterLabel: 'A' },
          { factId: 'f2', clusterId: 'c0', clusterLabel: 'A' },
          { factId: 'f3', clusterId: 'c1', clusterLabel: 'B' },
        ],
      });
      const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
      const map = await cache.get(3);
      expect(map.get('f1')).toBe('c0');
      expect(map.get('f3')).toBe('c1');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((fetchImpl.mock.calls[0][0] as string)).toContain('/api/deepdive/sess1/clusters?by=similarity');
    });

    it('caches by fact-count: same count → no refetch, new count → refetch', async () => {
      const fetchImpl = fakeFetch({ clusters: [{ factId: 'f1', clusterId: 'c0', clusterLabel: 'A' }] });
      const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
      await cache.get(5);
      await cache.get(5);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await cache.get(6);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('dedupes concurrent calls for the same count into one request', async () => {
      const fetchImpl = fakeFetch({ clusters: [] });
      const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
      const [a, b] = await Promise.all([cache.get(4), cache.get(4)]);
      expect(a).toBe(b); // same resolved Map instance
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('returns an empty map and does not cache on a failed fetch', async () => {
      const fetchImpl = fakeFetch({}, 500);
      const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
      const map = await cache.get(2);
      expect(map.size).toBe(0);
      await cache.get(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2); // a failure is retried next time
    });
  });
  ```
  Run and watch it FAIL (module missing):
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/similarityCache.test.ts
  ```
  Expected: `Failed to resolve import "./similarityCache"`.

- [ ] **Step 2: implement `similarityCache.ts`.**
  ```ts
  // src/lib/canvas/intelligence/desk/similarityCache.ts
  //
  // Client-side wrapper around GET /api/deepdive/[id]/clusters?by=similarity.
  // The server clusters facts.embedding with greedy cosine and is itself cached
  // per (sessionId, factCount); on the client we additionally cache the resolved
  // factId->clusterId Map keyed on the fact-count we asked for, and dedupe
  // concurrent calls, so switching to/from the 'similarity' dimension never
  // re-hits the network for an unchanged fact set.

  export interface SimilarityClusterRow {
    factId: string;
    clusterId: string;
    clusterLabel: string;
  }

  export interface SimilarityCache {
    /** Resolve factId->clusterId for the given fact-count. Cached per count;
     *  a failed fetch resolves to an empty map and is NOT cached (retried). */
    get(factCount: number): Promise<Map<string, string>>;
  }

  export function createSimilarityCache(
    sessionId: string,
    fetchImpl: typeof fetch = fetch,
  ): SimilarityCache {
    // Resolved maps keyed by fact-count.
    const resolved = new Map<number, Map<string, string>>();
    // In-flight promises keyed by fact-count (concurrent-call dedupe).
    const inflight = new Map<number, Promise<Map<string, string>>>();

    async function fetchFor(factCount: number): Promise<Map<string, string>> {
      const map = new Map<string, string>();
      try {
        const res = await fetchImpl(
          `/api/deepdive/${sessionId}/clusters?by=similarity`,
        );
        if (!res.ok) return map; // empty, not cached (see get())
        const body = (await res.json()) as { clusters?: SimilarityClusterRow[] };
        for (const row of body.clusters ?? []) {
          map.set(String(row.factId), String(row.clusterId));
        }
        resolved.set(factCount, map); // cache only on success
        return map;
      } catch {
        return map;
      }
    }

    return {
      get(factCount: number): Promise<Map<string, string>> {
        const hit = resolved.get(factCount);
        if (hit) return Promise.resolve(hit);
        const pending = inflight.get(factCount);
        if (pending) return pending;
        const p = fetchFor(factCount).finally(() => inflight.delete(factCount));
        inflight.set(factCount, p);
        return p;
      },
    };
  }
  ```

- [ ] **Step 3: run the cache tests — expect PASS.**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/similarityCache.test.ts
  ```
  Expected: `4 passed`. If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 4: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/similarityCache.ts src/lib/canvas/intelligence/desk/similarityCache.test.ts && git commit -m "$(cat <<'EOF'
desk: similarity-cluster fetch cache (per fact-count, concurrent-dedup)

Wraps GET /clusters?by=similarity into a factId->clusterId Map cached by
fact-count; failures resolve empty and are retried.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

---

### Task 4: Add a `groupBy`-aware position derivation to `ResearchDesk.svelte` (logic only, no UI yet)

Wire `groupBy` (from M4), `pileLayout` (from M4), the similarity cache, and `entityMentions` into the desk's existing `posOf`/`positionById` path. This task is intentionally logic-first: it removes the `arrange`/`organisedLayout`/`themeLayout` machinery and replaces it with a single `pilePositions` derived feeding `posOf`. No floating-box wiring or pile-header markup yet (Task 5), so the desk should still type-check and render (piles default-collapsed, no expansion UI) at the end of this task.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: Re-read the live regions before editing** (line refs below are indicative — match by content): the imports block (top), the `arrange`/`themeSnapshot` state (`~136-138`), `categories`/`factCat`/`organised`/`coreBounds`/`categoryCounts`/`categorySummary` deriveds (`~285-333`), the arrange derivations (`arrangeableCards`/`liveThemeLayout`/`activeThemeHeaders`/`arrangeByThemeOnce`/`toggleKeepArranged`, `~388-441`), `posOf` (`~443-479`), `positionById` (`~485-487`), and the SYNTHESIZE category-header + theme-header `{#each}` blocks in markup (`~945-971`).

- [ ] **Step 2: update imports.** Replace the `layout`/`themes` imports so the desk pulls `pileLayout` and the grouping module, and drops the now-unused `organisedLayout`/`themeLayout`/`themeHeaders` symbols. Set the imports to:
  ```ts
  import {
    pileLayout,
    organisedCorePxBounds,
    COL_W,
    ORG,
    SYNTHESIS_ZONE_ORIGIN,
    SYNTHESIS_ZONE_GAP,
    BAND,
    type Pos,
  } from './desk/layout';
  import { effectivePosition, type DeskMode } from './desk/positioning';
  import { groupBy as computeGroups, type GroupDim } from './desk/grouping';
  import { createSimilarityCache } from './desk/similarityCache';
  ```
  Remove the `import { themeLayout, themeHeaders, type ThemeArtefact } from './desk/themes';` line and the `organisedLayout` / `type LayoutArtefact` / `type LayoutCategory` named imports from `./desk/layout`. Keep `CardLiveWrapper`, `CategoryHeader`, `ThemeHeader`, `EntityRail`, `CommandBar`, `ActivityTicker`, `InspectorDrawer`, `ArtefactCard` imports as-is. Add the `FloatingFilters` import next to the other desk imports:
  ```ts
  import FloatingFilters from './desk/FloatingFilters.svelte';
  ```
  (and remove the `LeftFeed` import — it is being removed from the desk in this milestone; if an earlier milestone already removed it, skip.)

- [ ] **Step 3: replace `arrange` state with `groupBy` + `expanded` state.** Delete the `arrange` and `themeSnapshot` `$state` declarations and the `// ——— Arrange by theme ———` comment block. In their place add:
  ```ts
  // ——— Group-by (pile) state ———
  // The active grouping dimension. Defaults to 'similarity' on first synthesize
  // (set in goSynthesize); 'cluster' is the resting value before synthesis.
  let groupDim = $state<GroupDim>('cluster');
  // Whether the user has synthesized at least once (drives the default flip).
  // (everSynthesized already exists below; reuse it — do not redeclare.)

  // Expanded pile keys. A pile is collapsed (fanned stack) unless its group key
  // is in this set; expanding spreads members into a column (animated via morphIds).
  let expandedPiles = $state.raw<Set<string>>(new Set());

  // Resolved similarity clusters: factId -> clusterId. Fetched lazily, once per
  // fact-count, only while groupDim === 'similarity'.
  const similarityCache = createSimilarityCache(sessionId);
  let similarityMap = $state.raw<Map<string, string>>(new Map());
  ```

- [ ] **Step 4: default `groupDim` to `'similarity'` on first synthesize.** In `goSynthesize()`, on the success branch where `everSynthesized = true;` is set, set the default dimension the first time only. Replace the success block:
  ```ts
      if (res.ok) {
        everSynthesized = true;
      } else {
  ```
  with:
  ```ts
      if (res.ok) {
        if (!everSynthesized) groupDim = 'similarity';
        everSynthesized = true;
      } else {
  ```

- [ ] **Step 5: add a similarity fetch effect.** After the `similarityMap` declaration, add an `$effect` that loads the map when the dimension is similarity and the fact-count changes. Hoist the reads and `untrack` the write to avoid proxy-churn re-fire (per the repo's Svelte-5 `$effect` guidance):
  ```ts
  import { untrack } from 'svelte';
  ```
  (add to the existing `svelte` import: `import { onMount, untrack } from 'svelte';`)
  ```ts
  // Lazily load similarity clusters when that dimension is active. Keyed on the
  // current fact count (store.synthFactCount when set, else the live fact tally)
  // so a changed fact set triggers a single refetch. The cache dedupes/coalesces.
  const factCountForSim = $derived.by(() => {
    const sc = store.synthFactCount;
    if (sc && sc > 0) return sc;
    let n = 0;
    for (const c of store.cards) if (c.kind === 'fact') n++;
    return n;
  });
  $effect(() => {
    const dim = groupDim;
    const count = factCountForSim;
    if (dim !== 'similarity') return;
    let cancelled = false;
    similarityCache.get(count).then((m) => {
      if (cancelled) return;
      untrack(() => { similarityMap = m; });
    });
    return () => { cancelled = true; };
  });
  ```

- [ ] **Step 6: replace `organised`/`coreBounds`/`categories` plumbing with grouping deriveds.** Keep `categories`, `factCat`, `categorySummary` (still used by `CategoryHeader` summaries for the `cluster` dimension and by the synthesis-zone label). DELETE the `organised`, `coreBounds`, and `categoryCounts` deriveds and the entire arrange-derivation block (`arrangeableCards`, `liveThemeLayout`, `activeThemeHeaders`, `arrangeByThemeOnce`, `toggleKeepArranged`). Replace them with the grouping deriveds:
  ```ts
  // ——— grouping → pile positions ———
  // memberOf: cardId -> groupKey; groups: ordered {key,label,count}.
  // Pure: a single O(N) pass per flush, funnelled into positionById below.
  const grouping = $derived.by(() => {
    const cards = visibleCards.map((c) => ({
      id: c.id,
      kind: c.kind,
      deskCategory: c.deskCategory ?? factCat.get(c.id) ?? null,
      fields: c.fields,
    }));
    const edges = store.edges.map((e) => ({
      id: e.id,
      fromEntityId: e.fromEntityId,
      toEntityId: e.toEntityId,
      sentiment: e.sentiment ?? null,
    }));
    const mentions = store.entityMentions.map((m) => ({
      entityId: m.entityId,
      factId: m.factId,
    }));
    return computeGroups(groupDim, cards, edges, mentions, similarityMap);
  });

  // Pile anchor + fanned-stack / expanded-column positions for EVERY visible
  // card. Replaces organisedLayout + themeLayout — one packer, one map.
  const pilePositions = $derived.by<Map<string, Pos>>(() => {
    const cards = visibleCards.map((c) => ({ id: c.id, kind: c.kind }));
    return pileLayout(grouping.groups, grouping.memberOf, cards, expandedPiles);
  });

  // Per-group anchor (top-left of the first member's pile) for header hosts.
  // Derived from pilePositions so labels sit exactly over their stack.
  const pileHeaders = $derived.by(() => {
    const out: { key: string; label: string; count: number; pos: Pos }[] = [];
    const seen = new Set<string>();
    // Walk groups in their packed order; the anchor is the min-x,min-y of members.
    const anchors = new Map<string, Pos>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      if (!key) continue;
      const p = pilePositions.get(c.id);
      if (!p) continue;
      const a = anchors.get(key);
      if (!a || p.y < a.y || (p.y === a.y && p.x < a.x)) anchors.set(key, p);
    }
    for (const g of grouping.groups) {
      const a = anchors.get(g.key);
      if (!a || seen.has(g.key)) continue;
      seen.add(g.key);
      out.push({ key: g.key, label: g.label, count: g.count, pos: a });
    }
    return out;
  });
  ```

- [ ] **Step 7: rewrite `posOf` to use pile positions.** Replace the whole `posOf` function body with the manual-override-first, then-pile, then-scatter priority (manual/pinned still win; `effectivePosition` remains the GATHER scatter fallback for cards a pile didn't place — which should be none, but guards against drift):
  ```ts
  function posOf(c: DeskCard): { x: number; y: number } {
    // 1. Manual position ALWAYS wins — in-flight drag override, or a pinned /
    //    user-dragged card (non-null canvasX/Y).
    const ov = dragOverrides[c.id];
    if (ov) return ov;
    if (c.canvasX != null && c.canvasY != null) {
      return { x: c.canvasX as number, y: c.canvasY as number };
    }
    // 2. Pile position from the active grouping (collapsed fan or expanded column).
    const pile = pilePositions.get(c.id);
    if (pile) return pile;
    // 3. Fallback (a card not covered by the packer): deterministic GATHER scatter.
    const filedByCluster = factCat.has(c.id);
    return effectivePosition(
      {
        id: c.id,
        kind: c.kind,
        phase: c.phase,
        canvasX: c.canvasX ?? null,
        canvasY: c.canvasY ?? null,
        pinned: c.pinned ?? false,
        deskState: filedByCluster && c.deskState === 'unfiled' ? 'filed' : (c.deskState ?? 'unfiled'),
        deskCategory: c.deskCategory ?? factCat.get(c.id) ?? null,
      },
      mode,
      new Map(),
      { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    );
  }
  ```
  Note: `effectivePosition` now receives an empty `organised` map + zero bounds (the pile packer owns placement); the fallback only fires for cards the packer skipped, where deterministic scatter is the correct safety net.

- [ ] **Step 8: fix `anchorRect` for category connector edges.** The synthesis connector edges use `anchorRect('cat:<id>')` which previously read `ORG.originX + idx * COL_W`. Pile anchors are now dynamic. Re-point `cat:` anchors at the matching `pileHeaders` entry (the cluster dimension's group keys are the category ids). Replace the `if (anchorId.startsWith('cat:')) { ... }` block in `anchorRect`:
  ```ts
    if (anchorId.startsWith('cat:')) {
      const catId = anchorId.slice(4);
      const h = pileHeaders.find((ph) => ph.key === catId);
      if (!h) return null;
      return { x: h.pos.x, y: h.pos.y - 64, w: 220, h: 64 };
    }
  ```

- [ ] **Step 9: remove the now-dead `categoryCounts` references.** Search the file for `categoryCounts` and `organised` and `coreBounds` and `arrange` and `themeSnapshot` and `activeThemeHeaders` and `arrangeableCards` and `liveThemeLayout` and replace remaining usages:
  - In the SYNTHESIZE `{#each categories ...}` header host (markup), change `count={categoryCounts[cat.id] ?? 0}` to derive the count from `grouping`:
    ```svelte
              count={grouping.groups.find((g) => g.key === cat.id)?.count ?? 0}
    ```
    (The category-header host block stays for now; Task 5 replaces it with the dimension-agnostic pile-header host.)
  - In the entity-rail host markup, the `organised.get(railEntities[0].id)?.y ?? 0` read is gone with `organised`. Replace that `{@const railY = ...}` with `{@const railY = pilePositions.get(railEntities[0].id)?.y ?? 0}`.
  - Delete the markup `{#if arrange !== 'off'} ... {/if}` theme-header block (the `activeThemeHeaders` loop) entirely — Task 5 introduces the unified pile-header loop.
  - Delete the `.desk-arrange` toolbar markup block (the "Arrange by theme" buttons) and its associated CSS (`.desk-arrange`, `.arr-btn`, `.arr-toggle`, `.arr-knob`, and the `.arr-*` rules) — superseded by the FloatingFilters selector.

- [ ] **Step 10: verify the desk compiles and the existing desk-logic tests still pass.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20
  ```
  Expected: no new errors referencing `ResearchDesk.svelte` (resolve any until `0 errors` for that file). Then run the desk unit suite (coalescer / morph / positioning / layout must be unregressed):
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/
  ```
  Expected: all desk tests pass (`coalesce.test.ts`, `samePos.test.ts`, `positioning.test.ts`, `layout.test.ts`, `themes.test.ts`, `synthesis-reducer.test.ts`, `store.test.ts`, `similarityCache.test.ts`, plus M4's `grouping.test.ts` / pileLayout tests). If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 11: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
desk: drive positions from groupBy + pileLayout (retire arrange/organised/theme)

Replace the boolean arrange toggle and the organisedLayout/themeLayout
callsites with a single GroupDim-driven pile packer. posOf now resolves
manual -> pile -> scatter-fallback; cat: connector anchors track pile
headers; similarity clusters fetched lazily + cached per fact-count.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

---

### Task 5: Pile rendering — fanned stacks, labels, count badges, expand/collapse, FloatingFilters wiring

Render the desk's cards as piles: collapsed groups show a fanned stack (top ~5 cards, descending z, `{dx:6,dy:8}` offset) with a label + `+N` badge; clicking the header expands the pile into a column (animated via the existing `morphIds` transition). Wire the `FloatingFilters` selector to `groupDim` and remove the `LeftFeed` sidebar.

**Files:**
- Modify: `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: define the component interaction contract.** The pile UI is rendered inside the existing transformed `.desk-world`; the selector lives in `FloatingFilters` (a sibling of the world, view-locked). Key state/handlers (already present from Task 4 except `togglePile`):
  - `groupDim: GroupDim` (`$state`) — bound to FloatingFilters' `groupBy`, updated via `ongroupby`.
  - `expandedPiles: Set<string>` (`$state.raw`) — collapsed by default; toggled per group key.
  - `pileHeaders: {key,label,count,pos}[]` (`$derived`, from Task 4).
  - `pilePositions: Map<id,Pos>` (`$derived`, from Task 4) — already fans collapsed members and spreads expanded ones.
  - `morphIds: Set<id>` — UNCHANGED; expand/collapse changes `pilePositions`, which flows through `posOf` → `positionById` → `morphIds`, so the spread/restack animates with no new transition wiring.

  Add the toggle handler near the other handlers:
  ```ts
  function togglePile(key: string) {
    const next = new Set(expandedPiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedPiles = next;
  }
  ```

- [ ] **Step 2: per-card z-index + visibility for the fan.** A collapsed pile shows only its top ~5 members; the rest are hidden to keep DOM bounded (the perf win). Add a derived that, per card, gives its index-within-group and whether it should render:
  ```ts
  // Index of each card within its group (packed order = visibleCards order),
  // used for fan z-index and the collapsed "top ~5 only" cap.
  const COLLAPSED_VISIBLE = 5;
  const cardPileInfo = $derived.by(() => {
    const idxInGroup = new Map<string, number>();
    const sizeOfGroup = new Map<string, number>();
    const running = new Map<string, number>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      if (!key) { idxInGroup.set(c.id, 0); continue; }
      const i = running.get(key) ?? 0;
      idxInGroup.set(c.id, i);
      running.set(key, i + 1);
      sizeOfGroup.set(key, i + 1);
    }
    const m = new Map<string, { idx: number; render: boolean; z: number }>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      const idx = idxInGroup.get(c.id) ?? 0;
      const expanded = key ? expandedPiles.has(key) : true;
      // Manual/pinned cards always render (they escaped the pile).
      const manual = !!dragOverrides[c.id] || (c.canvasX != null && c.canvasY != null);
      const render = manual || expanded || idx < COLLAPSED_VISIBLE;
      // Top of the fan (idx 0) sits highest; deeper cards recede.
      const z = manual ? 1000 : 100 - idx;
      m.set(c.id, { idx, render, z });
    }
    return m;
  });
  ```

- [ ] **Step 3: render the unified pile headers.** Replace the SYNTHESIZE-only `{#each categories ...}` category-header host block AND the (already-deleted in Task 4) theme-header block with a single dimension-agnostic pile-header loop. Place it in the world layer, just before the cards `{#each}`. Reuse `CategoryHeader` (it carries the summary for the `cluster` dimension) when the dimension is `cluster`, else `ThemeHeader` (compact label + count, pointer-events safe):
  ```svelte
  <!-- pile headers: one per group, anchored over its stack; click to expand/collapse -->
  {#each pileHeaders as ph (ph.key)}
    <div
      class="desk-pile-host"
      class:expanded={expandedPiles.has(ph.key)}
      style:transform="translate({ph.pos.x}px, {ph.pos.y - 72}px)"
    >
      <button
        type="button"
        class="pile-toggle"
        aria-expanded={expandedPiles.has(ph.key)}
        title={expandedPiles.has(ph.key) ? 'Collapse pile' : 'Expand pile'}
        onclick={() => togglePile(ph.key)}
      >
        {#if groupDim === 'cluster'}
          <CategoryHeader
            id={ph.key}
            title={ph.label}
            summary={categorySummary[ph.key] ?? ''}
            count={ph.count}
          />
        {:else}
          <ThemeHeader label={ph.label} count={ph.count} />
        {/if}
        <span class="pile-chevron" aria-hidden="true">{expandedPiles.has(ph.key) ? '▾' : '▸'}</span>
      </button>
    </div>
  {/each}
  ```
  Remove the now-unused `categories`-header `{#each}` block, the entity-rail-only `{#if mode === 'synthesize'}` wrapper if it solely guarded headers (keep the synthesis-zone boundary markup if still desired, but the headers themselves are now dimension-driven and not mode-gated — render pile headers in ALL modes).

- [ ] **Step 4: apply render-gating + z-index to the cards `{#each}`.** In the cards loop, read `cardPileInfo` and skip hidden members; apply the fan z-index. Update the `{@const}`s and the host div:
  ```svelte
  {#each visibleCards as c (c.id)}
    {@const p = positionById.get(c.id) ?? posOf(c)}
    {@const live = cardLive.get(c.id)}
    {@const pile = cardPileInfo.get(c.id)}
    {#if pile?.render ?? true}
      <div
        class="desk-card-host"
        class:morphing={!c.pinned && c.canvasX == null && !dragOverrides[c.id] && morphIds.has(c.id)}
        style:transform="translate({p.x}px, {p.y}px)"
        style:z-index={pile?.z ?? 1}
        onpointerdown={(e) => onCardPointerDown(e, c)}
        onpointermove={onCardPointerMove}
        onpointerup={(e) => onCardPointerUp(e, c)}
        onpointercancel={(e) => onCardPointerUp(e, c)}
      >
        <CardLiveWrapper
          enterDelayMs={live?.enterDelayMs ?? 0}
          fresh={live?.fresh ?? false}
          breathing={deskRunning}
        >
          <ArtefactCard
            card={c}
            selected={selectedId === c.id}
            analysing={c.kind === 'source' && analysingSourceId === c.id}
            onselect={(id) => { selectedId = id; openInspector(id); }}
            onsummarize={(id) => { selectedId = id; openInspector(id, { summarize: true }); }}
          />
        </CardLiveWrapper>
      </div>
    {/if}
  {/each}
  ```

- [ ] **Step 5: mount `FloatingFilters` (view-locked) and remove `LeftFeed`.** In the `desk-mid` region, remove the `<LeftFeed ... />` element entirely. Inside the `.desk-world-wrap` (the viewport, a sibling of `.desk-world` — NOT inside the transformed world), after the `.desk-world` closing `</div>` and alongside `.desk-minimap`/`.desk-zoom`, mount:
  ```svelte
  <FloatingFilters
    filters={typeFilters}
    onfilter={handleFilter}
    groupBy={groupDim}
    ongroupby={(d) => { groupDim = d; }}
  />
  ```
  (Match `FloatingFilters`'s real prop names from Task 2 Step 1; if M8 used `onfilter`/`filters` exactly, the above is correct.) Since `LeftFeed` is removed, also delete the `feedCollapsed`, `feedSources`, `synthesisRuns`, `handleSelectRun` bindings/handlers if they are now unused (grep first; keep any still referenced — e.g. `feedSources` is only used by `LeftFeed`, so it can go). The bottom `ActivityTicker` stays untouched.

- [ ] **Step 6: add pile-host CSS.** Append to the component `<style>`:
  ```css
  .desk-pile-host {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    z-index: 200; /* headers above fanned cards, below dragged (1000) */
    transition: opacity 360ms ease;
  }
  .pile-toggle {
    display: inline-flex;
    align-items: flex-start;
    gap: 4px;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .pile-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pile-chevron {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    line-height: 1;
    margin-top: 2px;
  }
  ```

- [ ] **Step 7: type-check + unit suite.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20 && npx vitest run src/lib/canvas/intelligence/desk/
  ```
  Expected: `svelte-check` reports `0 errors` for `ResearchDesk.svelte` and `FloatingFilters.svelte`; all desk vitest files pass. If EPERM, retry both with `dangerouslyDisableSandbox: true`.

- [ ] **Step 8: manual verification (real app).** Start the homeserv dev server and exercise the desk on a session that has synthesized facts.
  ```bash
  cd /home/john/strange_rambling_svelte && (npm run dev >/tmp/desk-m9-dev.log 2>&1 &) ; sleep 1 ; echo "dev starting; tail /tmp/desk-m9-dev.log"
  ```
  Then, in a browser at `http://homeserv:5173/deepdive/<an-existing-session-id>` (pick a completed deep-dive session id from `/jkai/research` or the DB), confirm by direct observation:
  1. The left `LeftFeed` sidebar is GONE; the bottom `ActivityTicker` is still present.
  2. A floating filters box is pinned top-left and does NOT move when you pan/zoom the canvas (view-locked).
  3. The box shows the 4 artefact-type filters AND a "GROUP BY" selector defaulting to the resting dimension; after pressing SYNTHESIZE the selector reads `Similarity`.
  4. Cards render as fanned piles (overlapping stacks with a label + count), not a flat grid; each collapsed pile shows ~5 cards max.
  5. Clicking a pile header expands it into a column (members animate apart over ~520ms) and the chevron flips; clicking again collapses (members animate back).
  6. Switching the GROUP BY selector to `cluster` / `theme` / `entityType` / `sentiment` / `cooccurrence` / `similarity` re-piles the cards; `similarity` triggers exactly one network call to `/clusters?by=similarity` (check the Network tab) on first switch and no refetch on subsequent switches at the same fact-count.
  7. Drag a card: it leaves its pile, stays where dropped (manual override wins), and is unaffected by selector changes.
  8. Pan/zoom, minimap, and the GATHER⇄SYNTHESIZE flip still animate smoothly (coalescer/morph unregressed — no flicker, no full-grid snap).

  Capture the dev log tail if anything errors:
  ```bash
  tail -40 /tmp/desk-m9-dev.log
  ```
  Stop the dev server when done:
  ```bash
  pkill -f "vite dev" 2>/dev/null; echo stopped
  ```

- [ ] **Step 9: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
desk: pile rendering — fanned stacks, expand/collapse, FloatingFilters wiring

Render groups as collapsible fanned piles (top ~5 + count badge), expand
on header click (animated via morphIds), drive the GroupDim from the
view-locked FloatingFilters selector, and remove the LeftFeed sidebar.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

---

### Task 6: Full type-check + test sweep + dead-code purge

Confirm the whole milestone is internally consistent: no dangling `arrange`/`organisedLayout`/`themeLayout`/`LeftFeed` references remain in the desk, the full unit suite is green, and the project type-checks.

**Files:**
- Modify (if grep finds residue): `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`

- [ ] **Step 1: grep for residue of the retired machinery.**
  ```bash
  cd /home/john/strange_rambling_svelte && grep -n "arrange\|organisedLayout\|themeLayout\|themeHeaders\|themeSnapshot\|LeftFeed\|activeThemeHeaders\|liveThemeLayout\|categoryCounts\|coreBounds\b" src/lib/canvas/intelligence/ResearchDesk.svelte
  ```
  Expected: NO matches in `ResearchDesk.svelte` (the file no longer imports or references any of them). If any line prints, it is dead code from an incomplete edit — remove it. (Note: `themes.ts` / `layout.ts`'s `organisedLayout`/`themeLayout` exports may still exist for M4's own tests; only the DESK callsites must be gone. Do not delete the modules.)

- [ ] **Step 2: confirm the similarity endpoint contract is what the cache expects.** Re-read the M2 endpoint response shape and confirm it matches `{ clusters: [{ factId, clusterId, clusterLabel }] }`.
  ```bash
  cd /home/john/strange_rambling_svelte && grep -n "clusterId\|clusterLabel\|factId\|json(" src/routes/api/deepdive/\[id\]/clusters/+server.ts | head
  ```
  Expected: a `json({ clusters: [...] })` whose rows carry `factId`, `clusterId`, `clusterLabel`. If the field names differ, fix `similarityCache.ts` to read the real names (and update its test) — the cache, not the endpoint, adapts.

- [ ] **Step 3: full project type-check.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -25
  ```
  Expected: `svelte-check found 0 errors` (pre-existing warnings unrelated to this milestone are acceptable; zero NEW errors). If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 4: full vitest run.**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run 2>&1 | tail -25
  ```
  Expected: all test files pass; in particular the desk suite (`grouping.test.ts`, `layout.test.ts`, `similarityCache.test.ts`, `store.test.ts`, `coalesce.test.ts`, `samePos.test.ts`, `positioning.test.ts`, `synthesis-reducer.test.ts`). If EPERM, retry with `dangerouslyDisableSandbox: true`.

- [ ] **Step 5: Commit (only if Step 1 found and you removed residue; otherwise skip — nothing to commit).**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "$(cat <<'EOF'
desk: purge residual arrange/organised/theme references after pile migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)" || echo "nothing to commit"
  ```

---

## Final self-review checklist
- Spec §3 (restyle+floating filters) → M5; §4 (palette+nodes) → M6; §4a chat node → M3+M7; §4b report node → M1(report endpoints)+M8; §5 (grouping/piles) → M2(similarity)+M4+M9; §6 backend → M1+M2+M3.
- Build-time: re-grep +page.svelte lift line-refs before editing (they drift); confirm NodePalette/adapter/panels registry shapes; verify the new /api/deepdive/[id]/* routes are reachable through the auth hook; keep the coalescer/positionById/morphIds work unregressed when wiring piles.
- Run `npx vitest run` + `npx svelte-check` (8GB heap) before each commit; deploy sandbox-disabled; verify-live per CLAUDE.md.

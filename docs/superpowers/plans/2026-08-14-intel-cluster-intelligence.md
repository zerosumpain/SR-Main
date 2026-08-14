# Intel Cluster Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn detected communities from ephemeral, nightly-reshuffling size ranks into named, durable, self-describing clusters the user can rename, recalculate, read a cited narrative about, and navigate as a map.

**Architecture:** A pure identity layer matches each freshly-detected partition onto a stored roster by best Jaccard overlap, so a cluster keeps its key, name, colour and narrative across recomputation — the same "give the ephemeral thing an identity that survives the next run" move `insight-store.ts` makes for findings. The roster lives in the DATASTORE (`intel_clusters` collection), following the house rule set by `run-log.ts`: engine state needs no dedicated table, no `drizzle-kit push`, and no CI TTY-prompt risk on deploy. Narrative reuses `brief.ts` wholesale rather than growing a second prose pipeline — a cluster narrative is a brief over the cluster's most central members plus a composition preamble, so it inherits real note citations and `reconcileCitations`' invented-marker stripping.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Drizzle (read-only here), `$lib/datastore`, vitest, d3-force (2D), three.js (3D), `$lib/jkai/llm-client` via `brief.ts`.

## Measured baseline (production, 2026-08-14)

Every target below comes from running the repo's own Louvain over a dump of the live graph. Re-measure rather than trusting these if the graph's composition shifts a long way.

| Fact | Value |
|---|---|
| Entities / edges / notes | 9,042 / 10,368 / 1,974 |
| Connected entities (degree ≥ 1) | 6,410 — **2,632 are isolated**, at every resolution |
| Communities detected | 2,937 (2,632 of them singletons) |
| Clusters of ≥ 5 | 89, largest 607 = 9.5% of connected |
| Modularity | 0.846 |
| Louvain runtime, full graph | **80–205 ms** — a button, not a job |
| Entities changing cluster **index** after one day's ingest | **70.6%** of the connected graph |
| Top-12 clusters changing index after one day | 10 of 12 |
| Best-Jaccard match of a top cluster to its previous-day self | **0.83–1.00** |
| Entity provenance | email 5,606 · chat 2,701 · file 339 · research 234 · web 39 |
| ER categories populated | **none** — 8,539 entities carry no category |

Resolution sweep (γ), same graph:

| γ | Q | clusters ≥5 | largest | % of connected |
|---|---|---|---|---|
| 0.50 | 0.838 | 63 | 831 | 13.0% |
| 1.00 (today) | 0.846 | 89 | 607 | 9.5% |
| **1.25** | **0.846** | **106** | **393** | **6.1%** |
| 1.50 | 0.845 | 111 | 371 | 5.8% |
| 2.00 | 0.842 | 122 | 294 | 4.6% |
| 3.00 | 0.832 | 147 | 226 | 3.5% |

Coverage by clusters ≥5 is 91.7% of connected entities at **every** γ, and the 2,632 singletons are constant at every γ. Resolution changes how the mass is divided, never how much is covered — so the isolated pile is a data-quality finding, not a tuning failure, and must be presented as one.

## Global Constraints

- **Never run `scripts/deploy.sh` by hand.** Merge to `master`; CI deploys.
- **No new Postgres table.** Cluster state goes in the datastore (`intel_clusters`), per `run-log.ts`. No `drizzle-kit push` in this plan.
- **A user rename is never overwritten by a recompute.** Same protection rule as `PROTECTED_STATUSES` in `insight-store.ts`.
- **No non-handler exports from a `+server.ts`** — it breaks the route at runtime (`reference_sveltekit_server_exports`).
- **All LLM calls go through `$lib/jkai/llm-client`**, reached via `brief.ts`. No direct provider SDK calls.
- **Svelte 5:** never read a `$state` value an effect also writes; see the `svelte5-pitfalls` skill before the first `.svelte` line.
- **Design tokens only** — DM Mono / Archivo Black / DM Sans / JetBrains Mono, `var(--*)` colours. Model new surfaces on `ClusterPicker.svelte` and `/admin/files`.
- Tests: `npx vitest run <path>`. Types: `npm run check`.
- Pure logic is unit-tested; DB-aware modules are not (they need `$env/dynamic/private`, which does not resolve under vitest — the reason `insight-store.ts` splits its pure half out).

---

### Task 1: Resolution parameter and auto-tune

Gives Louvain a γ term and a rule for choosing it. Pure, no DB.

**Files:**
- Modify: `src/lib/jkai/intel/analytics/community.ts`
- Test: `src/lib/jkai/intel/analytics/community-resolution.test.ts` (create)

**Interfaces:**
- Produces: `detectCommunities(index: AdjacencyIndex, resolution?: number): CommunityResult` (default `1`, so every existing caller and `analytics.test.ts` is unchanged); `autoTuneResolution(index: AdjacencyIndex): { resolution: number; candidates: ResolutionCandidate[] }`; `interface ResolutionCandidate { resolution: number; modularity: number; clusters: number; largest: number; largestShare: number }`; `CommunityResult` gains `resolution: number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildIndex } from './model';
import { detectCommunities, autoTuneResolution, DOMINANCE_CAP } from './community';
import type { GraphNode, GraphEdge } from './model';

const node = (id: string): GraphNode => ({
  id, name: id, typeId: 't', typeName: 't', icon: '', color: '', summary: null,
  confidence: 'medium', confidenceScore: null, confirmed: false, createdAt: 0, updatedAt: 0,
  noteCount: 0, lastSeenAt: 0, evidenceAt: 0, aliases: [], categories: [], sources: [],
});
const edge = (s: string, t: string): GraphEdge => ({
  id: `${s}-${t}`, source: s, target: t, type: 'r', label: null, confidence: 'medium',
  strength: 'moderate', createdAt: 0, weight: 0.5, lastSeenAt: 0, sourceKind: null,
});

/** Two 4-cliques joined by one edge — one cluster at low γ, two at high γ. */
function barbell() {
  const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'];
  const edges: GraphEdge[] = [];
  for (const group of [['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3', 'b4']]) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) edges.push(edge(group[i], group[j]));
  }
  edges.push(edge('a1', 'b1'));
  return buildIndex({ nodes: ids.map(node), edges });
}

describe('resolution', () => {
  it('defaults to 1 and reports it', () => {
    const r = detectCommunities(barbell());
    expect(r.resolution).toBe(1);
  });

  it('splits the barbell into its two cliques at γ=1', () => {
    const r = detectCommunities(barbell(), 1);
    expect(r.communities.size).toBe(2);
  });

  it('merges the barbell into one cluster at a low resolution', () => {
    const r = detectCommunities(barbell(), 0.05);
    expect(r.communities.size).toBe(1);
  });

  it('is deterministic — the same graph and γ give the same membership', () => {
    const a = detectCommunities(barbell(), 1.25);
    const b = detectCommunities(barbell(), 1.25);
    expect([...a.membership]).toEqual([...b.membership]);
  });

  it('auto-tune rejects a resolution whose largest cluster dominates', () => {
    const { resolution, candidates } = autoTuneResolution(barbell());
    const chosen = candidates.find((c) => c.resolution === resolution)!;
    const eligible = candidates.filter((c) => c.largestShare <= DOMINANCE_CAP);
    if (eligible.length) {
      expect(chosen.largestShare).toBeLessThanOrEqual(DOMINANCE_CAP);
      // Best modularity among the eligible.
      expect(chosen.modularity).toBe(Math.max(...eligible.map((c) => c.modularity)));
    } else {
      // Nothing qualifies: take the least dominated.
      expect(chosen.largestShare).toBe(Math.min(...candidates.map((c) => c.largestShare)));
    }
  });

  it('never returns a resolution outside the sweep', () => {
    const { resolution } = autoTuneResolution(barbell());
    expect(RESOLUTION_SWEEP).toContain(resolution);
  });
});

import { RESOLUTION_SWEEP } from './community';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/intel/analytics/community-resolution.test.ts`
Expected: FAIL — `autoTuneResolution` is not exported.

- [ ] **Step 3: Implement**

In `community.ts`, thread `resolution` through the two places the null model appears in `optimiseLevel`, and add the tuner. Add to `CommunityResult`: `resolution: number`.

```ts
/**
 * How large the biggest cluster is allowed to get, as a share of the entities
 * that are connected to anything at all.
 *
 * Measured, not picked to look round. At the default γ=1 the live graph puts
 * 607 of 6,410 connected entities — 9.5% — in one cluster, and that cluster
 * ("jkai") is the one nobody can read: it is a fifth of everything the picker
 * shows. 8% is the tightest cap the real graph can satisfy while still keeping
 * the best modularity on offer (γ=1.25 → 6.1%, Q 0.846).
 */
export const DOMINANCE_CAP = 0.08;

/**
 * The resolutions tried. Louvain is 80–205 ms on the full production graph, so
 * sweeping seven of them costs under a second — cheap enough to do on every
 * user-triggered recalculation rather than storing a tuned value that goes
 * stale as the graph grows.
 */
export const RESOLUTION_SWEEP = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0] as const;

export interface ResolutionCandidate {
  resolution: number;
  modularity: number;
  /** Clusters with at least MIN_MEANINGFUL_SIZE members. */
  clusters: number;
  largest: number;
  /** `largest` over the number of entities with any edge at all. */
  largestShare: number;
}

/** Below this a "cluster" is a fragment, not a neighbourhood. */
export const MIN_MEANINGFUL_SIZE = 5;

/**
 * Pick a resolution the partition is READABLE at.
 *
 * Deliberately not "maximise modularity": Q peaks at γ≈1.0–1.25 on the live
 * graph and is nearly flat across the whole sweep (0.828–0.846), so it cannot
 * separate a partition with one 607-node blob from one without. The blob is the
 * thing that makes the view unreadable, so the cap is the binding constraint and
 * modularity only breaks ties beneath it.
 *
 * Coverage is deliberately NOT scored: clusters of ≥5 cover 91.7% of the
 * connected graph at every γ in the sweep, so it carries no signal.
 */
export function autoTuneResolution(index: AdjacencyIndex): {
  resolution: number;
  candidates: ResolutionCandidate[];
} {
  const connected = index.ids.filter((id) => (index.degree.get(id) ?? 0) > 0).length;
  const candidates: ResolutionCandidate[] = RESOLUTION_SWEEP.map((resolution) => {
    const result = detectCommunities(index, resolution);
    const sizes = [...result.communities.values()].map((ids) => ids.length);
    const largest = sizes.length ? Math.max(...sizes) : 0;
    return {
      resolution,
      modularity: result.modularity,
      clusters: sizes.filter((s) => s >= MIN_MEANINGFUL_SIZE).length,
      largest,
      largestShare: connected ? largest / connected : 0,
    };
  });

  const eligible = candidates.filter((c) => c.largestShare <= DOMINANCE_CAP);
  const pool = eligible.length ? eligible : candidates;
  const best = eligible.length
    ? pool.reduce((a, b) => (b.modularity > a.modularity ? b : a))
    : pool.reduce((a, b) => (b.largestShare < a.largestShare ? b : a));

  return { resolution: best.resolution, candidates };
}
```

In `optimiseLevel(graph, resolution)`, both gain expressions take the γ factor:

```ts
let bestGain = (links.get(own) ?? 0) - (resolution * commTotal.get(own)! * k) / m2;
// …
const gain = wIn - (resolution * commTotal.get(c)! * k) / m2;
```

`modularity()` stays at γ=1 — it is the reported quality of the partition on the original graph, and comparing candidates needs one fixed yardstick.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/jkai/intel/analytics/`
Expected: PASS, including the existing `analytics.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/analytics/community.ts src/lib/jkai/intel/analytics/community-resolution.test.ts
git commit -m "intel: give Louvain a resolution parameter and a readability-based tuner"
```

---

### Task 2: Durable cluster identity (pure)

The matcher. No DB, no clock, no randomness — the key mint is injected so tests are deterministic.

**Files:**
- Create: `src/lib/jkai/intel/analytics/cluster-identity.ts`
- Test: `src/lib/jkai/intel/analytics/cluster-identity.test.ts`

**Interfaces:**
- Consumes: `CommunityResult` from Task 1.
- Produces:

```ts
export interface StoredCluster {
  key: string;
  /** User-set name. Null means "use the generated label". */
  name: string | null;
  /** Generated at the last reconcile. Always present. */
  autoLabel: string;
  /** Palette slot, assigned once and kept. */
  colourIndex: number;
  members: string[];
  size: number;
  firstSeenAt: string;
  lastSeenAt: string;
  narrative: string | null;
  narrativeAt: string | null;
  /** Sorted-member hash the narrative was written against. */
  narrativeFingerprint: string | null;
  /** Keys this cluster absorbed at the last reconcile. */
  mergedFrom: string[];
  /** Key this cluster broke away from, if it did. */
  splitFrom: string | null;
  /** False once a reconcile no longer finds it. The record is kept. */
  live: boolean;
}

export interface ReconcileInput {
  detected: Map<number, string[]>;
  stored: StoredCluster[];
  labelFor: (memberIds: string[]) => string;
  mintKey: () => string;
  now: string;
}

export interface ReconcileResult {
  clusters: StoredCluster[];
  /** Detected community index → stable key, for colouring the payload. */
  keyByIndex: Map<number, string>;
  changes: { created: string[]; matched: string[]; retired: string[]; merged: string[]; split: string[] };
}

export function fingerprint(memberIds: readonly string[]): string;
export function jaccard(a: ReadonlySet<string>, b: readonly string[]): number;
export function reconcileClusters(input: ReconcileInput): ReconcileResult;
export const MATCH_THRESHOLD = 0.35;
export const SPLIT_THRESHOLD = 0.15;
export const MIN_TRACKED_SIZE = 5;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { reconcileClusters, jaccard, fingerprint, type StoredCluster } from './cluster-identity';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function mint() {
  let n = 0;
  return () => `cl_${++n}`;
}

const base = { labelFor: (m: string[]) => m[0], now: '2026-08-14T00:00:00.000Z' };

describe('reconcileClusters', () => {
  it('mints a key for every cluster on a cold start', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)], [1, ids('b', 8)]]),
      stored: [],
      mintKey: mint(),
    });
    expect(r.clusters).toHaveLength(2);
    expect(r.changes.created).toEqual(['cl_1', 'cl_2']);
    expect(r.keyByIndex.get(0)).toBe('cl_1');
  });

  it('gives distinct colour slots to clusters alive at the same time', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)], [1, ids('b', 8)]]),
      stored: [],
      mintKey: mint(),
    });
    expect(new Set(r.clusters.map((c) => c.colourIndex)).size).toBe(2);
  });

  it('keeps the key when the community index changes but the members do not', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)], [1, ids('b', 8)]]),
      stored: [],
      mintKey: mint(),
    });
    // Same two bodies, indices swapped — exactly what a nightly sweep does.
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('b', 8)], [1, ids('a', 10)]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    expect(second.keyByIndex.get(1)).toBe('cl_1');
    expect(second.keyByIndex.get(0)).toBe('cl_2');
    expect(second.changes.created).toEqual([]);
  });

  it('keeps a user name and its colour across a recompute that churns 20% of members', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20)]]),
      stored: [],
      mintKey: mint(),
    });
    const renamed: StoredCluster[] = first.clusters.map((c) => ({ ...c, name: 'DfE work' }));
    const churned = [...ids('a', 16), ...ids('z', 4)];
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, churned]]),
      stored: renamed,
      mintKey: mint(),
    });
    expect(second.clusters[0].name).toBe('DfE work');
    expect(second.clusters[0].key).toBe('cl_1');
    expect(second.clusters[0].colourIndex).toBe(renamed[0].colourIndex);
    expect(second.clusters[0].members).toEqual(churned);
  });

  it('drops the narrative fingerprint check to the caller by storing membership', () => {
    const first = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 10)]]), stored: [], mintKey: mint(),
    });
    const withNarrative = first.clusters.map((c) => ({
      ...c, narrative: 'words', narrativeFingerprint: fingerprint(c.members),
    }));
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 10), 'newcomer']]]),
      stored: withNarrative,
      mintKey: mint(),
    });
    // Narrative survives; the fingerprint no longer matches, which is how the
    // UI knows to offer a refresh.
    expect(second.clusters[0].narrative).toBe('words');
    expect(second.clusters[0].narrativeFingerprint).not.toBe(fingerprint(second.clusters[0].members));
  });

  it('does not let two stored clusters claim the same detected one', () => {
    const stored: StoredCluster[] = [
      { key: 'cl_1', name: 'one', autoLabel: 'one', colourIndex: 0, members: ids('a', 10), size: 10,
        firstSeenAt: base.now, lastSeenAt: base.now, narrative: null, narrativeAt: null,
        narrativeFingerprint: null, mergedFrom: [], splitFrom: null, live: true },
      { key: 'cl_2', name: 'two', autoLabel: 'two', colourIndex: 1, members: ids('a', 9), size: 9,
        firstSeenAt: base.now, lastSeenAt: base.now, narrative: null, narrativeAt: null,
        narrativeFingerprint: null, mergedFrom: [], splitFrom: null, live: true },
    ];
    const r = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 10)]]), stored, mintKey: mint(),
    });
    const live = r.clusters.filter((c) => c.live);
    expect(live).toHaveLength(1);
    expect(live[0].key).toBe('cl_1');
    expect(live[0].mergedFrom).toContain('cl_2');
    expect(r.clusters.find((c) => c.key === 'cl_2')!.live).toBe(false);
  });

  it('retires a cluster that has gone, without deleting its record', () => {
    const first = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 10)], [1, ids('b', 8)]]), stored: [], mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 10)]]), stored: first.clusters, mintKey: mint(),
    });
    const gone = second.clusters.find((c) => c.key === 'cl_2')!;
    expect(gone.live).toBe(false);
    expect(gone.name).toBe(first.clusters[1].name);
    expect(second.changes.retired).toEqual(['cl_2']);
  });

  it('records where a genuinely new cluster split from', () => {
    const first = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 20)]]), stored: [], mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20).slice(0, 12)], [1, ids('a', 20).slice(12)]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    const fresh = second.clusters.find((c) => c.key !== 'cl_1')!;
    expect(fresh.splitFrom).toBe('cl_1');
    expect(second.changes.split).toEqual([fresh.key]);
  });

  it('ignores fragments below the tracked size', () => {
    const r = reconcileClusters({
      ...base, detected: new Map([[0, ids('a', 10)], [1, ids('b', 2)]]), stored: [], mintKey: mint(),
    });
    expect(r.clusters).toHaveLength(1);
  });

  it('fingerprint is order-independent', () => {
    expect(fingerprint(['b', 'a'])).toBe(fingerprint(['a', 'b']));
  });

  it('jaccard is 1 for identical sets and 0 for disjoint', () => {
    expect(jaccard(new Set(['a', 'b']), ['a', 'b'])).toBe(1);
    expect(jaccard(new Set(['a']), ['b'])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jkai/intel/analytics/cluster-identity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Header comment must explain the measured reason the module exists (70.6% index churn in a day, 0.83–1.00 Jaccard self-match). Algorithm:

1. Keep detected communities with `≥ MIN_TRACKED_SIZE` members.
2. Score every (stored-live, detected) pair by Jaccard; sort descending; assign greedily one-to-one above `MATCH_THRESHOLD`. Greedy-descending is what makes the assignment order-independent and gives the two-claimants test its answer: the better overlap wins the key, the loser is marked `live: false` and listed in the winner's `mergedFrom`.
3. Unmatched detected clusters mint a key; if their best overlap with any *already-claimed* stored cluster is ≥ `SPLIT_THRESHOLD`, set `splitFrom` to that key.
4. Unmatched stored clusters get `live: false` and keep everything else.
5. Colour: a matched cluster keeps `colourIndex`; a new one takes the lowest slot in `0..9` not held by a live cluster, falling back to `created % 10` when all ten are in use.
6. `name` is only ever set by the rename route — reconcile writes `autoLabel` and never touches `name`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/jkai/intel/analytics/cluster-identity.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/analytics/cluster-identity.ts src/lib/jkai/intel/analytics/cluster-identity.test.ts
git commit -m "intel: stable cluster identity across recomputation"
```

---

### Task 3: Cluster labelling (pure)

Replaces "name it after its most central member", which on the live graph produces `jkai`, `Johnkelly Main`, `John Kelly`, `United Kingdom` and `User` — three of which name the operator or his email address — and which renamed two unchanged clusters overnight (`Mole Valley Farmers`→`UKCC`, `London`→`United Kingdom`).

**Files:**
- Create: `src/lib/jkai/intel/analytics/cluster-label.ts`
- Test: `src/lib/jkai/intel/analytics/cluster-label.test.ts`

**Interfaces:**
- Produces: `composeClusterLabel(members: GraphNode[], ctx: LabelContext): string`; `interface LabelContext { pagerank: Map<string, number>; degree: Map<string, number>; /** Entities appearing near the top of many clusters — excluded as subjects. */ ubiquitous: ReadonlySet<string> }`; `findUbiquitousEntities(clusters: GraphNode[][], ctx): Set<string>`; `describeComposition(members: GraphNode[]): ClusterComposition`; `interface ClusterComposition { size: number; types: Array<[string, number]>; sources: Array<[string, number]>; sourceless: number; noteTotal: number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { composeClusterLabel, describeComposition } from './cluster-label';
import type { GraphNode } from './model';

const n = (id: string, name: string, typeName: string, sources: string[] = ['email']): GraphNode => ({
  id, name, typeId: typeName, typeName, icon: '', color: '', summary: null, confidence: 'medium',
  confidenceScore: null, confirmed: false, createdAt: 0, updatedAt: 0, noteCount: 1,
  lastSeenAt: 0, evidenceAt: 0, aliases: [], categories: [], sources,
});

const ctx = (order: string[]) => ({
  pagerank: new Map(order.map((id, i) => [id, order.length - i])),
  degree: new Map(order.map((id, i) => [id, order.length - i])),
  ubiquitous: new Set<string>(),
});

describe('composeClusterLabel', () => {
  it('names the cluster after its two leading members', () => {
    const members = [n('1', 'Costco UK', 'organisation'), n('2', 'Brakeburn', 'organisation'), n('3', 'Socks', 'product')];
    expect(composeClusterLabel(members, ctx(['1', '2', '3']))).toBe('Costco UK · Brakeburn');
  });

  it('skips an entity that leads many clusters', () => {
    const members = [n('1', 'John Kelly', 'person'), n('2', 'IBCA', 'organisation'), n('3', 'Data Strategy', 'policy')];
    const c = { ...ctx(['1', '2', '3']), ubiquitous: new Set(['1']) };
    expect(composeClusterLabel(members, c)).toBe('IBCA · Data Strategy');
  });

  it('falls back to the composition when every leader is ubiquitous', () => {
    const members = [n('1', 'John Kelly', 'person'), n('2', 'User', 'person')];
    const c = { ...ctx(['1', '2']), ubiquitous: new Set(['1', '2']) };
    expect(composeClusterLabel(members, c)).toBe('2 people');
  });

  it('never returns an empty label', () => {
    expect(composeClusterLabel([], ctx([]))).toBe('Unnamed cluster');
  });
});

describe('describeComposition', () => {
  it('counts types and sources, and flags entities with no provenance', () => {
    const members = [
      n('1', 'A', 'product', ['email']), n('2', 'B', 'product', ['email', 'chat']), n('3', 'C', 'person', []),
    ];
    const c = describeComposition(members);
    expect(c.size).toBe(3);
    expect(c.types[0]).toEqual(['product', 2]);
    expect(c.sources[0]).toEqual(['email', 2]);
    expect(c.sourceless).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/jkai/intel/analytics/cluster-label.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

`composeClusterLabel` takes the two highest-pagerank members not in `ubiquitous` and joins them with ` · `. If fewer than two survive, fall back to `${size} ${pluralisedDominantType}`. `findUbiquitousEntities` marks any entity that is in the top 3 by pagerank of more than a quarter of the tracked clusters — this is what stops "John Kelly" naming four different things.

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/analytics/cluster-label.ts src/lib/jkai/intel/analytics/cluster-label.test.ts
git commit -m "intel: compose cluster labels from leaders and composition, not one hub"
```

---

### Task 4: Cluster store (datastore persistence)

**Files:**
- Create: `src/lib/jkai/intel/cluster-store.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `$lib/datastore`.
- Produces: `INTEL_CLUSTERS_COLLECTION = 'intel_clusters'`; `ensureClusterCollection(): Promise<void>`; `loadClusters(): Promise<StoredCluster[]>`; `saveClusters(clusters: StoredCluster[]): Promise<void>`; `reconcileFromAnalysis(analysis: GraphAnalysis, opts?: { resolution?: number }): Promise<{ clusters: StoredCluster[]; keyByIndex: Map<number, string>; resolution: number; changes: ReconcileResult['changes'] }>`; `renameCluster(key: string, name: string | null): Promise<StoredCluster | null>`; `setClusterNarrative(key: string, narrative: string, fingerprint: string, citations: unknown[]): Promise<void>`.

- [ ] **Step 1: Implement, mirroring `run-log.ts` exactly**

Same `PermissionSet` (`read: ['owner','jkai','system']`, `write: ['system','owner']`, `delete: ['owner','system']`), same `SYSTEM_ACTOR`, same `ensureCollection`/`upsertRecord`/`queryRecords` calls, one record per cluster keyed on its stable key. Pin the collection slug in a comment — renaming it orphans every name the user has typed.

`reconcileFromAnalysis` is the only orchestration point: it runs `autoTuneResolution`, re-detects at the chosen γ if it differs from the analysis's, builds `labelFor` from Task 3, mints keys with `crypto.randomUUID().slice(0, 8)`, calls `reconcileClusters`, and persists. Wrap the write in try/catch and log — reading the dashboard must not fail because the write did, the same rule the insights route applies.

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/intel/cluster-store.ts
git commit -m "intel: persist the cluster roster in the datastore"
```

---

### Task 5: Cluster API route

**Files:**
- Create: `src/routes/api/jkai/intel/clusters/+server.ts`

**Interfaces:**
- `GET` → `{ clusters: ClusterView[], resolution, candidates, stats, clusterGraph }` where `ClusterView` is the stored record plus `label` (name ?? autoLabel), `composition`, `medianRelevance`, `signal`, `delta: { joined, left, sinceAt }`, `bridges: Array<{ id, name, toKey }>`, `narrativeStale: boolean`.
- `POST { action: 'recalculate' }` → invalidate, force, reconcile, return the same shape as GET.
- `POST { action: 'rename', key, name }` → rename (empty string clears back to the auto label).
- `POST { action: 'narrate', key }` → Task 7.
- `clusterGraph`: `{ nodes: Array<{ key, label, size, colourIndex }>, links: Array<{ source, target, count }> }` — cross-cluster edge counts, for Task 10's map.

Remember: **no non-handler exports.** Module-level caches are fine; exporting them is not.

- [ ] **Step 1: Implement GET + recalculate + rename**
- [ ] **Step 2: Verify against the live graph**

```bash
npm run dev &
curl -s 'http://homeserv:5173/api/jkai/intel/clusters' | head -c 800
```
Expected: a roster with stable keys, `resolution` around 1.25, and no cluster over 8% of the connected graph.

- [ ] **Step 3: Prove identity holds across a recompute**

```bash
curl -s -X POST http://homeserv:5173/api/jkai/intel/clusters -H 'content-type: application/json' \
  -d '{"action":"rename","key":"<key>","name":"DfE work"}'
curl -s -X POST http://homeserv:5173/api/jkai/intel/clusters -H 'content-type: application/json' \
  -d '{"action":"recalculate"}' | grep -o '"DfE work"'
```
Expected: `"DfE work"` still present, on the same key.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/jkai/intel/clusters/+server.ts
git commit -m "intel: cluster roster API — recalculate and rename"
```

---

### Task 6: Stable colour and key in the network payload

**Files:**
- Modify: `src/routes/api/jkai/intel/network/+server.ts`
- Modify: `src/lib/components/intel/graph-visual.ts`
- Modify: `src/lib/components/intel/NetworkGraph.svelte`, `NetworkGraph3D.svelte`
- Test: `src/lib/components/intel/graph-visual.test.ts`

Each node gains `clusterKey: string | null` and `clusterColourIndex: number | null`; each `communities[]` entry gains `key` and `colourIndex`. `clusterColour` keeps its signature and is fed `colourIndex` instead of the community index, so the graph stops repainting itself nightly. The 2D `forceX` and the 3D `communityDirection` take `colourIndex` too — otherwise the spatial regions still shuffle. Fall back to the community index when the key is absent, so a tab open across a deploy still draws.

- [ ] **Step 1:** Add a test asserting the same colour index yields the same colour across two payloads whose community indices differ.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run src/lib/components/intel/` → PASS.
- [ ] **Step 4:** Commit `"intel: colour and place clusters by stable identity"`.

---

### Task 7: Cluster narrative, by reusing brief.ts

**Files:**
- Modify: `src/lib/jkai/intel/brief.ts`
- Modify: `src/routes/api/jkai/intel/clusters/+server.ts`
- Test: `src/lib/jkai/intel/cluster-brief.test.ts`

**Interfaces:**
- Produces: `assembleClusterBriefContext(memberIds: readonly string[], cluster: { label: string; composition: ClusterComposition; span: { from: string; to: string } | null; bridges: Array<{ name: string; toLabel: string }> }): Promise<BriefContext>` — delegates to `assembleBriefContext` for the top 12 members by pagerank, then sets `title` and pushes the composition into `openQuestions`-adjacent framing so the prose describes the *shape* as well as the subjects.

The narrative must state: what this cluster is about, what evidence it rests on (**which sources, how many notes, over what period**), what is thin or unverified in it, and what connects it to the rest of the graph. Citations come free — `reconcileCitations` already strips markers the model invents.

- [ ] **Step 1: Test the pure prompt half**

Assert the built prompt names the source mix and the date span, and that a cluster with `sourceless > 0` produces a prompt that mentions unevidenced entities. (Follow the existing `brief.test.ts` pattern — it tests `buildBriefPrompt`, not the LLM.)

- [ ] **Step 2: Implement, wire `POST { action: 'narrate', key }`**

Store via `setClusterNarrative` with `fingerprint(members)`. Serve the cached narrative whenever the fingerprint still matches; the route reports `narrativeStale` when it does not, and the UI offers a refresh rather than silently regenerating.

- [ ] **Step 3:** `npx vitest run src/lib/jkai/intel/` → PASS.
- [ ] **Step 4: Verify a real narrative on the live graph**

```bash
curl -s -X POST http://homeserv:5173/api/jkai/intel/clusters -H 'content-type: application/json' \
  -d '{"action":"narrate","key":"<the IBCA cluster key>"}' | head -c 1200
```
Expected: prose naming IBCA's actual documents, with citations resolving to real note ids.

- [ ] **Step 5:** Commit `"intel: cited cluster narratives via the brief pipeline"`.

---

### Task 8: Cluster card

**Files:**
- Create: `src/lib/components/intel/ClusterCard.svelte`
- Modify: `src/lib/components/intel/ClusterPicker.svelte`

Rows expand in place to a card: editable name (Enter commits, Escape reverts, empty restores the auto label), size with delta since the last reconcile, a source-mix bar (email/chat/file/research — `dataviz` idiom, tokenised colours), date span, top five members, bridges out, and the narrative with its citations. Focus and `only` keep working exactly as now — this is additive.

Read the `svelte5-pitfalls` skill first. Fully controlled, no state of its own beyond which card is expanded, matching `SourcePicker`.

- [ ] **Step 1:** Build the card. **Step 2:** `npm run check`. **Step 3:** Screenshot at `http://homeserv:5173/jkai/intel`. **Step 4:** Commit.

---

### Task 9: Ranking and the tail

**Files:**
- Modify: `src/lib/components/intel/ClusterPicker.svelte`
- Modify: `src/routes/jkai/intel/+page.svelte`

Two changes, both justified by the baseline:

1. **Order by signal, not size.** `signal = medianRelevance × ln(1 + size)`. Size alone puts four retail-email clusters (Costco 250, Brakeburn 229, UKCC 212, competitions 288) above DfE Data Spine (206) and IBCA (205). Show the sort in the hint text so the order is explicable.
2. **Roll up the tail.** List clusters of ≥5 (89 today, ~106 after tuning); replace the 2,632 singletons with one row — "2,632 unconnected entities" — linking to `/jkai/intel/quality`. Change the stat strip from `communities` (2,937, a number that means nothing) to the tracked-cluster count.

- [ ] **Step 1:** Implement. **Step 2:** `npm run check`. **Step 3:** Verify DfE and IBCA now rank above the retail clusters. **Step 4:** Commit.

---

### Task 10: Cluster map view

**Files:**
- Create: `src/lib/components/intel/ClusterMap.svelte`
- Modify: `src/routes/jkai/intel/+page.svelte`

A third view mode beside 2D and 3D: one bubble per cluster, area by entity count, edge thickness by cross-cluster edge count, colour by `colourIndex`, label by name. Click focuses that cluster in the entity views.

This is the only view that shows the whole graph: the entity views ship the 600 most central nodes of 9,042, so the picture you look at today is not the graph the clusters were computed on. d3-force, same force idiom as `NetworkGraph.svelte`, driven by `clusterGraph` from Task 5.

- [ ] **Step 1:** Build. **Step 2:** `npm run check`. **Step 3:** Screenshot. **Step 4:** Commit.

---

### Task 11: Full cluster view

**Files:**
- Create: `src/routes/jkai/intel/clusters/+page.svelte`, `+page.server.ts`
- Create: `src/routes/jkai/intel/clusters/[key]/+page.svelte`, `+page.server.ts`

Index lists every tracked cluster as a card. `[key]` gives one cluster the room the rail cannot: full narrative, the whole citation list, member table sortable by relevance/degree/recency, bridges, the evidence-over-time histogram (reuse the entity-card sparkline), and merge/split history. Follow `/jkai/intel/entities/[id]` for layout and the layout's owner gate.

- [ ] **Step 1:** Build. **Step 2:** `npm run check`. **Step 3:** Screenshot both. **Step 4:** Commit.

---

### Task 12: Cluster insights

**Files:**
- Modify: `src/lib/jkai/intel/analytics/insights.ts`
- Modify: `src/lib/jkai/intel/insight-store.ts`
- Test: `src/lib/jkai/intel/analytics/insights.test.ts`

Three kinds, each only possible now that clusters persist:
- `cluster_emerging` — a cluster crossed a size/velocity threshold since it was first seen.
- `cluster_merging` — two previously separate clusters became one. "Two areas of your life just connected" is the highest-value structural signal in the set.
- `cluster_dormant` — a cluster with no new evidence for 30 days.

Add the three to `InsightKind`. Add `cluster_emerging` and `cluster_dormant` to `SAMPLE_KINDS` in `insight-store.ts` only if their `entityIds` is a rolling sample; `cluster_merging` names specific clusters, so its ids ARE its identity and it must not be sampled.

- [ ] **Step 1:** Tests first, following the existing detector tests. **Step 2:** Implement. **Step 3:** `npx vitest run src/lib/jkai/intel/` → PASS. **Step 4:** Commit.

---

### Task 13: Cluster as a lens, and a chat handle

**Files:**
- Modify: `src/lib/jkai/intel/lenses.ts`, `lenses.server.ts`
- Modify: `src/lib/components/intel/ClusterCard.svelte`
- Modify: `src/lib/jkai/intel/context.ts`

`intel_lenses.filters.communityIds` already exists and is silently broken by unstable indices — a lens saved on Monday filters a different set on Tuesday. Migrate it to `clusterKeys`, resolving keys to the current membership at query time, and keep reading `communityIds` for saved lenses (mapping through the roster where possible, ignoring it where not — a filter that cannot be evaluated is skipped, not failed, per the lens module's own rule 2).

Add "Save as lens" to the cluster card, and put the cluster roster (key, name, size, one-line label) into the jkai intel context so "tell me about the DfE cluster" resolves.

- [ ] **Step 1:** Implement. **Step 2:** `npx vitest run src/lib/jkai/intel/lenses.test.ts` → PASS. **Step 3:** Verify in chat. **Step 4:** Commit.

---

## Verification before the PR

1. `npx vitest run src/lib/jkai/intel/ src/lib/components/intel/` — all green.
2. `npm run check` — no new errors.
3. On `http://homeserv:5173/jkai/intel`: rename a cluster, press recalculate, confirm the name and colour are still on the same body of entities.
4. Generate a narrative for the IBCA cluster and confirm every citation opens a real note.
5. Confirm the picker's top rows are work clusters, not retail email.
6. Screenshot the cluster map with all clusters visible.

Then: branch → PR → wait on the run conclusion (never `gh pr merge --auto`) → squash merge → CI deploys → verify live.

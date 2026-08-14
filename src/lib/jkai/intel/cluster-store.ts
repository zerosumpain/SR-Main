// The cluster roster — the durable half of clustering.
//
// Follows the house rule the other engines follow (see $lib/jkai/intel/run-log,
// $lib/workflowdoctor/types and $lib/selfimprove/types): engine state lives in
// the DATASTORE, so there is no dedicated table, no `drizzle-kit push`, and no
// CI TTY-prompt risk on deploy.
//
// This module is the only DB-aware part of clustering. The matching, labelling
// and tuning it orchestrates are all pure and live in ./analytics, which is what
// lets them be tested against real production partitions without a database.
import { ensureCollection, upsertRecord, queryRecords, deleteRecord } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import type { GraphAnalysis } from './analytics/load';
import { detectCommunities, autoTuneResolution } from './analytics/community';
import {
  reconcileClusters,
  fingerprint,
  MIN_TRACKED_SIZE,
  type ReconcileChanges,
  type StoredCluster,
} from './analytics/cluster-identity';
import { composeClusterLabel, findUbiquitousEntities } from './analytics/cluster-label';
import type { GraphNode } from './analytics/model';

/** Actor every cluster-store write runs as. */
export const SYSTEM_ACTOR = 'system';

/**
 * Pinned. Renaming this orphans every name the user has typed and every
 * narrative that has been paid for.
 */
export const INTEL_CLUSTERS_COLLECTION = 'intel_clusters';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

/** The datastore caps a page at 500; the roster outgrows that within a year. */
const PAGE = 200;

/**
 * How long an unnamed, undescribed cluster is kept after it stops being found.
 *
 * The roster churns harder than it looks: replaying a real week of ingest, each
 * reconcile created 6–14 clusters and retired 3–18. Keeping every one of those
 * forever would add several thousand dead records a year, all of them things
 * nobody named and nothing described.
 *
 * A fortnight is long enough to cover the case this is really protecting
 * against — a cluster that breaks up for a few days and reforms — while keeping
 * the roster to the size of the graph rather than the size of its history.
 * Anything the user named or paid an LLM to describe is kept indefinitely
 * regardless of age; the whole point of the roster is that those survive.
 */
export const RETIRED_TTL_MS = 14 * 86_400_000;

export interface ClusterReconcileResult {
  clusters: StoredCluster[];
  keyByIndex: Map<number, string>;
  resolution: number;
  changes: ReconcileChanges;
  /** True when this reconcile actually recomputed rather than reusing a snapshot. */
  recomputed: boolean;
}

/** Idempotent; safe on every boot and again before any write. */
export async function ensureClusterCollection(): Promise<void> {
  await ensureCollection(
    INTEL_CLUSTERS_COLLECTION,
    {
      name: 'Intel Clusters',
      description:
        'One record per detected cluster — its stable key, the name the user gave it, its colour, its members, and its narrative.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

export async function loadClusters(): Promise<StoredCluster[]> {
  await ensureClusterCollection();
  const out: StoredCluster[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = await queryRecords(
      INTEL_CLUSTERS_COLLECTION,
      { limit: PAGE, offset, sort: { path: 'firstSeenAt', dir: 'asc' } },
      SYSTEM_ACTOR,
    );
    for (const record of records) out.push(record.data as unknown as StoredCluster);
    if (records.length < PAGE) break;
  }
  return out;
}

/**
 * Persist only what changed.
 *
 * A reconcile touches every cluster in the roster, but on a typical run the vast
 * majority come back byte-identical — same members, same label, same everything.
 * Writing all of them would be ~120 upserts each time the dashboard is opened,
 * against a handful that actually moved.
 */
async function saveChanged(next: StoredCluster[], previous: StoredCluster[]): Promise<number> {
  const before = new Map(previous.map((c) => [c.key, JSON.stringify(c)]));
  let written = 0;
  for (const cluster of next) {
    if (before.get(cluster.key) === JSON.stringify(cluster)) continue;
    await upsertRecord(
      INTEL_CLUSTERS_COLLECTION,
      { key: cluster.key, data: cluster as unknown as Record<string, unknown> },
      SYSTEM_ACTOR,
    );
    written++;
  }
  return written;
}

/**
 * Drop retired clusters nobody named or described, once they are old enough.
 * Returns how many went.
 */
export async function pruneRetiredClusters(now = Date.now()): Promise<number> {
  const clusters = await loadClusters();
  let pruned = 0;
  for (const cluster of clusters) {
    if (cluster.live) continue;
    if (cluster.name || cluster.narrative) continue;
    const lastSeen = Date.parse(cluster.lastSeenAt);
    if (!Number.isFinite(lastSeen) || now - lastSeen < RETIRED_TTL_MS) continue;
    await deleteRecord(INTEL_CLUSTERS_COLLECTION, { key: cluster.key }, SYSTEM_ACTOR);
    pruned++;
  }
  return pruned;
}

/**
 * The analysis snapshot the last reconcile ran against.
 *
 * Clusters are a pure function of the partition, so while the snapshot holds
 * there is nothing to redo. Same reasoning as `lastPersistedAnalysis` in the
 * insights route: a polling dashboard would otherwise re-run Louvain's whole
 * resolution sweep and rewrite the roster several times a minute.
 */
let lastReconciledAt = 0;
let lastResult: ClusterReconcileResult | null = null;

/**
 * Bring the roster up to date with a graph analysis.
 *
 * Re-tunes the resolution rather than reusing the analysis's own partition,
 * because `getGraphAnalysis` detects at the default γ=1 for everything else that
 * reads it, and the tuned partition is the one the cluster surfaces are built
 * on. Passing an explicit `resolution` skips the sweep — used by the API when
 * the caller has already chosen one.
 */
export async function reconcileFromAnalysis(
  analysis: GraphAnalysis,
  opts: { resolution?: number; force?: boolean } = {},
): Promise<ClusterReconcileResult> {
  if (!opts.force && lastResult && lastReconciledAt === analysis.computedAt) {
    return { ...lastResult, recomputed: false };
  }

  const { index, centrality } = analysis;
  const resolution = opts.resolution ?? autoTuneResolution(index).resolution;
  const partition =
    resolution === analysis.community.resolution
      ? analysis.community
      : detectCommunities(index, resolution);

  const memberNodes = (ids: readonly string[]): GraphNode[] =>
    ids.map((id) => index.byId.get(id)).filter((n): n is GraphNode => Boolean(n));

  const tracked = new Set(
    [...partition.communities.entries()]
      .filter(([, ids]) => ids.length >= MIN_TRACKED_SIZE)
      .map(([community]) => community),
  );
  const ubiquitous = findUbiquitousEntities(index, partition.membership, tracked);

  const stored = await loadClusters();
  const result = reconcileClusters({
    detected: partition.communities,
    stored,
    labelFor: (ids) =>
      composeClusterLabel(memberNodes(ids), { pagerank: centrality.pagerank, ubiquitous }),
    // Eight hex characters over a roster of a few hundred: collisions are
    // vanishingly unlikely, and `reconcileClusters` refuses to mint one anyway.
    mintKey: () => crypto.randomUUID().slice(0, 8),
    now: new Date().toISOString(),
  });

  try {
    await saveChanged(result.clusters, stored);
  } catch (err) {
    // Reading the dashboard must not fail because the write did — the same rule
    // the insights route applies. Reset so the next caller retries rather than
    // treating an unsaved roster as saved for the life of the snapshot.
    lastReconciledAt = 0;
    lastResult = null;
    console.warn('[intel/clusters] roster write failed', err);
    return { ...result, resolution, recomputed: true };
  }

  lastReconciledAt = analysis.computedAt;
  lastResult = { ...result, resolution, recomputed: true };
  return lastResult;
}

/** Forget the memoised reconcile. Call after any write that edits a cluster. */
export function invalidateClusterReconcile(): void {
  lastReconciledAt = 0;
  lastResult = null;
}

/**
 * Name a cluster, or clear the name back to the generated label.
 *
 * Records the membership the name was typed on, which is what makes drift
 * measurable later — see `nameDrift`. Clearing a name clears that too: the
 * question "how far has this moved from what you called it" has no meaning once
 * nobody is calling it anything.
 */
export async function renameCluster(key: string, name: string | null): Promise<StoredCluster | null> {
  const clusters = await loadClusters();
  const cluster = clusters.find((c) => c.key === key);
  if (!cluster) return null;

  const trimmed = name?.trim() ?? '';
  const next: StoredCluster = trimmed
    ? {
        ...cluster,
        name: trimmed,
        namedAt: new Date().toISOString(),
        namedMembers: [...cluster.members],
      }
    : { ...cluster, name: null, namedAt: null, namedMembers: null };

  await upsertRecord(
    INTEL_CLUSTERS_COLLECTION,
    { key, data: next as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  invalidateClusterReconcile();
  return next;
}

/**
 * Attach a generated narrative to a cluster.
 *
 * The fingerprint is the membership it was written against, not the time. A
 * narrative does not go stale because a day passed; it goes stale because the
 * cluster it describes is no longer the same set of entities.
 */
export async function setClusterNarrative(
  key: string,
  narrative: string,
  members: readonly string[],
): Promise<StoredCluster | null> {
  const clusters = await loadClusters();
  const cluster = clusters.find((c) => c.key === key);
  if (!cluster) return null;

  const next: StoredCluster = {
    ...cluster,
    narrative,
    narrativeAt: new Date().toISOString(),
    narrativeFingerprint: fingerprint(members),
  };
  await upsertRecord(
    INTEL_CLUSTERS_COLLECTION,
    { key, data: next as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
  invalidateClusterReconcile();
  return next;
}

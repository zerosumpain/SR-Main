// src/lib/selfimprove/epics.ts
//
// The themes found in the queue, and what the owner decided about them.
//
// `cluster.ts` finds groupings and is pure. This is the half that remembers:
// which groupings have been proposed, which were accepted (and so wrote an
// `epicSlug` onto every member), and which were refused.
//
// **A declined grouping is never re-proposed.** Same rule as
// `daydream_capabilities`, and for the same reason it was written there: the
// 19–29 Jul runs re-proposed "news digest" every night for ten nights because
// nothing recorded the no.

import { getCollectionBySlug, getRecordByKey, queryRecords, upsertRecord } from '$lib/datastore';
import { COLLECTIONS, SYSTEM_ACTOR, asData, errMsg, type EpicData, type EpicStatus } from './types';
import { clusterBacklog, clusterWeight, type Cluster } from './cluster';
import { getBacklogItem, setEpic, listBacklog } from './backlog';
import { looksSameSubject } from './narrative';
import type { BacklogItemData } from './types';

const PAGE = 500;
const MAX_PAGES = 10;

/**
 * Read every epic.
 *
 * **Throws.** Writes in this engine are soft — a ledger that cannot be written
 * must not cost the tick that tried — but reads are not, and for the reason
 * `appetite/store.ts` states: a room that cannot load its ledger should SAY so,
 * rather than render the empty state and assert there is nothing there. A
 * swallowed read here would show "Nothing grouped yet" over a hundred accepted
 * themes.
 *
 * Pages for the same reason `listBacklog` does — a capped read that silently
 * truncates is how 210 of 410 backlog rows went missing.
 */
export async function listEpics(): Promise<EpicData[]> {
  if (!(await getCollectionBySlug(COLLECTIONS.epics))) return [];
  const out: EpicData[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { records } = await queryRecords(
      COLLECTIONS.epics,
      { sort: { field: 'updatedAt', dir: 'desc' }, limit: PAGE, offset: page * PAGE },
      SYSTEM_ACTOR,
    );
    out.push(...records.map((r) => r.data as unknown as EpicData));
    if (records.length < PAGE) break;
  }
  return out;
}

async function put(epic: EpicData): Promise<void> {
  await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData(epic) }, SYSTEM_ACTOR);
}

async function getEpic(slug: string): Promise<EpicData | null> {
  try {
    const rec = await getRecordByKey(COLLECTIONS.epics, slug, SYSTEM_ACTOR);
    return (rec?.data as unknown as EpicData) ?? null;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'not_found') return null;
    throw err;
  }
}

export interface FindThemesResult {
  /** Proposals written by this run — new groupings only. */
  proposed: EpicData[];
  /** Groupings skipped because they were already on the ledger. */
  known: number;
  /** Groupings skipped because the owner had already said no. */
  declined: number;
  /** New groupings found but not proposed tonight, because of the cap. */
  uncapped: number;
  /** Everything the clusterer reported, for the pulse. */
  clusters: number;
  singletons: number;
  oversized: Array<{ label: string; size: number }>;
}

/**
 * Find the themes in the queue and write the new ones to the ledger.
 *
 * Reads the backlog once and does all its work in memory — measured at **66ms
 * for 455 rows**, so this is cheap enough to run on demand from the room as
 * well as nightly. No LLM call, and nothing here writes a sentence.
 *
 * `servedSlugs` is computed with the same `looksSameSubject` the board uses,
 * so "already served" means one thing across the whole engine.
 */
export async function findThemes(
  opts: { items?: BacklogItemData[]; maxProposals?: number } = {},
): Promise<FindThemesResult> {
  const items = opts.items ?? (await listBacklog());
  const shipped = items.filter((i) => i.status === 'shipped');
  const served = new Set<string>();
  for (const i of items) {
    if (i.status !== 'open') continue;
    if (shipped.some((s) => looksSameSubject(i.title, s.title))) served.add(i.slug);
  }

  const res = clusterBacklog(items, served);
  const existing = new Map((await listEpics()).map((e) => [e.slug, e]));

  const out: FindThemesResult = {
    proposed: [],
    known: 0,
    declined: 0,
    uncapped: 0,
    clusters: res.clusters.length,
    singletons: res.singletons,
    oversized: res.oversized,
  };

  const now = new Date().toISOString();
  const cap = opts.maxProposals ?? Number.POSITIVE_INFINITY;

  for (const c of res.clusters) {
    // A grouping with no open members is history, not a decision.
    if (c.openSlugs.length < 2) continue;
    const known = existing.get(c.slug);
    if (known) {
      if (known.status === 'declined') out.declined += 1;
      else out.known += 1;
      continue;
    }
    // `continue`, never `break`: the cap limits how many rulings the room asks
    // for, and breaking out would also stop counting the clusters below it —
    // the nightly summary would then report off partial figures.
    if (out.proposed.length >= cap) {
      out.uncapped += 1;
      continue;
    }
    const epic = toEpic(c, now);
    try {
      await put(epic);
      out.proposed.push(epic);
    } catch (err) {
      console.error('[selfimprove] epic not recorded:', errMsg(err));
    }
  }
  return out;
}

/** Cluster → record. Separated so it is testable without a datastore. */
export function toEpic(c: Cluster, now: string): EpicData {
  const { score, components } = clusterWeight(c);
  return {
    slug: c.slug,
    label: c.label.slice(0, 200),
    keywords: c.keywords,
    memberSlugs: c.memberSlugs,
    score,
    components,
    openSlugs: c.openSlugs,
    shippedSlugs: c.shippedSlugs,
    servedCount: c.servedCount,
    status: 'proposed',
    createdAt: now,
    updatedAt: now,
  };
}

export interface DecideResult {
  slug: string;
  status: EpicStatus;
  /** Members whose `epicSlug` was written. Empty on a decline. */
  grouped: string[];
  /** Members that could not be written, with the reason. */
  failed: Array<{ slug: string; error: string }>;
}

/**
 * Rule on a theme.
 *
 * Accepting **groups, it does not fold.** Every member gets the epic's slug so
 * the board's swimlanes light up, and the owner then decides inside that lane
 * which items to fold into one. Those are two different judgements — "these
 * are about the same subject" and "these say the same thing" — and collapsing
 * them would abandon items on a matcher's say-so, which is exactly the
 * authority this engine does not give a matcher.
 *
 * A decline is permanent for this membership. Change the membership and it is
 * a different grouping, so a different claim, and it may be proposed again.
 */
export async function decideEpic(
  slug: string,
  decision: 'accept' | 'decline',
  by: 'owner' | 'engine' = 'owner',
): Promise<DecideResult> {
  const epic = await getEpic(slug);
  if (!epic) throw new Error(`no such theme “${slug}”`);

  const now = new Date().toISOString();
  const next: EpicData = {
    ...epic,
    status: decision === 'accept' ? 'accepted' : 'declined',
    decidedBy: by,
    decidedAt: now,
    updatedAt: now,
  };

  const grouped: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];
  if (decision === 'accept') {
    for (const member of epic.memberSlugs) {
      try {
        await setEpic(member, epic.slug);
        grouped.push(member);
      } catch (err) {
        failed.push({ slug: member, error: errMsg(err) });
      }
    }
  }

  await put(next);
  return { slug, status: next.status, grouped, failed };
}

/** Drop an accepted grouping: clears `epicSlug` from its members and puts the
 *  theme back to `proposed`, so a mistaken accept is one click to undo. */
export async function ungroupEpic(slug: string): Promise<DecideResult> {
  const epic = await getEpic(slug);
  if (!epic) throw new Error(`no such theme “${slug}”`);
  const grouped: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];
  for (const member of epic.memberSlugs) {
    try {
      // Only clear what THIS theme grouped. Memberships shift between runs: a
      // fourth similar idea arrives, the next scan proposes a new theme over
      // the same rows (a new slug, by design), the owner accepts it — and
      // ungrouping the stale one would strip the live theme off its members
      // while it still showed as accepted.
      const item = await getBacklogItem(member);
      if (item?.epicSlug !== epic.slug) continue;
      await setEpic(member, null);
      grouped.push(member);
    } catch (err) {
      failed.push({ slug: member, error: errMsg(err) });
    }
  }
  const now = new Date().toISOString();
  await put({ ...epic, status: 'proposed', decidedBy: undefined, decidedAt: undefined, updatedAt: now });
  return { slug, status: 'proposed', grouped, failed };
}

// src/lib/selfimprove/backlog-room.server.ts
//
// The backlog room's grooming, ledger half — one home since 2026-10-02 (it was
// `epics.ts`, `epic-backlog.server.ts` and `$lib/workflows/backlog-grooming.server.ts`).
//
//  - themes: what the clusterer found and what the owner ruled (declined
//    groupings are never re-proposed);
//  - the room: the board folded into epics, read-only for any page view;
//  - grooming: twin dedupe with citations, applied automatically by the
//    heartbeat's `backlog-grooming` activity and after every intake, under one
//    advisory lock, and by the owner from the review lane.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { getCollectionBySlug, getRecordByKey, queryRecords, upsertRecord } from '$lib/datastore';
import { COLLECTIONS, SYSTEM_ACTOR, asData, errMsg, type BacklogItemData, type EpicData, type EpicStatus } from './types';
import { buildEpicBacklog, clusterBacklog, clusterWeight, suggestBacklogGrooming, type BacklogEpic, type Cluster } from './backlog-room';
import { getBacklogItem, listBacklog, MAX_ATTEMPTS, setEpic, setPriority } from './backlog';
import { buildBoard, type BoardView } from './board';
import { looksSameSubject } from './narrative';
import { ensureSystemCollections } from './seed-apis';
import { loadCustomToolHealth } from './context';

// ── Themes ──────────────────────────────────────────────────────────────────
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

  if (epic.mergedInto) throw new Error('This theme has already been merged');

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
  if (epic.mergedInto) throw new Error('A merged epic cannot be ungrouped');
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

// ── The room ────────────────────────────────────────────────────────────────

export interface BacklogRoom {
  epics: BacklogEpic[];
  /**
   * The board the epics were folded out of.
   *
   * Kept rather than discarded because the room draws three things off it that
   * no epic carries: the instrument deck's totals, the burndown reconstruction,
   * and the intake window. `buildBoard` computes all three on the way past, so
   * returning it costs nothing and saves the page a second full read.
   */
  board: BoardView;
}

type RoomSources = { backlog: BacklogItemData[]; tools: Awaited<ReturnType<typeof loadCustomToolHealth>>; saved: EpicData[] };
async function roomSources(): Promise<RoomSources> {
  const [backlog, tools, saved] = await Promise.all([listBacklog(undefined, { strict: true }), loadCustomToolHealth(), listEpics()]);
  return { backlog, tools, saved };
}

/** The board folded into epics, with the owner's grooming lane on each. Writes nothing. */
function foldRoom({ backlog, tools, saved }: RoomSources, withGrooming: boolean): BacklogRoom {
  const board = buildBoard({ backlog, tools, attemptCeiling: MAX_ATTEMPTS, settledLimit: null });
  const epics = buildEpicBacklog(board.items, saved);
  if (!withGrooming) return { epics, board };
  const suggestions = suggestBacklogGrooming(board.items, tools, new Set(saved.flatMap((e) => e.groomingOverrides ?? [])));
  const kept = new Set(saved.flatMap((e) => e.groomingKept ?? []));
  for (const epic of epics) {
    const ids = new Set(epic.deliverables.map((i) => i.id));
    epic.suggestions = suggestions.filter((s) => ids.has(s.itemId) && !kept.has(s.id));
    epic.groomingHistory = saved.flatMap((e) => e.groomingHistory ?? []).filter((a) => ids.has(a.itemId));
    epic.groomingOverrides = saved.flatMap((e) => e.groomingOverrides ?? []).filter((id) => ids.has(id));
  }
  return { epics, board };
}

/**
 * The room as it stands, read-only: the same board and epics `loadBacklogRoom`
 * folds, without saving the epics back, seeding the collections or applying
 * a grooming decision. Every page view reads this — the owner's with the
 * grooming lane (`grooming: true`), a member's without, since suggestions are
 * the owner's to act on. The writes happen on the heartbeat
 * (`backlog-grooming`), after intake and on an owner's decision.
 */
export async function readBacklogRoom(opts: { grooming?: boolean } = {}): Promise<BacklogRoom> {
  return foldRoom(await roomSources(), opts.grooming === true);
}

/** Reconcile from the backlog — the one intake queue since D3 (2026-09-26), when
 * the appetite ledger's capability leads were retired. Every arrival is assigned automatically;
 * grouping never abandons deliverables, changes their status or starts a build.
 */
export async function loadBacklogRoom(): Promise<BacklogRoom> {
  await ensureSystemCollections();
  const sources = await roomSources();
  const room = foldRoom(sources, true);
  const now = new Date().toISOString();
  for (const epic of room.epics) {
    const old = sources.saved.find((e) => e.slug === epic.slug);
    const ids = epic.deliverables.map((i) => i.id).sort();
    if (old?.automatic && JSON.stringify(old.deliverableIds) === JSON.stringify(ids) && old.label === epic.title) continue;
    const row: EpicData = { ...old, slug: epic.slug, label: epic.title, keywords: old?.keywords ?? [],
      memberSlugs: epic.deliverables.map((i) => i.slug),
      openSlugs: epic.deliverables.filter((i) => i.backlogStatus === 'open').map((i) => i.slug),
      shippedSlugs: epic.deliverables.filter((i) => i.backlogStatus === 'shipped').map((i) => i.slug),
      score: old?.score ?? 0, components: old?.components ?? {}, servedCount: old?.servedCount ?? 0,
      status: 'accepted', automatic: true, deliverableIds: ids, decidedBy: 'engine',
      createdAt: old?.createdAt ?? now, updatedAt: now };
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData(row) }, SYSTEM_ACTOR);
  }
  return room;
}

/** The epics alone, for the callers that never wanted the board. */
export async function loadEpicBacklog(): Promise<BacklogEpic[]> {
  return (await loadBacklogRoom()).epics;
}

export async function updateEpic(slug: string, title: string, summary: string, priority?: number): Promise<void> {
  const current = (await loadEpicBacklog()).find((e) => e.slug === slug);
  if (!current) throw new Error('Epic no longer exists; reload the backlog');
  if (!title.trim()) throw new Error('An epic needs a title');
  if (priority != null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) throw new Error('Priority must be P1–P5');
  const record = await getRecordByKey(COLLECTIONS.epics, slug, SYSTEM_ACTOR);
  const old = record!.data as unknown as EpicData;
  await upsertRecord(COLLECTIONS.epics, { key: slug, data: asData({ ...old,
    ownerTitle: title.trim().slice(0, 200), summary: summary.trim().slice(0, 2000), updatedAt: new Date().toISOString(),
  }) }, SYSTEM_ACTOR);
  if (priority != null) for (const item of [...current.deliverables, ...current.combinedDeliveries]) {
    if (item.actionable && item.backlogStatus === 'open' && !item.foldedInto) await setPriority(item.slug, priority);
  }
}

/** Recompute before every decision so stale browser suggestions cannot retire changed work. */
export async function decideBacklogGrooming(id: string, decision: 'apply' | 'keep', by: 'owner' | 'engine' = 'owner', prepared?: BacklogEpic[]): Promise<void> {
  const epics = prepared ?? await loadEpicBacklog();
  const epic = epics.find((e) => e.suggestions?.some((s) => s.id === id));
  const suggestion = epic?.suggestions?.find((s) => s.id === id);
  if (!epic || !suggestion) throw new Error('Suggestion changed or was already handled; reload the backlog');
  if (decision === 'keep') {
    const record = await getRecordByKey(COLLECTIONS.epics, epic.slug, SYSTEM_ACTOR);
    const old = record!.data as unknown as EpicData;
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData({ ...old,
      groomingOverrides: [...new Set([...(old.groomingOverrides ?? []), suggestion.itemId])],
      updatedAt: new Date().toISOString(),
    }) }, SYSTEM_ACTOR);
    return;
  }
  const item = epic.deliverables.find((i) => i.id === suggestion.itemId)!;
  const audit = async (state: 'pending' | 'applied') => {
    const record = await getRecordByKey(COLLECTIONS.epics, epic.slug, SYSTEM_ACTOR);
    const old = record!.data as unknown as EpicData;
    const entry = { id, itemId: item.id, itemTitle: item.title, targetId: suggestion.targetId,
      targetTitle: suggestion.targetTitle, kind: suggestion.kind, at: new Date().toISOString(), by, state };
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData({ ...old,
      groomingHistory: [...(old.groomingHistory ?? []).filter((a) => a.id !== id), entry],
    }) }, SYSTEM_ACTOR);
  };
  await audit('pending');
  const { setParked, getBacklogItem, foldItems } = await import('./backlog');
  if (suggestion.kind === 'covered') {
    const reason = `Covered by ${suggestion.targetTitle} (${suggestion.targetId}); ${by === 'engine' ? 'automatically consolidated' : 'reviewed by owner'}`;
    const source = await getBacklogItem(item.slug);
    if (!source || source.commissionId || source.status !== 'open' || source.attempts || source.title !== item.title || source.detail !== item.detail || JSON.stringify(source.grooming ?? null) !== JSON.stringify(item.grooming)) throw new Error('Suggestion changed; delivery or requirements changed');
    await setParked(item.slug, true, reason);
    await audit('applied');
    return;
  }
  // Capability leads were retired in D3 (2026-09-26); a merge target must be a
  // backlog row. A stale suggestion pointing at one is refused, not guessed at.
  if (!suggestion.targetId.startsWith('backlog:')) {
    throw new Error('Suggestion targets a retired capability lead; reload the backlog');
  }
  const targetSlug = suggestion.targetId.replace(/^backlog:/, '');
  const [source, target] = await Promise.all([getBacklogItem(item.slug), getBacklogItem(targetSlug)]);
  if (!source || !target || source.commissionId || target.commissionId || source.status !== 'open' || target.status !== 'open' || source.attempts || target.attempts) {
    throw new Error('Suggestion changed; delivery started building');
  }
  const { renderBacklogBrief } = await import('$lib/jkai/development-brief');
  // Save the complete source brief before folding. Retrying overwrites the same
  // key, and every builder consumes these requirements through renderBacklogBrief.
  await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target,
    absorbedRequirements: { ...target.absorbedRequirements, [source.slug]: renderBacklogBrief(source) },
    updatedAt: new Date().toISOString(),
  }) }, SYSTEM_ACTOR);
  await foldItems([source.slug, target.slug], target.slug);
  await audit('applied');
}

/** Restoring also pins the source apart so the next intake cannot undo the override. */
export async function overrideBacklogGrooming(itemId: string, keepSeparate: boolean): Promise<void> {
  const epics = await loadEpicBacklog();
  const epic = epics.find((e) => e.deliverables.some((i) => i.id === itemId));
  if (!epic) throw new Error('Deliverable no longer exists');
  const item = epic.deliverables.find((i) => i.id === itemId)!;
  const saved = await listEpics();
  const actions = saved.flatMap((e) => e.groomingHistory ?? []).filter((a) => a.itemId === itemId && a.state !== 'undone');
  // Persist the override first, so a failed restoration remains protected.
  for (const meta of saved.filter((e) => e.slug === epic.slug || e.groomingOverrides?.includes(itemId) || e.groomingHistory?.some((a) => a.itemId === itemId))) {
    await upsertRecord(COLLECTIONS.epics, { key: meta.slug, data: asData({ ...meta,
      groomingOverrides: [...new Set([...(meta.groomingOverrides ?? []).filter((id) => id !== itemId), ...(keepSeparate ? [itemId] : [])])],
    }) }, SYSTEM_ACTOR);
  }
  if (!keepSeparate || !actions.length) return;
  const { setParked, getBacklogItem } = await import('./backlog');
  const source = await getBacklogItem(item.slug);
  if (!source || source.status === 'shipped' || source.attempts > 0) throw new Error('This delivery has already started; it cannot be restored automatically');
  await setParked(item.slug, false);
  // Merge history pointing at a retired capability lead (`capability:`) is
  // skipped: that ledger is gone and there is nothing to un-merge.
  for (const action of actions.filter((a) => a.kind === 'merge' && a.targetId.startsWith('backlog:'))) {
    const target = await getBacklogItem(action.targetId.slice(8));
    if (target?.status === 'open' && target.attempts === 0 && target.absorbedRequirements?.[item.slug]) {
      const requirements = { ...target.absorbedRequirements }; delete requirements[item.slug];
      await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target, absorbedRequirements: requirements }) }, SYSTEM_ACTOR);
    }
  }
  // Mark history only after restoration succeeds. A failed call is safe to retry.
  for (const meta of await listEpics()) if (meta.groomingHistory?.some((a) => a.itemId === itemId && a.state !== 'undone')) {
    await upsertRecord(COLLECTIONS.epics, { key: meta.slug, data: asData({ ...meta,
      groomingHistory: meta.groomingHistory.map((a) => a.itemId === itemId ? { ...a, state: 'undone' } : a),
    }) }, SYSTEM_ACTOR);
  }
}

// ── Automatic grooming ──────────────────────────────────────────────────────

// Coordinate intake from the web and background workers. The transaction holds
// the advisory lock while the existing ledger APIs use their own connections.
let queue: Promise<unknown> = Promise.resolve();
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  // Queue locally before reserving a database connection. Otherwise several
  // lock waiters can occupy the whole pool and starve the active pass's reads.
  const result = queue.then(() => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(731, 5275)`);
    return work();
  }));
  queue = result.catch(() => {});
  return result;
}

/**
 * Apply every automatic grooming decision, under the advisory lock. Runs on
 * the heartbeat (`backlog-grooming`), after every intake and in the nightly
 * run's gather phase — never on a page view, since 2026-10-02.
 */
export async function autoGroomBacklog(): Promise<BacklogRoom & { applied: number }> {
  return exclusive(async () => {
    const { epics } = await loadBacklogRoom();
    let applied = 0;
    for (const suggestion of epics.flatMap((e) => e.suggestions ?? []).filter((s) => s.automatic)) {
      // The locked pass shares one comparison snapshot; each write re-reads
      // source and target lifecycle state before retiring any work.
      try { await decideBacklogGrooming(suggestion.id, 'apply', 'engine', epics); applied += 1; }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('Suggestion changed')) continue;
        throw error;
      }
    }
    return { ...(await loadBacklogRoom()), applied };
  });
}

/**
 * Rule on several suggestions at once.
 *
 * The review lane offers "apply all merges" over a hundred-odd pending rows,
 * and doing that one request at a time meant one `loadEpicBacklog()` — two
 * ledger reads and a full board build — per decision, plus an `invalidateAll()`
 * round trip. This takes the same advisory lock the automatic pass takes,
 * reads once, and tolerates the same staleness it does: every write re-checks
 * the live row, so a suggestion the previous decision invalidated is reported
 * rather than forced.
 */
export function decideBacklogGroomingMany(ids: string[], decision: 'apply' | 'keep') {
  return exclusive(async () => {
    const { epics } = await loadBacklogRoom();
    const failed: Array<{ id: string; error: string }> = [];
    let decided = 0;
    for (const id of ids) {
      try {
        await decideBacklogGrooming(id, decision, 'owner', epics);
        decided += 1;
      } catch (error) {
        failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { decided, failed };
  });
}

/** Intake is durable even if grooming must be retried by the board/nightly pass. */
export async function groomAfterIntake(): Promise<void> {
  try { await autoGroomBacklog(); }
  catch (error) { console.error('[backlog] automatic grooming deferred:', error instanceof Error ? error.message : error); }
}

export function setGroomingOverride(itemId: string, keepSeparate: boolean) {
  return exclusive(() => overrideBacklogGrooming(itemId, keepSeparate));
}

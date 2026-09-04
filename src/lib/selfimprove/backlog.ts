// src/lib/selfimprove/backlog.ts
//
// The engine's memory between nights.
//
// Every idea used to be a `proposal` string on a run record — write-only text
// nobody (including the next night's model) ever read again. The 19–29 Jul runs
// re-proposed "news digest" and "current time" repeatedly while never retrying
// the three tools that had failed on trivially fixable errors.
//
// A backlog item is keyed by a slug derived from its title, so the same idea
// arriving on five consecutive nights updates one record instead of creating
// five. Failures are recorded ON the item, which is what lets the author prompt
// say "you tried this before and it returned HTTP 405 — do it differently".

import { queryRecords, upsertRecord, getCollectionBySlug, getRecordByKey } from '$lib/datastore';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  asData,
  errMsg,
  slugifyIdea,
  type BacklogItemData,
  type BacklogStatus,
} from './types';

/** An idea as proposed by a phase, before it becomes a record. */
export interface IdeaInput {
  title: string;
  detail: string;
  kind: BacklogItemData['kind'];
  priority?: number;
  /** The appetite-ledger row this came from, when it came from one. */
  capabilitySlug?: string;
}

/** The lanes that bring new data into the building. Kept here because
 *  `pickWork` reserves slots for them and the reservation must not depend on
 *  importing the daydream vocabulary into the self-improvement engine. */
const NEW_DATA_KINDS: ReadonlyArray<BacklogItemData['kind']> = ['source', 'watch'];

/**
 * Read every backlog item.
 *
 * This used to be one query with `limit: 200` and the comment "the collection
 * is small — tens of rows at most". It is not: production held **410** items on
 * 2026-08-30, so **210 of them sat outside the window** and were invisible to
 * everything that reads this function. `pickWork` could not reach them, which
 * means an idea that was not picked in its first fortnight could never be
 * picked at all — it drops below 200 newer rows sorted by `updatedAt` and stays
 * there, because only being worked on lifts it back up.
 *
 * The datastore clamps a single query at `MAX_LIMIT` = 500, and the collection
 * grows by roughly fifteen a night, so raising the number would have bought
 * about a week. It pages instead.
 */
const PAGE = 500;
/** Refuse to loop forever if the collection ever runs away. 20 pages = 10,000
 *  items, which is far past anything sane and still bounded. */
const MAX_PAGES = 20;

export async function listBacklog(status?: BacklogStatus): Promise<BacklogItemData[]> {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.backlog))) return [];
    const items: BacklogItemData[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { records } = await queryRecords(
        COLLECTIONS.backlog,
        { sort: { field: 'updatedAt', dir: 'desc' }, limit: PAGE, offset: page * PAGE },
        SYSTEM_ACTOR,
      );
      items.push(...records.map((r) => r.data as unknown as BacklogItemData));
      if (records.length < PAGE) break;
    }
    return status ? items.filter((i) => i.status === status) : items;
  } catch (err) {
    console.error('[selfimprove] listBacklog failed:', errMsg(err));
    return [];
  }
}

async function put(item: BacklogItemData): Promise<void> {
  await upsertRecord(COLLECTIONS.backlog, { key: item.slug, data: asData(item) }, SYSTEM_ACTOR);
}

/**
 * How many genuinely new ideas may enter the backlog in one night.
 *
 * There is no global cap today and there are four call sites — `analyze.ts`,
 * `toolsmith.ts` twice, and the trace-analyse route — so each one is polite in
 * isolation and the total is whatever they happen to add up to. Measured over
 * the fortnight to 2026-08-16 that was 77 added against 14 built; by 2026-08-30
 * the open pile had gone from 148 to **324** and was still climbing.
 *
 * The cap belongs here rather than at the call sites precisely because there
 * are four of them and a fifth is one PR away. Twelve is a little under the
 * observed nightly intake, so the pile stops growing without the engine
 * suddenly proposing nothing.
 */
export const MAX_NEW_IDEAS_PER_NIGHT = 12;

const KINDS: ReadonlyArray<BacklogItemData['kind']> = ['tool', 'feature', 'engine', 'source', 'watch'];

/** An unknown kind becomes `tool`, the cheapest lane. Records written before
 *  `source` and `watch` existed carry `tool` or `feature` and read back
 *  unchanged. */
function coerceKind(kind: unknown): BacklogItemData['kind'] {
  return KINDS.includes(kind as BacklogItemData['kind']) ? (kind as BacklogItemData['kind']) : 'tool';
}

/**
 * Merge ideas into the backlog. Existing slugs are left alone (their attempt
 * history is worth more than a re-description); genuinely new ones are added,
 * up to `MAX_NEW_IDEAS_PER_NIGHT`. Returns the slugs actually created, for the
 * run's action list.
 *
 * **Existence is checked by KEY, never against a list.** It used to build a Map
 * from `listBacklog()`, which was capped at 200 rows — so for any idea whose
 * slug had fallen outside that window, `existing.has(slug)` was false and the
 * item was written fresh: `attempts: 0`, `status: 'open'`, `createdAt: now`,
 * silently erasing its history and resurrecting work that was already shipped
 * or abandoned. Nothing had fired yet on 2026-08-30 (no shipped row sat at zero
 * attempts) because being worked on lifts a row back up the `updatedAt` sort
 * and holds it inside the window — but 210 of 410 rows were already outside it,
 * and the pile grows. A per-slug lookup is exact, cannot be outgrown, and costs
 * one indexed read per idea against a list that is capped just above.
 */
export async function addIdeas(ideas: IdeaInput[]): Promise<string[]> {
  if (ideas.length === 0) return [];
  const added: string[] = [];
  const now = new Date().toISOString();

  // The cap has to count what the OTHER call sites already added, or it is a
  // per-call limit wearing a per-night name and four callers make it 48. A
  // rolling 24 hours rather than a calendar day: the run starts at 02:30 local
  // and nothing useful happens at a midnight boundary, so a window that cannot
  // be straddled is simpler than one that can.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = (await listBacklog()).filter((i) => {
    const t = Date.parse(i.createdAt ?? '');
    return Number.isFinite(t) && t >= since;
  }).length;
  const budget = MAX_NEW_IDEAS_PER_NIGHT - recent;
  if (budget <= 0) {
    console.log(`[selfimprove] backlog intake capped — ${recent} idea(s) already added in the last 24h`);
    return [];
  }

  for (const idea of ideas) {
    if (added.length >= budget) break;
    const title = (idea.title ?? '').trim();
    if (!title) continue;
    const slug = slugifyIdea(title);
    if (!slug) continue;
    if (await backlogItemExists(slug)) continue;
    const item: BacklogItemData = {
      slug,
      title: title.slice(0, 200),
      detail: (idea.detail ?? '').slice(0, 2000),
      kind: coerceKind(idea.kind),
      status: 'open',
      priority: Math.min(5, Math.max(1, Math.round(idea.priority ?? 3))),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (idea.capabilitySlug) item.capabilitySlug = idea.capabilitySlug.slice(0, 200);
    try {
      await put(item);
      added.push(slug);
    } catch (err) {
      console.error('[selfimprove] addIdeas upsert failed:', errMsg(err));
    }
  }
  return added;
}

/**
 * Does a backlog item with this slug already exist?
 *
 * Fails CLOSED — an unreadable datastore answers "yes, it exists", so a
 * transient error skips the write rather than overwriting a record it could
 * not read. Losing one night's idea is recoverable; erasing an item's attempt
 * history is not.
 */
async function backlogItemExists(slug: string): Promise<boolean> {
  try {
    return (await getRecordByKey(COLLECTIONS.backlog, slug, SYSTEM_ACTOR)) != null;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not_found') return false;
    console.error('[selfimprove] backlogItemExists failed:', errMsg(err));
    return true;
  }
}

/** Attempts after which an idea is left alone — it is almost certainly not
 *  buildable as described, and retrying forever starves everything else. */
export const MAX_ATTEMPTS = 4;

/**
 * Pick the next items to work on.
 *
 * The old sort was `attempts ASC, then priority`, which reads as "try a fresh
 * idea before a fourth retry" and behaves as "never retry anything". With
 * twelve to seventeen brand-new `attempts: 0` items arriving nightly, the
 * untried pile is always larger than the nightly limit, so anything that failed
 * once fell permanently behind it. The `attempts < 4` retry budget and the
 * `lastError` feedback — the entire reason `backlog.ts` exists, and the thing
 * the author prompt reads to say "you tried this and it returned HTTP 405" —
 * were dead in practice: 31 lifetime repair attempts for 1 ship.
 *
 * So reserve a slice for work already in progress instead of ranking one class
 * wholly above the other. Priority leads within each class, because that is
 * what priority is for; `updatedAt` breaks ties so a run cannot pick the same
 * item twice in a row purely by list order.
 *
 * The split is deliberately not 50/50. Untried ideas should still lead — a
 * fresh idea is usually cheaper than a fourth attempt at a hard one — but
 * "usually" is not "always", which is what the old sort encoded.
 */
const RETRY_SHARE = 1 / 3;

export function pickWork(
  items: BacklogItemData[],
  kind: BacklogItemData['kind'],
  limit: number,
): BacklogItemData[] {
  if (limit <= 0) return [];
  const open = items.filter(
    (i) => i.status === 'open' && i.kind === kind && i.attempts < MAX_ATTEMPTS,
  );
  const rank = (a: BacklogItemData, b: BacklogItemData) =>
    a.priority - b.priority || (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');

  // A single slot has no room to reserve anything, so let priority decide
  // outright and break a tie toward work already started — reserving the only
  // slot for retries would be the original bug with the classes swapped.
  if (limit === 1) {
    const best = [...open].sort((a, b) => rank(a, b) || b.attempts - a.attempts)[0];
    return best ? [best] : [];
  }

  const untried = open.filter((i) => i.attempts === 0).sort(rank);
  const retries = open.filter((i) => i.attempts > 0).sort(rank);

  // At least one retry slot whenever a retry exists — `Math.floor(2/3)` is 0,
  // and the propose phase runs at a limit of 2, so a bare proportion would have
  // left features never retried at all.
  const retrySlots = retries.length ? Math.max(1, Math.floor(limit * RETRY_SHARE)) : 0;
  const picked = [
    ...untried.slice(0, limit - retrySlots),
    ...retries.slice(0, retrySlots),
  ];

  // Backfill: if one class was short, the other takes the spare slots rather
  // than the run doing less work than its cap allows.
  if (picked.length < limit) {
    const seen = new Set(picked.map((i) => i.slug));
    for (const i of [...untried, ...retries]) {
      if (picked.length >= limit) break;
      if (!seen.has(i.slug)) {
        picked.push(i);
        seen.add(i.slug);
      }
    }
  }
  return picked.slice(0, limit);
}

/**
 * How many of the toolsmith's slots are held for work that brings new data in.
 *
 * The owner's instruction (2026-09-04) is a bias toward new data over
 * efficiency, and a bias that lives only in a prompt is a bias the first busy
 * night discards. This is the half of it that is arithmetic: when any `source`
 * or `watch` item is open, half the night's tool slots are reserved for the
 * tools those lanes need, and the general queue takes what is left.
 *
 * Half rather than all, for the reason `RETRY_SHARE` is a third rather than a
 * half: a rule that starves one class entirely is the bug that rule replaced.
 */
export const NEW_DATA_SHARE = 1 / 2;

/**
 * Pick the toolsmith's work, with `source` items given first refusal.
 *
 * `pickWork` ranks within one kind; this ranks across the two kinds the
 * toolsmith can actually build. `watch` is deliberately NOT here — a monitor
 * is a generated workflow, not a runtime tool, and it has its own lane in the
 * propose phase. Mixing it in would hand the author an idea it cannot make.
 *
 * A `source` item authors a tool too: the source is found and registered by
 * the discover phase, and what remains is the no-argument numeric reader that
 * turns it into a daily signal. Reserving slots for those is the arithmetic
 * half of the owner's bias toward new data — an ordering alone is discarded by
 * the first night with more work than slots.
 */
export function pickToolWork(items: BacklogItemData[], limit: number): BacklogItemData[] {
  if (limit <= 0) return [];
  const sources = pickWork(items, 'source', limit);
  const tools = pickWork(items, 'tool', limit);
  if (sources.length === 0) return tools;
  const reserved = Math.max(1, Math.min(sources.length, Math.floor(limit * NEW_DATA_SHARE)));
  const picked = [...sources.slice(0, reserved), ...tools.slice(0, limit - reserved)];
  // Backfill, same as `pickWork`: if one side was short the other takes the
  // spare slots rather than the run doing less work than its cap allows.
  if (picked.length < limit) {
    const seen = new Set(picked.map((i) => i.slug));
    for (const i of [...sources, ...tools]) {
      if (picked.length >= limit) break;
      if (!seen.has(i.slug)) {
        picked.push(i);
        seen.add(i.slug);
      }
    }
  }
  return picked.slice(0, limit);
}

/** Is there open work in a lane that brings new data in? Read by the run to
 *  decide whether call-efficiency may start a fresh experiment tonight. */
export function hasOpenNewDataWork(items: BacklogItemData[]): boolean {
  return items.some(
    (i) => i.status === 'open' && i.attempts < MAX_ATTEMPTS && NEW_DATA_KINDS.includes(i.kind),
  );
}

// ── Owner edits from the queue board ───────────────────────────────────────
//
// Everything above this line is written by the engine, at night, and forgives
// a failure by logging it — a ledger that cannot be written must not cost the
// run that tried. These are the opposite: a person clicked something and is
// watching for it to happen, so they THROW and the route reports the failure.

/** Clamp to the 1..5 the rest of the engine assumes. */
function clampPriority(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, v));
}

/**
 * Read one item or fail loudly.
 *
 * `getRecordByKey` THROWS a `not_found` DatastoreError rather than returning
 * null — `backlogItemExists` above relies on exactly that — so this turns it
 * into a message a person clicking a button can read.
 */
async function mustGet(slug: string): Promise<BacklogItemData> {
  try {
    const rec = await getRecordByKey(COLLECTIONS.backlog, slug, SYSTEM_ACTOR);
    if (!rec) throw new Error(`no backlog item “${slug}”`);
    return rec.data as unknown as BacklogItemData;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'not_found') {
      throw new Error(`no backlog item “${slug}”`);
    }
    throw err;
  }
}

/**
 * Reprioritise. The single highest-leverage owner lever in the room: `pickWork`
 * ranks on `priority` within each class, and on 2026-09-04 **280 of 352 open
 * items sat at priority 2**, so the ordering that decides tonight's work was
 * effectively arbitrary.
 */
export async function setPriority(slug: string, priority: number): Promise<BacklogItemData> {
  const item = await mustGet(slug);
  const next: BacklogItemData = {
    ...item,
    priority: clampPriority(priority),
    updatedAt: new Date().toISOString(),
  };
  await put(next);
  return next;
}

/** Group an item into a board swimlane, or clear it with `null`. */
export async function setEpic(slug: string, epicSlug: string | null): Promise<BacklogItemData> {
  const item = await mustGet(slug);
  const next: BacklogItemData = { ...item, updatedAt: new Date().toISOString() };
  if (epicSlug) next.epicSlug = epicSlug.slice(0, 120);
  else delete next.epicSlug;
  await put(next);
  return next;
}

/**
 * Park an item, or put a parked one back.
 *
 * Park writes `abandoned`, which `pickWork` already skips and `addIdeas`
 * already refuses to overwrite (existence is checked by key). Re-opening
 * deliberately does NOT reset `attempts` — the retry budget is the memory of
 * what has already been tried, and an owner un-parking something is not
 * evidence that the last four failures did not happen.
 */
export async function setParked(
  slug: string,
  parked: boolean,
  reason?: string,
): Promise<BacklogItemData> {
  const item = await mustGet(slug);
  const next: BacklogItemData = {
    ...item,
    status: parked ? 'abandoned' : 'open',
    updatedAt: new Date().toISOString(),
  };
  if (parked) {
    if (reason) next.parkedReason = reason.slice(0, 300);
  } else {
    delete next.parkedReason;
    delete next.foldedInto;
  }
  await put(next);
  return next;
}

/** Which of a fold's members survives.
 *
 *  Highest priority first, then most attempts: the item carrying attempt
 *  history and a `lastError` is the record worth keeping, for the same reason
 *  `addIdeas` refuses to rewrite an existing slug rather than re-describing it.
 *  Exported so the rule is testable without a datastore. */
export function pickFoldSurvivor(items: BacklogItemData[]): BacklogItemData | null {
  if (items.length === 0) return null;
  return [...items].sort(
    (a, b) => a.priority - b.priority || b.attempts - a.attempts || a.slug.localeCompare(b.slug),
  )[0];
}

export interface FoldResult {
  survivor: string;
  folded: string[];
}

/**
 * Fold restatements of one idea into a single item.
 *
 * The measured problem this exists for: a random 70-row sample of the queue on
 * 2026-09-04 collapsed to about twelve subjects, and four items on the
 * "bank/PayPal duplicate charges" theme had already SHIPPED while five more
 * asking for the same thing were still open. The engine cannot see that; a
 * person can, in one glance, and until now had no way to act on it.
 *
 * Losers are marked `abandoned` with a pointer, never deleted — see
 * `foldedInto` in `types.ts` for why deletion would resurrect them.
 */
export async function foldItems(slugs: string[], into?: string): Promise<FoldResult> {
  const unique = [...new Set(slugs.filter(Boolean))];
  if (unique.length < 2) throw new Error('folding needs at least two items');
  const items = await Promise.all(unique.map((s) => mustGet(s)));

  const explicit = into ? items.find((i) => i.slug === into) : undefined;
  if (into && !explicit) throw new Error(`survivor ${into} is not one of the folded items`);
  const survivor = explicit ?? pickFoldSurvivor(items);
  if (!survivor) throw new Error('no survivor could be chosen');

  const losers = items.filter((i) => i.slug !== survivor.slug);
  const now = new Date().toISOString();

  for (const l of losers) {
    await put({
      ...l,
      status: 'abandoned',
      foldedInto: survivor.slug,
      parkedReason: `Folded into “${survivor.title.slice(0, 120)}”`,
      updatedAt: now,
    });
  }
  await put({
    ...survivor,
    // Cumulative: folding twice into the same survivor adds up rather than
    // overwriting, so the count keeps meaning "restatements absorbed".
    foldedCount: (survivor.foldedCount ?? 0) + losers.length,
    updatedAt: now,
  });

  return { survivor: survivor.slug, folded: losers.map((l) => l.slug) };
}

/** Record the outcome of an attempt against an item. Best-effort. */
export async function markAttempt(
  item: BacklogItemData,
  outcome: { status: BacklogStatus; error?: string; runId?: string; prUrl?: string },
): Promise<void> {
  const next: BacklogItemData = {
    ...item,
    status: outcome.status,
    attempts: item.attempts + 1,
    lastError: outcome.error ? outcome.error.slice(0, 500) : undefined,
    lastAttemptRunId: outcome.runId,
    prUrl: outcome.prUrl ?? item.prUrl,
    updatedAt: new Date().toISOString(),
  };
  try {
    await put(next);
  } catch (err) {
    console.error('[selfimprove] markAttempt failed:', errMsg(err));
  }
}

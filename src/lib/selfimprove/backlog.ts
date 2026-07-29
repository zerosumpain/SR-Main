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

import { queryRecords, upsertRecord, getCollectionBySlug } from '$lib/datastore';
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
  kind: 'tool' | 'feature';
  priority?: number;
}

/** Read every backlog item (the collection is small — tens of rows at most). */
export async function listBacklog(status?: BacklogStatus): Promise<BacklogItemData[]> {
  try {
    if (!(await getCollectionBySlug(COLLECTIONS.backlog))) return [];
    const { records } = await queryRecords(
      COLLECTIONS.backlog,
      { sort: { field: 'updatedAt', dir: 'desc' }, limit: 200 },
      SYSTEM_ACTOR,
    );
    const items = records.map((r) => r.data as unknown as BacklogItemData);
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
 * Merge ideas into the backlog. Existing slugs are left alone (their attempt
 * history is worth more than a re-description); genuinely new ones are added.
 * Returns the slugs actually created, for the run's action list.
 */
export async function addIdeas(ideas: IdeaInput[]): Promise<string[]> {
  if (ideas.length === 0) return [];
  const existing = new Map((await listBacklog()).map((i) => [i.slug, i]));
  const added: string[] = [];
  const now = new Date().toISOString();

  for (const idea of ideas) {
    const title = (idea.title ?? '').trim();
    if (!title) continue;
    const slug = slugifyIdea(title);
    if (!slug || existing.has(slug)) continue;
    const item: BacklogItemData = {
      slug,
      title: title.slice(0, 200),
      detail: (idea.detail ?? '').slice(0, 2000),
      kind: idea.kind === 'feature' ? 'feature' : 'tool',
      status: 'open',
      priority: Math.min(5, Math.max(1, Math.round(idea.priority ?? 3))),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await put(item);
      existing.set(slug, item);
      added.push(slug);
    } catch (err) {
      console.error('[selfimprove] addIdeas upsert failed:', errMsg(err));
    }
  }
  return added;
}

/**
 * Pick the next items to work on: open, of the requested kind, fewest attempts
 * first (so a fresh idea is tried before a fourth retry), then by priority.
 * Items that have failed 4+ times are skipped — they are almost certainly not
 * buildable as described, and retrying them forever would starve everything else.
 */
export function pickWork(
  items: BacklogItemData[],
  kind: 'tool' | 'feature',
  limit: number,
): BacklogItemData[] {
  return items
    .filter((i) => i.status === 'open' && i.kind === kind && i.attempts < 4)
    .sort((a, b) => a.attempts - b.attempts || a.priority - b.priority)
    .slice(0, limit);
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

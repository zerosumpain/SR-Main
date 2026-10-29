// The improvement backlog's half of the capability-gap port
// (`$lib/capabilities/gaps`): queue a not-built-yet ask in a datastore
// collection, then take it onto the backlog out of band as source
// 'capability-gap'. Registered at boot from `src/hooks.server.ts`, so
// `$lib/capabilities` stays a leaf (no capabilities -> selfimprove import).
//
// Why a queue and not a direct `intakeIdeas`: intake grooms the backlog when
// it adds a row, which is model and datastore work that has no business
// inside a chat tool call. The tool writes one small record and returns; the
// drain runs after the call has answered (and on a timer in the background
// service for anything a restart left behind).
//
// No new table: the queue is a system collection in the datastore, like the
// backlog itself, and its records expire after a month.

import { setCapabilityGapQueue, type CapabilityGap, type GapOutcome } from '$lib/capabilities/gaps';
import { ensureCollection, getRecordByKey, queryRecords, upsertRecord } from '$lib/datastore';
import { SYSTEM_ACTOR, asData, errMsg, slugifyIdea } from './types';

export const CAPABILITY_GAP_COLLECTION = 'capability_gaps';
/** How often the background service sweeps for gaps a restart stranded. */
export const GAP_DRAIN_INTERVAL_MS = 5 * 60_000;
const DRAIN_BATCH = 20;
/** A gap the nightly intake cap turned away waits this long before it is tried again. */
export const GAP_CAPPED_RETRY_MS = 60 * 60_000;

export interface QueuedGap {
  capabilityId: string | null;
  title: string;
  query: string;
  conversationId: string | null;
  status: 'queued' | 'added' | 'merged' | 'capped' | 'skipped';
  slug?: string;
  queuedAt: string;
  filedAt?: string;
  /** Set while the backlog's daily intake cap holds it back: still queued, retried after this. */
  retryAfter?: string;
  cappedCount?: number;
}

async function ensureQueue(): Promise<void> {
  await ensureCollection(
    CAPABILITY_GAP_COLLECTION,
    {
      name: 'Capability gaps',
      description: 'Not-built-yet asks from jkai chat, queued for the improvement backlog (source capability-gap).',
      isSystem: true,
      defaultPermissions: { read: ['owner', 'jkai', 'system'], write: ['system', 'owner'], delete: ['owner', 'system'] },
      settings: { ttlSeconds: 30 * 86_400, maxRecords: 2_000 },
    },
    SYSTEM_ACTOR,
  );
}

/** One filing per conversation per twin: the planned row, or the ask's own words. PURE. */
export function gapKey(gap: Pick<CapabilityGap, 'capabilityId' | 'query' | 'conversationId'>): string {
  const twin = gap.capabilityId ?? slugifyIdea(gap.query);
  return `${gap.conversationId ? slugifyIdea(gap.conversationId) : 'no-conversation'}--${twin}`.slice(0, 160);
}

export async function enqueueCapabilityGap(gap: CapabilityGap, opts: { drainSoon?: boolean } = {}): Promise<GapOutcome> {
  if (!gap.title.trim()) return { status: 'unavailable' };
  await ensureQueue();
  const key = gapKey(gap);
  const existing = await getRecordByKey(CAPABILITY_GAP_COLLECTION, key, SYSTEM_ACTOR).catch(() => null);
  if (existing) return { status: 'already-queued', ...((existing.data as unknown as QueuedGap).slug ? { slug: (existing.data as unknown as QueuedGap).slug } : {}) };
  const row: QueuedGap = {
    capabilityId: gap.capabilityId,
    title: gap.title.slice(0, 200),
    query: gap.query.slice(0, 300),
    conversationId: gap.conversationId ?? null,
    status: 'queued',
    queuedAt: new Date().toISOString(),
  };
  await upsertRecord(CAPABILITY_GAP_COLLECTION, { key, data: asData(row) }, SYSTEM_ACTOR);
  // After the tool call has answered, not inside it.
  if (opts.drainSoon !== false) setTimeout(() => void drainCapabilityGaps(), 0).unref?.();
  return { status: 'queued' };
}

let draining: Promise<number> | null = null;

/**
 * Take queued gaps onto the backlog. Returns how many were processed. One
 * drain at a time per process; intake itself merges a repeat into the item
 * already there (`findIntakeTwin`), so two processes draining is harmless.
 */
export function drainCapabilityGaps(): Promise<number> {
  draining ??= (async () => {
    try {
      return await drainOnce();
    } catch (err) {
      console.error('[capability-gaps] drain failed:', errMsg(err));
      return 0;
    } finally {
      draining = null;
    }
  })();
  return draining;
}

async function drainOnce(): Promise<number> {
  await ensureQueue();
  const { records } = await queryRecords(
    CAPABILITY_GAP_COLLECTION,
    { filters: [{ path: 'status', op: 'eq', value: 'queued' }], sort: { field: 'createdAt', dir: 'asc' }, limit: DRAIN_BATCH },
    SYSTEM_ACTOR,
  );
  if (!records.length) return 0;
  const { intakeIdeas } = await import('./backlog');
  let done = 0;
  const nowMs = Date.now();
  for (const rec of records) {
    const gap = rec.data as unknown as QueuedGap;
    // Held back by the intake cap: not until its retry time.
    if (gap.retryAfter && Date.parse(gap.retryAfter) > nowMs) continue;
    const result = await intakeIdeas([
      {
        title: gap.title,
        // His words as quoted data, never as instructions for the builder:
        // a query can carry text the turn retrieved (plan risk: prompt
        // injection into the backlog). The brief is written when he accepts it.
        detail:
          `jkai was asked for something it cannot do yet${gap.capabilityId ? ` (the planned capability "${gap.capabilityId}")` : ''}. ` +
          `The ask, quoted: "${gap.query.replace(/"/g, "'")}"`,
        kind: 'feature',
        priority: 3,
        source: 'capability-gap',
        ...(gap.conversationId ? { ref: `conv:${gap.conversationId}` } : {}),
      },
    ]);
    const outcome = result.outcomes[0] ?? 'skipped';
    const slug = result.added[0] ?? result.merged[0]?.into;
    if (outcome === 'capped') {
      // The backlog took its day's worth of new ideas. The ask was told it
      // was queued, so it stays queued — tried again after a wait — rather
      // than being parked as 'capped', which no sweep ever looked at again.
      const held: QueuedGap = { ...gap, status: 'queued', retryAfter: new Date(nowMs + GAP_CAPPED_RETRY_MS).toISOString(), cappedCount: (gap.cappedCount ?? 0) + 1 };
      await upsertRecord(CAPABILITY_GAP_COLLECTION, { key: rec.key as string, data: asData(held) }, SYSTEM_ACTOR);
      done++;
      continue;
    }
    const { retryAfter: _r, ...rest } = gap;
    const next: QueuedGap = { ...rest, status: outcome, filedAt: new Date().toISOString(), ...(slug ? { slug } : {}) };
    // A row the intake skipped (an unreadable backlog) stays queued for the next sweep.
    if (outcome !== 'skipped') await upsertRecord(CAPABILITY_GAP_COLLECTION, { key: rec.key as string, data: asData(next) }, SYSTEM_ACTOR);
    done++;
  }
  return done;
}

export function registerCapabilityGapQueue(): void {
  setCapabilityGapQueue({ enqueue: (gap) => enqueueCapabilityGap(gap) });
}

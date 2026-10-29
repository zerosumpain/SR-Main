import type { CapabilityEntry } from './types';

/**
 * The capability-gap queue, as a port (plan point 7, slice 7b).
 *
 * When John asks jkai for something that is planned, or that nothing on the
 * site does, the ask is QUEUED here and taken onto the improvement backlog
 * out of band, as source 'capability-gap' — so backlog grooming never runs
 * inside the chat call, and a gap idea always needs his tap to build
 * (`propose.ts` never autobuilds it).
 *
 * The improvement backlog owns the queue and registers it at boot
 * (`registerCapabilityGapQueue` in `$lib/selfimprove/capability-gaps`), so
 * this leaf never imports selfimprove. Unregistered — a script, a test, a
 * process that does not hold the backlog — nothing is filed and the answer
 * says so.
 */

export interface CapabilityGap {
  /** The planned row asked for, or null for a request nothing matched. */
  capabilityId: string | null;
  /** The backlog title; the same for every ask of one row, so a repeat merges. */
  title: string;
  /** His words, kept as quoted data. Never a brief. */
  query: string;
  /** The conversation it came from: one filing per conversation and twin. */
  conversationId?: string;
}

export type GapOutcome =
  /** Queued now; it reaches /home/backlog within minutes. */
  | { status: 'queued' }
  /** This conversation already queued the same ask. */
  | { status: 'already-queued'; slug?: string }
  /** No queue in this process, or it could not be written. */
  | { status: 'unavailable' };

export interface CapabilityGapQueue {
  enqueue(gap: CapabilityGap): Promise<GapOutcome>;
}

let queue: CapabilityGapQueue | null = null;

export function setCapabilityGapQueue(next: CapabilityGapQueue | null): void {
  queue = next;
}

/** Never throws: a gap that cannot be filed must not cost the turn. */
export async function queueCapabilityGap(gap: CapabilityGap): Promise<GapOutcome> {
  if (!queue) return { status: 'unavailable' };
  try {
    return await queue.enqueue(gap);
  } catch (err) {
    console.warn('[capabilities] gap queue failed:', err instanceof Error ? err.message : err);
    return { status: 'unavailable' };
  }
}

const MAX_QUERY = 300;

/** The ask, clipped and flattened; it is stored and shown as a quotation. */
export function quotedQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

/**
 * The backlog title for a gap. A planned row always files under one title, so
 * asks from different conversations land on one item (an exact merge); a
 * request nothing matched files under its own words.
 */
export function gapTitle(entry: Pick<CapabilityEntry, 'title'> | null, query: string): string {
  if (entry) return `jkai capability: ${entry.title}`;
  return `jkai capability: ${quotedQuery(query).slice(0, 80)}`;
}

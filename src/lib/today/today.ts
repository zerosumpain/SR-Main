// src/lib/today/today.ts
//
// The pure half of Today: which development deliveries are waiting on the
// owner, and the shapes the loader returns. `today.server.ts` fetches.

import type { DeliveryState } from '$lib/constants/development';
import { developmentLane } from '$lib/builds/development-progress';
import { isCommissioned } from '$lib/jkai/development';

/** Every section `loadToday` can answer. Each fails on its own to null. */
export const TODAY_SECTIONS = ['health', 'alerts', 'news', 'connections', 'daydream', 'lastThread', 'needsYou', 'briefing'] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

/** What the phone's first screen (`/api/native/today`) has always carried, in its order. */
export const NATIVE_TODAY_SECTIONS = ['health', 'alerts', 'news', 'connections', 'daydream', 'lastThread'] as const satisfies readonly TodaySection[];

/**
 * What the jkai desk and the chat tools read (`/api/platform/jkai/today`,
 * `today_overview`). News is left out on purpose: reading it stamps the
 * owner's "new since you looked" visit, and the desk is not a visit to news.
 */
export const DESK_TODAY_SECTIONS = ['needsYou', 'briefing', 'connections', 'lastThread'] as const satisfies readonly TodaySection[];

export function parseSections(raw: string | null | undefined, fallback: readonly TodaySection[]): TodaySection[] {
  if (!raw) return [...fallback];
  const asked = raw.split(',').map((s) => s.trim()).filter((s): s is TodaySection => (TODAY_SECTIONS as readonly string[]).includes(s));
  return asked.length ? [...new Set(asked)] : [...fallback];
}

export type DeliveryWaitReason = 'question' | 'release';

export interface WaitingDelivery {
  id: string;
  title: string;
  reason: DeliveryWaitReason;
  /** The open question, or why the release waits — in the worker's words. */
  detail: string;
  stage: DeliveryState['stage'];
  href: string;
  prUrl: string | null;
}

/**
 * Why a commissioned delivery waits on the owner, or null when it does not:
 * a blocking question the worker asked (the Develop page's "Needs you" lane),
 * or a release the pipeline has said is waiting on him. A shipped one with no
 * such flag is done; one that is only building is not his move.
 */
export function deliveryWaiting(state: DeliveryState): { reason: DeliveryWaitReason; detail: string } | null {
  if (!isCommissioned(state) || state.stage === 'deployed') return null;
  if (developmentLane(state) === 'input') {
    const open = state.decisions.find((d) => !d.answer);
    return { reason: 'question', detail: open?.question ?? 'The worker asked a question.' };
  }
  const waits = state.release?.awaitingOwner;
  if (waits && !state.release?.mergedAt) return { reason: 'release', detail: waits };
  return null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function toWaitingDelivery(row: { buildId: string; title: string | null; prompt: string; state: DeliveryState }): WaitingDelivery | null {
  const waits = deliveryWaiting(row.state);
  if (!waits) return null;
  const title = row.title?.trim() || row.state.originalAsk?.trim() || row.prompt.trim().split('\n')[0] || 'Development feature';
  return {
    id: row.buildId,
    title: clip(title, 160),
    reason: waits.reason,
    detail: clip(waits.detail, 300),
    stage: row.state.stage,
    href: `/jkai/develop/${encodeURIComponent(row.buildId)}`,
    prUrl: row.state.release?.prUrl ?? null,
  };
}

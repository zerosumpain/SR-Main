// src/lib/daydream/appetite/store.ts
//
// The appetite ledger. One row per idea the engine has had about what the site
// should be able to do, and what became of it.
//
// Writes are SOFT in the same sense the fault ledger's are: a ledger that
// cannot be written must never cost the tick that tried to write it. Reads are
// not — a room that cannot load its ledger should say so rather than render an
// empty page that looks like "no ideas".

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamCapabilities, heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { errMsg } from '../types';
import { localDayStart } from '../budget';
import {
  laneFor,
  scoreCapability,
  slugForCapability,
  type CapabilityKind,
  type CapabilityProposal,
  type CapabilityStatus,
} from './spec';

export interface CapabilityRow {
  id: number;
  slug: string;
  kind: CapabilityKind;
  title: string;
  need: string;
  value: string;
  consumer: string;
  integrationHint: string | null;
  cites: string[];
  score: number;
  components: Record<string, number>;
  status: CapabilityStatus;
  recurrence: number;
  lane: string | null;
  outcome: string | null;
  outcomeRef: string | null;
  backlogSlug: string | null;
  thoughtId: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

type Raw = typeof daydreamCapabilities.$inferSelect;

function toRow(r: Raw): CapabilityRow {
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind as CapabilityKind,
    title: r.title,
    need: r.need,
    value: r.value,
    consumer: r.consumer,
    integrationHint: r.integrationHint,
    cites: Array.isArray(r.cites) ? (r.cites as unknown[]).map(String) : [],
    score: Number(r.score ?? 0),
    components: (r.components as Record<string, number> | null) ?? {},
    status: r.status as CapabilityStatus,
    recurrence: r.recurrence,
    lane: r.lane,
    outcome: r.outcome,
    outcomeRef: r.outcomeRef,
    backlogSlug: r.backlogSlug,
    thoughtId: r.thoughtId,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

export async function listCapabilities(
  opts: { statuses?: ReadonlyArray<CapabilityStatus>; kinds?: ReadonlyArray<CapabilityKind>; limit?: number | null } = {},
): Promise<CapabilityRow[]> {
  const where = [
    ...(opts.statuses?.length ? [inArray(daydreamCapabilities.status, [...opts.statuses])] : []),
    ...(opts.kinds?.length ? [inArray(daydreamCapabilities.kind, [...opts.kinds])] : []),
  ];
  const rows = db
    .select()
    .from(daydreamCapabilities)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(daydreamCapabilities.score), desc(daydreamCapabilities.lastSeenAt))
    .$dynamic();
  const selected = opts.limit === null ? await rows : await rows.limit(opts.limit ?? 60);
  return selected.map(toRow);
}

export async function getCapability(slug: string): Promise<CapabilityRow | null> {
  const [row] = await db.select().from(daydreamCapabilities).where(eq(daydreamCapabilities.slug, slug)).limit(1);
  return row ? toRow(row) : null;
}

export interface UpsertResult {
  slug: string;
  created: boolean;
  score: number;
  recurrence: number;
}

/**
 * Write a proposal to the ledger.
 *
 * A repeat RAISES the score rather than replacing the row: persistence across
 * nights is evidence, and it is the third component of the score. The original
 * wording is kept for the same reason a backlog item keeps its history — the
 * night it was first arrived at is the honest `firstSeenAt`, and a
 * re-description would silently reset it.
 *
 * A `declined` row is left exactly as it is. The owner said no; a proposer
 * that can re-open its own refusals is a proposer with no memory.
 */
export async function upsertCapability(p: CapabilityProposal): Promise<UpsertResult | null> {
  const slug = slugForCapability(p.kind, p.title);
  try {
    const existing = await getCapability(slug);
    if (existing?.status === 'declined') return null;

    const recurrence = (existing?.recurrence ?? 0) + 1;
    const { score, components } = scoreCapability({ kind: p.kind, cites: p.cites.length, recurrence });
    const now = new Date();

    if (existing) {
      await db
        .update(daydreamCapabilities)
        .set({ recurrence, score, components, cites: p.cites, lastSeenAt: now })
        .where(eq(daydreamCapabilities.slug, slug));
      return { slug, created: false, score, recurrence };
    }

    await db.insert(daydreamCapabilities).values({
      slug,
      kind: p.kind,
      title: p.title,
      need: p.need,
      value: p.value,
      consumer: p.consumer,
      integrationHint: p.integrationHint ?? null,
      cites: p.cites,
      score,
      components,
      lane: laneFor(p.kind),
      recurrence,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return { slug, created: true, score, recurrence };
  } catch (err) {
    console.warn(`[daydream] capability not recorded (${slug}): ${errMsg(err)}`);
    return null;
  }
}

/** Move a lead along, recording who moved it and what it became. */
export async function setCapabilityStatus(
  slug: string,
  status: CapabilityStatus,
  opts: { by?: 'owner' | 'engine'; outcome?: string; outcomeRef?: string; backlogSlug?: string } = {},
): Promise<boolean> {
  try {
    const rows = await db
      .update(daydreamCapabilities)
      .set({
        status,
        decidedBy: opts.by ?? null,
        decidedAt: new Date(),
        ...(opts.outcome ? { outcome: opts.outcome.slice(0, 600) } : {}),
        ...(opts.outcomeRef ? { outcomeRef: opts.outcomeRef.slice(0, 400) } : {}),
        ...(opts.backlogSlug ? { backlogSlug: opts.backlogSlug.slice(0, 200) } : {}),
      })
      .where(eq(daydreamCapabilities.slug, slug))
      .returning({ id: daydreamCapabilities.id });
    return rows.length > 0;
  } catch (err) {
    console.warn(`[daydream] capability status not set (${slug}): ${errMsg(err)}`);
    return false;
  }
}

/** Remember which thought carries this lead, so a rating on the feed can find
 *  its way back to the ledger row. */
export async function linkCapabilityThought(slug: string, thoughtId: number): Promise<void> {
  try {
    await db.update(daydreamCapabilities).set({ thoughtId }).where(eq(daydreamCapabilities.slug, slug));
  } catch (err) {
    console.warn(`[daydream] capability thought link failed (${slug}): ${errMsg(err)}`);
  }
}

export interface CapabilityCounts {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  /** Open leads whose lane brings new data in — what the reserved build slots
   *  are for. */
  newDataOpen: number;
}

export async function capabilityCounts(): Promise<CapabilityCounts> {
  const out: CapabilityCounts = { total: 0, byStatus: {}, byKind: {}, newDataOpen: 0 };
  const rows = await db
    .select({ status: daydreamCapabilities.status, kind: daydreamCapabilities.kind, n: sql<number>`count(*)::int` })
    .from(daydreamCapabilities)
    .groupBy(daydreamCapabilities.status, daydreamCapabilities.kind);
  for (const r of rows) {
    out.total += r.n;
    out.byStatus[r.status] = (out.byStatus[r.status] ?? 0) + r.n;
    out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + r.n;
  }
  return out;
}

/**
 * Has the appetite stage already run today?
 *
 * The activity is hourly inside its window so that a night when the owner is
 * about does not lose the scan entirely — but the scan itself is a daily
 * grain, and it spends a model call. Read off the activity's own pulses, the
 * same shape `alreadySampledToday` uses for the tool harvest.
 *
 * Fails CLOSED. An unreadable guard that defaults to running turns a daily job
 * into an hourly one, which is exactly the mistake that had `daydream-signals`
 * calling TrueLayer and PayPal 528 times a day.
 */
export async function scannedToday(activityName: string, now = new Date()): Promise<boolean> {
  try {
    const since = localDayStart(now);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
      .where(
        and(
          eq(heartbeatActions.name, activityName),
          eq(heartbeatPulses.outcome, 'ok'),
          gte(heartbeatPulses.ts, since),
        ),
      );
    return Number(row?.n ?? 0) > 0;
  } catch (err) {
    console.warn(`[daydream] could not check today's appetite scan: ${errMsg(err)}`);
    return true;
  }
}

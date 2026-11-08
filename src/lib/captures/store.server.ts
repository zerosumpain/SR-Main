// The capture and capture_action rows.
//
// Every read and write takes the recorder's space and filters on it, so a row
// in another space is a 404 exactly like one that does not exist — the same
// rule as the intel graph the captures feed. Owner-only today, but the filter
// is what keeps it right the day members can record.

import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { capture, captureAction, type Capture, type CaptureAction } from '$lib/db/schema';
import { OWNER_SPACE } from '$lib/intel-client/scope';
import { enqueueIntelJob } from '$lib/intel-client/outbox';
import { initialSpeakers } from './validate';
import type { CaptureIntake, ProposedAction } from './types';

export const newCaptureId = () => `cap_${randomBytes(10).toString('hex')}`;
export const newActionId = () => `cact_${randomBytes(10).toString('hex')}`;

/**
 * The recorder's intel space. Owner-only for now (every route is `withDevice`),
 * so it is the owner's space; a member's phone would get `u_<principal>` here
 * when the routes are converted to `withNativeAccess`.
 */
export function recorderSpace(): string {
  return OWNER_SPACE;
}

/** The `jkai_attachments.principal_id` for the recorder's media. */
export function recorderPrincipalId(): string {
  return 'owner';
}

export async function createCapture(principal: string, spaceId: string, intake: CaptureIntake): Promise<Capture> {
  const durationS = intake.endedAt ? (Date.parse(intake.endedAt) - Date.parse(intake.startedAt)) / 1000 : null;
  const [row] = await db
    .insert(capture)
    .values({
      id: newCaptureId(),
      spaceId,
      principal,
      startedAt: new Date(intake.startedAt),
      endedAt: intake.endedAt ? new Date(intake.endedAt) : null,
      durationS,
      transcript: intake.transcript,
      transcriptSource: 'phone',
      turns: intake.turns,
      speakers: initialSpeakers(intake),
      screen: intake.screen
        ? { app: null, summary: '', ocrText: intake.screen.ocrText, ...(intake.screen.denied ? { denied: true } : {}) }
        : null,
      place: intake.place ? { ...intake.place } : null,
      intake: {
        audio: intake.audio,
        screenshot: intake.screenshot,
        source: intake.source,
        speakerCount: intake.speakerCount,
        ownerSpeaker: intake.ownerSpeaker,
        appHint: intake.screen?.appHint ?? null,
      },
      status: 'received',
    })
    .returning();
  return row;
}

export async function getCapture(id: string, spaceId: string): Promise<Capture | null> {
  const [row] = await db
    .select()
    .from(capture)
    .where(and(eq(capture.id, id), eq(capture.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
}

export async function getCaptureById(id: string): Promise<Capture | null> {
  const [row] = await db.select().from(capture).where(eq(capture.id, id)).limit(1);
  return row ?? null;
}

export async function updateCapture(id: string, set: Partial<Omit<Capture, 'id' | 'createdAt'>>): Promise<Capture | null> {
  const [row] = await db
    .update(capture)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(capture.id, id))
    .returning();
  return row ?? null;
}

/**
 * Move `received` → `analysing` only if nobody else has. The audio PUT and the
 * self-heal on GET can both try to start the job; exactly one wins.
 */
export async function claimForAnalysis(id: string): Promise<boolean> {
  const rows = await db
    .update(capture)
    .set({ status: 'analysing', error: null, updatedAt: new Date() })
    .where(and(eq(capture.id, id), inArray(capture.status, ['received', 'failed'])))
    .returning({ id: capture.id });
  return rows.length > 0;
}

export async function listActions(captureId: string): Promise<CaptureAction[]> {
  return db.select().from(captureAction).where(eq(captureAction.captureId, captureId)).orderBy(captureAction.createdAt, captureAction.id);
}

export async function getAction(captureId: string, actionId: string, spaceId: string): Promise<CaptureAction | null> {
  const [row] = await db
    .select()
    .from(captureAction)
    .where(and(eq(captureAction.id, actionId), eq(captureAction.captureId, captureId), eq(captureAction.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
}

export async function updateAction(id: string, set: Partial<Omit<CaptureAction, 'id' | 'captureId' | 'createdAt'>>): Promise<CaptureAction | null> {
  const [row] = await db.update(captureAction).set(set).where(eq(captureAction.id, id)).returning();
  return row ?? null;
}

/**
 * Claim a proposed action for a decision. Conditional on `proposed`, so a
 * double tap cannot run the same calendar write twice.
 */
export async function claimAction(id: string, next: 'approved' | 'dismissed'): Promise<CaptureAction | null> {
  const [row] = await db
    .update(captureAction)
    .set({ state: next, decidedAt: new Date() })
    .where(and(eq(captureAction.id, id), eq(captureAction.state, 'proposed')))
    .returning();
  return row ?? null;
}

/**
 * Replace the PROPOSED actions with a new analysis's. Decided ones (approved,
 * done, dismissed …) stay: a re-analysis must not undo a tap.
 */
export async function replaceProposedActions(c: Pick<Capture, 'id' | 'spaceId'>, actions: ProposedAction[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(captureAction).where(and(eq(captureAction.captureId, c.id), eq(captureAction.state, 'proposed')));
    if (!actions.length) return;
    await tx.insert(captureAction).values(
      actions.map((a) => ({
        id: newActionId(),
        captureId: c.id,
        spaceId: c.spaceId,
        kind: a.kind,
        title: a.title,
        detail: a.detail,
        who: a.who,
        dueAt: a.dueAt ? new Date(a.dueAt) : null,
        params: a.params as Record<string, unknown>,
        state: 'proposed' as const,
      })),
    );
  });
}

export async function listCaptures(
  spaceId: string,
  opts: { before?: Date | null; limit: number },
): Promise<{ rows: Capture[]; open: Map<string, number> }> {
  const rows = await db
    .select()
    .from(capture)
    .where(and(eq(capture.spaceId, spaceId), opts.before ? lt(capture.startedAt, opts.before) : undefined))
    .orderBy(desc(capture.startedAt), desc(capture.id))
    .limit(opts.limit);
  return { rows, open: await openActionCounts(rows.map((r) => r.id)) };
}

/** How many proposals each capture still has waiting on a tap. */
export async function openActionCounts(ids: string[]): Promise<Map<string, number>> {
  const open = new Map<string, number>();
  if (!ids.length) return open;
  const counts = await db
    .select({ captureId: captureAction.captureId, n: sql<number>`count(*)::int` })
    .from(captureAction)
    .where(and(inArray(captureAction.captureId, ids), eq(captureAction.state, 'proposed')))
    .groupBy(captureAction.captureId);
  for (const c of counts) open.set(c.captureId, Number(c.n));
  return open;
}

/** The refId a `remember` action's note is filed under, so a capture delete can find it. */
export const rememberRefId = (captureId: string, actionId: string) => `${captureId}/remember/${actionId}`;

/**
 * Delete the rows (actions go by cascade) and, in the SAME transaction, queue
 * the `derived-delete` jobs that take the capture's notes and entities out of
 * the graph — one for the capture's own extract, one per remembered fact. The
 * jobs exist exactly when the delete does. Returns the media to remove, which
 * the caller does after commit: a blob deleted inside a transaction that then
 * rolls back cannot be undeleted.
 */
export async function deleteCaptureRows(c: Capture): Promise<{ uploadIds: string[]; jobs: number }> {
  return db.transaction(async (tx) => {
    const remembered = await tx
      .select({ id: captureAction.id })
      .from(captureAction)
      .where(and(eq(captureAction.captureId, c.id), eq(captureAction.kind, 'remember'), inArray(captureAction.state, ['done', 'approved'])));
    await tx.delete(capture).where(and(eq(capture.id, c.id), eq(capture.spaceId, c.spaceId)));
    let jobs = 0;
    await enqueueIntelJob('derived-delete', `capture:${c.id}`, { kind: 'capture', refId: c.id, spaceId: c.spaceId }, tx);
    jobs++;
    for (const r of remembered) {
      await enqueueIntelJob(
        'derived-delete',
        `capture:${c.id}`,
        { kind: 'capture', refId: rememberRefId(c.id, r.id), spaceId: c.spaceId },
        tx,
      );
      jobs++;
    }
    return { uploadIds: [c.audioUploadId, c.screenUploadId].filter((x): x is string => !!x), jobs };
  });
}

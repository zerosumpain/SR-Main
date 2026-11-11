// src/lib/daydream/act/solution.server.ts
//
// Carrying out a note's solution (`solution.ts`), and taking it back. The
// press is his consent and his verdict at once: a note whose solution he set
// going was worth knowing, so an unrated note is marked useful with it.
//
// Every write that reaches outside the note is the owner's own, through the
// tool registry with `ownerActionPrincipal` — the same door "Do it for me"
// and the follow-ups use. The backlog arrives as `BacklogPorts` from the
// route, for the module-cycle reason `follow.server.ts` gives.

import { ownerActionPrincipal, unattendedPrincipal } from '$lib/tools/in-process-principal';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import { daydreamActedPayload } from '$lib/events/payloads';
import { splitNarrative } from '../think/explain';
import { noteHref } from '../think/notes';
import { recordFeedback } from '../thought-store';
import type { BacklogPorts } from './follow.server';
import { briefView, followEntry, withFollow, type BuildData } from './follow';
import { readSolve, storeSolve, withSolve, type SolveDone, type SolvePlan } from './solution';
import { AUTO_KINDS, type AutoKind } from './autonomy';

export type SolveResult = { ok: true; message: string; href?: string; already?: boolean } | { ok: false; reason: string };

interface Row {
  id: string;
  title: string;
  narrative: string | null;
  explanation: string;
  feedback: string | null;
  actions: unknown;
}

async function readRow(id: string): Promise<Row | null> {
  const [row] = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.narrative,
      explanation: daydreamThoughts.explanation,
      feedback: daydreamThoughts.feedback,
      actions: daydreamThoughts.proposedActions,
    })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, id))
    .limit(1);
  return row ?? null;
}

/** Write the solution's outcome onto the note, re-reading it under a lock so
 *  nothing another tap wrote in the meantime is lost. */
async function markDone(id: string, plan: SolvePlan, done: SolveDone, extra?: (actions: unknown) => unknown): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daydream-follow:${id}`}))`);
    const [row] = await tx.select({ actions: daydreamThoughts.proposedActions }).from(daydreamThoughts).where(eq(daydreamThoughts.id, id)).limit(1);
    let actions: unknown = withSolve(row?.actions, storeSolve(plan, done));
    if (extra) actions = extra(actions);
    await tx
      .update(daydreamThoughts)
      .set({ proposedActions: actions as Array<{ kind: string; label: string; payload: string }>, updatedAt: new Date() })
      .where(eq(daydreamThoughts.id, id));
  });
}

/**
 * `standing`: nobody pressed anything — the autonomy ladder is acting
 * (`standing.server.ts`). The call is then UNATTENDED and may reach only
 * `ha_call_service`, where the tool contract lets an unattended caller drive
 * lights and refuses it switches, locks and the rest whatever this list says.
 */
async function tool(name: string, args: Record<string, unknown>, standing = false) {
  const { executeTool } = await import('$lib/tools/registry');
  const principal = standing ? unattendedPrincipal('daydream-standing', ['ha_call_service']) : ownerActionPrincipal('daydream-solve');
  return executeTool(name, args, { emit: () => {}, principal });
}

/** A kind's ladder bookkeeping must never fail the press it follows. */
async function ladder(fn: (m: typeof import('./autonomy.server')) => Promise<unknown>): Promise<void> {
  try {
    await fn(await import('./autonomy.server'));
  } catch (err) {
    console.error('[daydream] autonomy ladder not updated:', err instanceof Error ? err.message : err);
  }
}

const inFlight = new Set<string>();

/**
 * One press: carry the solution out, and count the note as worth knowing.
 *
 * `standing` is the same thing with no press behind it: it is not his verdict,
 * so the note is not rated, and a build is refused outright.
 */
export async function runSolution(thoughtId: string, ports: () => BacklogPorts, now = new Date(), opts: { standing?: boolean } = {}): Promise<SolveResult> {
  const standing = !!opts.standing;
  const row = await readRow(thoughtId);
  if (!row) return { ok: false, reason: 'That note no longer exists.' };
  if (row.feedback === 'not_useful' || row.feedback === 'never_kind') return { ok: false, reason: 'You turned this note down.' };
  const s = readSolve(row.actions);
  if (!s) return { ok: false, reason: 'This note has no solution to carry out.' };
  // Held here as well as in `autoKindOf`: a tracker, or lights and nothing but lights.
  if (standing && !(s.plan.kind === 'track' || (s.plan.kind === 'home' && s.plan.entities.every((e) => e.startsWith('light.'))))) return { ok: false, reason: 'That kind waits for a tap.' };
  if (s.stored.done && !s.stored.done.undoneAt) return { ok: true, already: true, message: s.stored.done.message ?? 'Already done.', href: s.stored.done.href };
  if (inFlight.has(thoughtId)) return { ok: false, reason: 'It is already doing this.' };
  inFlight.add(thoughtId);
  let out: SolveResult;
  try {
    out = await carryOut(row, s.plan, ports, now, standing);
  } finally {
    inFlight.delete(thoughtId);
  }
  if (out.ok && !out.already) {
    emitPlatformEvent('daydream.acted', daydreamActedPayload({ daydreamId: thoughtId, title: row.title, action: `solve:${s.plan.kind}` }), { source: 'daydream' });
  }
  if (out.ok && !standing) {
    if (!row.feedback) await recordFeedback(thoughtId, 'useful', undefined).catch(() => null);
    const kind = `solve:${s.plan.kind}`;
    if ((AUTO_KINDS as readonly string[]).includes(kind)) await ladder((m) => m.recordTap(kind as AutoKind, now));
  }
  return out;
}

async function carryOut(row: Row, plan: SolvePlan, ports: () => BacklogPorts, now: Date, standing: boolean): Promise<SolveResult> {
  const at = now.toISOString();
  const auto = standing ? { auto: true } : {};
  switch (plan.kind) {
    case 'track': {
      const { startTracker } = await import('./track.server');
      const res = await startTracker(plan, { id: row.id, title: row.title }, now);
      if (!res.ok) return res;
      const href = `/jkai/daydreams/solutions#tracker-${res.tracker.id}`;
      const message = `Tracking until ${res.tracker.endDay}. The result comes to you when it ends.`;
      await markDone(row.id, plan, { at, ref: res.tracker.id, href, message, undoneAt: null, ...auto });
      return { ok: true, message, href };
    }
    case 'home': {
      const off: string[] = [];
      const refused: string[] = [];
      for (const id of plan.entities) {
        const domain = id.split('.')[0];
        const res = await tool('ha_call_service', { domain, service: 'turn_off', entity_id: id }, standing);
        (res?.success ? off : refused).push(id);
      }
      if (!off.length) return { ok: false, reason: 'Home Assistant turned none of them off. They may be unavailable.' };
      const message = refused.length ? `Turned off ${off.length}; Home Assistant refused ${refused.join(', ')}.` : `Turned off ${off.length === 1 ? off[0] : `${off.length} devices`}.`;
      await markDone(row.id, plan, { at, entities: off, message, undoneAt: null, ...auto });
      return { ok: true, message };
    }
    case 'open': {
      const message = 'Opened.';
      await markDone(row.id, plan, { at, href: plan.url, message, undoneAt: null });
      return { ok: true, message, href: plan.url };
    }
    case 'watch': {
      const { startWatch } = await import('./follow.server');
      const res = await startWatch(row.id, plan.description, now);
      if (!res.ok) return res;
      await markDone(row.id, plan, { at, href: res.href ?? '/jkai/daydreams/watches', message: res.message, undoneAt: null, ...auto });
      return res;
    }
    case 'build':
      return buildIt(row, plan, ports(), now);
  }
}

/**
 * One press for a build: on the backlog, a brief drafted, and that brief
 * accepted — the three taps the follow-ups ask for, run in order. If the brief
 * cannot be drafted it stays on the backlog as Proposed and says so.
 */
async function buildIt(row: Row, plan: Extract<SolvePlan, { kind: 'build' }>, ports: BacklogPorts, now: Date): Promise<SolveResult> {
  const { summary } = splitNarrative(row.narrative ?? row.explanation);
  const intake = await ports.intake({
    title: plan.title,
    detail: `${plan.what}\n\nWhy, from a daydream note: ${summary.replace(/\s+/g, ' ').slice(0, 800)}\n\n${noteHref(row.id)}`.slice(0, 2000),
    ref: `thought:${row.id}`,
  });
  if ('reason' in intake) return { ok: false, reason: intake.reason };
  const href = `/jkai/develop/backlog?item=${encodeURIComponent(intake.slug)}`;
  const item = await ports.item(intake.slug);
  if (!item || item.status !== 'open') {
    const message = item ? `It is on the build list already, ${item.status}.` : 'On the build list.';
    await markDone(row.id, plan, { at: now.toISOString(), ref: intake.slug, href, message, undoneAt: null });
    return { ok: true, message, href };
  }
  let grooming: Record<string, unknown> | null = null;
  try {
    grooming = await ports.groom(item);
    await ports.accept(item, grooming);
  } catch (err) {
    console.error('[daydream] build solution: brief not accepted:', err instanceof Error ? err.message : err);
    grooming = null;
  }
  if (!grooming) {
    // On the list, but not accepted: the button stays, so a second press
    // retries the brief rather than leaving him to find the backlog.
    await promoteOnly(row.id, intake.slug, now);
    return { ok: true, message: 'On the build list as Proposed. Its brief could not be drafted just now — press again later, or accept it from the backlog.', href };
  }
  const message = 'On the build list and accepted — the builder takes one accepted item a night.';
  const data: BuildData = { slug: item.slug, grooming, brief: briefView(grooming), title: item.title, detail: item.detail, kind: item.kind, priority: item.priority, acceptedAt: now.toISOString() };
  await markDone(row.id, plan, { at: now.toISOString(), ref: intake.slug, href, message, undoneAt: null }, (actions) =>
    withFollow(withFollow(actions, followEntry('build', 'Accepted for build', data, now)), followEntry('promote', 'On the backlog', { slug: intake.slug }, now)),
  );
  return { ok: true, message, href };
}

/** Record that the note's idea is on the backlog, without touching its solution. */
async function promoteOnly(id: string, slug: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daydream-follow:${id}`}))`);
    const [cur] = await tx.select({ actions: daydreamThoughts.proposedActions }).from(daydreamThoughts).where(eq(daydreamThoughts.id, id)).limit(1);
    await tx
      .update(daydreamThoughts)
      .set({ proposedActions: withFollow(cur?.actions, followEntry('promote', 'On the backlog', { slug }, now)) as Array<{ kind: string; label: string; payload: string }>, updatedAt: now })
      .where(eq(daydreamThoughts.id, id));
  });
}

/**
 * The second press: stop a tracker or a watch, or turn the lights back on.
 * Taking back something it did by itself counts against that kind on the
 * ladder (`autonomy.ts`).
 */
export async function undoSolution(thoughtId: string, now = new Date()): Promise<SolveResult> {
  const out = await takeBack(thoughtId, now);
  if (out.ok && out.wasAuto) await ladder((m) => m.recordAutoUndo(thoughtId, now));
  return out;
}

/**
 * Someone came home to lights it turned off in an empty house: on again, with
 * no press. The note reads as taken back, and says why. Not an Undo — nothing
 * is held against the kind (`standing.server.ts`).
 */
export async function restoreHome(thoughtId: string, now = new Date()): Promise<SolveResult> {
  return takeBack(thoughtId, now, { standing: true, message: 'Turned back on when someone came home.' });
}

async function takeBack(thoughtId: string, now: Date, opts: { standing?: boolean; message?: string } = {}): Promise<SolveResult & { wasAuto?: boolean }> {
  const row = await readRow(thoughtId);
  if (!row) return { ok: false, reason: 'That note no longer exists.' };
  const s = readSolve(row.actions);
  const done = s?.stored.done;
  if (!s || !done || done.undoneAt) return { ok: false, reason: 'There is nothing to undo.' };
  const wasAuto = !!done.auto;
  if (opts.standing && s.plan.kind !== 'home') return { ok: false, reason: 'Only lights are put back without a press.' };
  if (s.plan.kind === 'watch') {
    const { stopWatch } = await import('./follow.server');
    const res = await stopWatch(thoughtId, now);
    if (!res.ok) return res;
    await markDone(row.id, s.plan, { ...done, undoneAt: now.toISOString(), message: 'Stopped.' });
    return { ok: true, message: 'Watch stopped and removed.', wasAuto };
  }
  if (s.plan.kind === 'track') {
    const { stopTracker } = await import('./track.server');
    if (done.ref) await stopTracker(done.ref, now);
    await markDone(row.id, s.plan, { ...done, undoneAt: now.toISOString(), message: 'Stopped.' });
    return { ok: true, message: 'Tracker stopped.', wasAuto };
  }
  if (s.plan.kind === 'home') {
    const back: string[] = [];
    for (const id of done.entities ?? []) {
      const res = await tool('ha_call_service', { domain: id.split('.')[0], service: 'turn_on', entity_id: id }, !!opts.standing);
      if (res?.success) back.push(id);
    }
    // A restore that reached nothing is left as it was, to be tried again.
    if (opts.standing && !back.length) return { ok: false, reason: 'Home Assistant turned none back on.' };
    await markDone(row.id, s.plan, { ...done, undoneAt: now.toISOString(), message: opts.message ?? `Turned back on: ${back.length}.` });
    return { ok: true, message: back.length ? `Turned ${back.length} back on.` : 'Home Assistant turned none back on.', wasAuto };
  }
  return { ok: false, reason: 'This one cannot be taken back here.' };
}

/**
 * When he marks a note worth knowing and its solution is a build nobody has
 * started, the gap goes on the build list by itself — Proposed, merged with
 * any duplicate, nothing built until he accepts it. Owner, 2026-10-29: when a
 * note is accepted, the site should become able to do what it suggests.
 */
export async function fileGapOnAccept(thoughtId: string, ports: () => BacklogPorts, now = new Date()): Promise<{ filed: string | null }> {
  const row = await readRow(thoughtId);
  const s = row ? readSolve(row.actions) : null;
  if (!row || !s || s.plan.kind !== 'build' || s.stored.done) return { filed: null };
  const { readFollow } = await import('./follow');
  if (readFollow(row.actions).promote) return { filed: null };
  const plan = s.plan;
  const res = await ports().intake({
    title: plan.title,
    detail: `${plan.what}\n\nFrom a daydream note he marked worth knowing: ${noteHref(row.id)}`.slice(0, 2000),
    ref: `thought:${row.id}`,
  });
  if ('reason' in res) return { filed: null };
  // Only the backlog entry: "Build it" stays ready, and pressing it later
  // finds this item (intake merges) and accepts it.
  await promoteOnly(thoughtId, res.slug, now);
  return { filed: res.slug };
}

// src/lib/trips/decisions.api.server.ts
//
// v8: the decision routes, once for both lanes. The site (`/api/trips/:id/…`,
// the owner's session) and the phone (`/api/native/trips/:id/…`, a family
// member's device) each work out who is calling and what they may do, then
// hand over here with the same bodies and responses:
//
//   GET    decisions        the brief, open questions and proposals, the pack
//   POST   proposals        swap / fill / nudge / day (shapes: S2)
//   POST   proposals/:pid   accept, or turn down with a reason
//   POST   undo             back to a version (default: the one before)
//   GET    versions         the history, with which can be restored
//   PATCH  brief            a direct edit to the brief
//
// Proposals, undo and brief edits change the trip, so they are for editors —
// the creator and the parents (`canEdit || canApprove`); anyone else in the
// family gets a 403 with a sentence and keeps "Make a suggestion". Long work
// may be asked for with `"async": true` (→ 202 `{ job }`, polled at
// …/trips/jobs/:jobId); a job's result is the same body, with `status` added
// when it is not a 200.

import { json } from '@sveltejs/kit';
import { readBriefPatch } from './brief';
import { patchBrief } from './brief.server';
import { decisionsWire } from './decisions.bundle.server';
import { tripAccess } from './family';
import type { TripCaller } from './family.server';
import { jobAccepted, startJob, wantsAsync } from './jobs.server';
import type { TripAccess } from './model';
import { readDecision, readProposalRequest } from './proposals';
import { acceptProposal, generateProposals, rejectProposal, type Outcome, type ProposalCaller } from './proposals.server';
import type { TripRecord } from './store.server';
import { undoTo } from './undo.server';
import { listVersions } from './undo.store.server';

export interface DecisionCaller {
  email: string;
  /** Display name for the conversation log; null on the site (the owner). */
  name: string | null;
  personId: string | null;
  isOwner: boolean;
  access: Pick<TripAccess, 'role' | 'canEdit' | 'canApprove'>;
  surface: 'site' | 'phone';
}

export const NOT_AN_EDITOR = 'Only whoever made the trip or a parent can change the plan — use “Make a suggestion” instead.';

/** The creator and the parents decide; everyone else suggests. */
export const canDecide = (a: Pick<TripAccess, 'canEdit' | 'canApprove'>) => a.canEdit || a.canApprove;

const refuse = () => json({ error: NOT_AN_EDITOR }, { status: 403 });
const answer = (o: Outcome) => json(o.body, { status: o.status });
const proposalCaller = (c: DecisionCaller): ProposalCaller => ({ email: c.email, name: c.name, personId: c.personId, isOwner: c.isOwner, surface: c.surface });

/**
 * Run now, or as a job when the body asks for `"async": true` (`run` is told
 * it is inside the job, so a slow fallback does not start a second one).
 */
async function runOrJob(body: unknown, c: DecisionCaller, run: (inJob: boolean) => Promise<Outcome>): Promise<Response> {
  if (wantsAsync(body)) {
    return jobAccepted(
      startJob(c.email, 'proposals', async () => {
        const o = await run(true);
        return o.status === 200 ? o.body : { ...o.body, status: o.status };
      }),
    );
  }
  return answer(await run(false));
}

export async function getDecisions(trip: TripRecord, c: DecisionCaller): Promise<Response> {
  return json(await decisionsWire(trip, c.access, { surface: c.surface }), { headers: { 'cache-control': 'private, no-store' } });
}

export async function postProposals(trip: TripRecord, c: DecisionCaller, body: unknown): Promise<Response> {
  if (!canDecide(c.access)) return refuse();
  const parsed = readProposalRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return runOrJob(body, c, (inline) => generateProposals(trip, parsed.request, proposalCaller(c), { inline }));
}

export async function postProposalDecision(trip: TripRecord, c: DecisionCaller, pid: string, body: unknown): Promise<Response> {
  if (!canDecide(c.access)) return refuse();
  const parsed = readDecision(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  if (parsed.action === 'reject') return answer(await rejectProposal(trip, pid, parsed.reason, proposalCaller(c), parsed.note));
  return runOrJob(body, c, () => acceptProposal(trip, pid, proposalCaller(c)));
}

export async function postUndo(trip: TripRecord, c: DecisionCaller, body: unknown): Promise<Response> {
  if (!canDecide(c.access)) return refuse();
  const raw = body && typeof body === 'object' ? (body as { toVersion?: unknown }).toVersion : undefined;
  if (raw !== undefined && raw !== null && !Number.isInteger(raw)) return json({ error: 'toVersion is a version number.' }, { status: 400 });
  return runOrJob(body, c, () => undoTo(trip, (raw as number | null | undefined) ?? null, { name: c.name, surface: c.surface }));
}

export async function getVersions(trip: TripRecord): Promise<Response> {
  return json({ versions: await listVersions(trip.id, 30) }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function patchBriefRoute(trip: TripRecord, c: DecisionCaller, body: unknown): Promise<Response> {
  if (!canDecide(c.access)) return refuse();
  const parsed = readBriefPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  return runOrJob(body, c, () => patchBrief(trip, parsed.patch, { name: c.name, surface: c.surface }));
}

// ── Who is calling, per lane ───────────────────────────────────────────────

/** The site: the owner's session (requireTripOwner), who is the trip's creator or a parent. */
export function siteDecider(owner: string, trip: Pick<TripRecord, 'ownerEmail'>): DecisionCaller {
  return { email: owner, name: null, personId: null, isOwner: true, access: tripAccess(trip.ownerEmail, { email: owner, parent: true }), surface: 'site' };
}

/** The phone: a family member's device (`familyTrip`), with what they may do with this trip. */
export function phoneDecider(ft: { caller: Pick<TripCaller, 'email' | 'name' | 'personId' | 'isOwner'>; access: TripAccess }): DecisionCaller {
  return { email: ft.caller.email, name: ft.caller.name, personId: ft.caller.personId, isOwner: ft.caller.isOwner, access: ft.access, surface: 'phone' };
}

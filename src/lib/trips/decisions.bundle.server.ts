// src/lib/trips/decisions.bundle.server.ts
//
// v8: the decisions part of the phone bundle and the site page — the brief,
// the open questions this caller may answer, the open proposals this caller
// may act on, and the research pack's summary. One loader so the bundle,
// the site page and the decision routes all show the same thing.

import { buildBrief } from './brief';
import type { PackSummary, Proposal, Question, QuestionAudience, TripBrief } from './decisions';
import { MAX_OPEN_QUESTIONS } from './decisions';
import { listProposals, listQuestions, readPack, readProvenance } from './decisions.store.server';
import type { TripAccess } from './model';
import { missingInfo } from './prompt';
import { listTransport, loadState, type TripRecord } from './store.server';
import { tripOnly } from './store.server';

export interface DecisionsWire {
  brief: TripBrief;
  /** Open questions this caller may answer, most important first (≤ MAX_OPEN_QUESTIONS). */
  questions: Question[];
  /** Questions answered in the last day, for "What changed" after an answer on another device. */
  answered: Question[];
  /** Open proposals this caller may act on (editors only). */
  proposals: Proposal[];
  pack: PackSummary;
}

/** Which audiences a caller sees: the creator everything; parents parents + family; members family. */
export function audiencesFor(access: Pick<TripAccess, 'role' | 'canEdit' | 'canApprove'>): QuestionAudience[] {
  if (access.role === 'creator') return ['owner', 'parents', 'family'];
  if (access.canApprove) return ['parents', 'family'];
  return ['family'];
}

/**
 * The brief as the phone may see it (v5 rule: no memory text on the wire, for
 * anyone, the owner included): preferences and constraints — which come from
 * memory — are left off, and a 'notes' item keeps its label (a trip fact, such
 * as the stay) but loses the note and the memory reference.
 */
export function phoneBrief(brief: TripBrief): TripBrief {
  const items = brief.items
    .filter((i) => i.kind !== 'preference' && i.kind !== 'constraint')
    .map((i) => (i.origin === 'notes' ? { ...i, note: null, ref: null } : i));
  return { ...brief, items, assumed: items.filter((i) => i.origin === 'assumed').length };
}

export async function decisionsWire(
  trip: TripRecord,
  access: Pick<TripAccess, 'role' | 'canEdit' | 'canApprove'>,
  opts: { surface: 'site' | 'phone' } = { surface: 'phone' },
): Promise<DecisionsWire> {
  const [state, transport, provenance, open, recent, proposals, pack] = await Promise.all([
    loadState(trip.id),
    listTransport(trip.id),
    readProvenance(trip.id),
    listQuestions(trip.id, { status: ['open'] }),
    listQuestions(trip.id, { status: ['answered'], limit: 10 }),
    access.canEdit || access.canApprove ? listProposals(trip.id, { status: ['open'] }) : Promise.resolve([] as Proposal[]),
    readPack(trip.id),
  ]);
  const audiences = new Set(audiencesFor(access));
  const dayAgo = Date.now() - 24 * 3600_000;
  const brief = buildBrief({
      trip: tripOnly(trip),
      stays: state.stays,
      wishes: state.wishes,
      bookings: state.bookings,
      transport,
      profile: trip.profile,
      provenance,
      missing: missingInfo(trip, state.stays, state.wishes),
    });
  return {
    brief: opts.surface === 'phone' ? phoneBrief(brief) : brief,
    questions: open.filter((q) => audiences.has(q.audience)).slice(0, MAX_OPEN_QUESTIONS),
    answered: recent.filter((q) => audiences.has(q.audience) && q.answeredAt && Date.parse(q.answeredAt) > dayAgo),
    proposals,
    pack,
  };
}

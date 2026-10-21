// src/lib/trips/proposals.server.ts
//
// v8: proposals, the I/O half — checking drafts into stored proposals,
// accepting, turning down, and the fast path that proposes swaps, fills,
// nudges and day versions from the research pack in a couple of seconds.
//
// Why: in production the planner offered options the site never drew, picking
// one on the phone sent a SENTENCE back through the chat (40–90 s, the place
// lost), and four "ideas" requests in six found nothing because each started
// from scratch. Now:
//  - every proposal is DRY-RUN (./dryrun) before anyone sees it — its diff,
//    the days it changes, its trade-offs — and STORED with the version it was
//    checked against (`basedOnVersion`);
//  - accepting replays exactly the stored ops (`trustsPlaces`: the place was
//    found and checked when it was proposed — never re-asked of a model, never
//    a sentence). If the plan moved on since, the ops are checked again and,
//    if the difference is materially new, the person sees it first (409
//    `{ stale: true, proposal }`);
//  - the fast path draws on the research pack and the solver only — no model,
//    no web — so a swap comes back in under two seconds. With no pack yet it
//    falls back to the live ideas search, as a job, and says so.
//
// Shapes (whole-trip proposals) come from ./shapes.server.

import { requestShapes } from './shapes.server';
import { randomUUID } from 'node:crypto';
import { solveTrip } from '$lib/trips/solver';
import { dayLabel } from './changes';
import { applyDirect, logEdit } from './converse.server';
import type { Nudge, PackPlace, Proposal, ProposalDraft, ProposalTradeoffs, RejectReason } from './decisions';
import { EMPTY_DIFF, NUDGE_LABEL, REJECT_REASON_LABEL } from './decisions';
import {
  addProposals,
  decideProposal,
  expireProposals,
  getPackPlace,
  getProposal,
  listPackPlaces,
  listProposals,
  readPack,
  supersedeGroup,
  updatePackPlace,
  type NewProposal,
} from './decisions.store.server';
import { dryRun, planDiff, type DryRunResult } from './dryrun';
import { judgeIdea, type Verdict } from './ideas';
import { findIdeas } from './ideas.server';
import { fetchImage } from './images.server';
import { wikidataId } from './images';
import { startJob, type TripJob } from './jobs.server';
import type { DayStage, LocalDate, PlaceImage, SolvedPlan, Wish } from './model';
import { optionFit, type PlanOption } from './options';
import { solverInput } from './plan.server';
import { replan } from './plan.server';
import {
  changeSummary,
  GROUP_SIZE,
  legacyOption,
  lighterOps,
  materiallyDiffers,
  MAX_CANDIDATES,
  nudgeRank,
  orderChecked,
  packDraft,
  packFacts,
  packWish,
  pickBest,
  rainyOps,
  rankCandidates,
  slotDistance,
  slotFor,
  swapDaysOps,
  type NudgeRef,
  type ProposalRequest,
  type Slot,
  type SlotTarget,
} from './proposals';
import { moveProposal, updateProposalCheck } from './proposals.store.server';
import { refreshQuestions } from './questions.server';
import { emptyFacts, withinReach, type OsmPlace } from './research';
import { findPlaceLoosely, startResearch } from './research.server';
import { getTripById, latestPlan, loadState, tripOnly, updateWish, type StoredPlan, type TripRecord, type TripState } from './store.server';

/** Who is deciding: the site's owner, or a family member's phone (an editor — the routes check). */
export interface ProposalCaller {
  email: string;
  name: string | null;
  personId?: string | null;
  isOwner: boolean;
  surface: 'site' | 'phone';
}

/** A route's answer: its status and JSON body. */
export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

export interface ProposalDeps {
  place?: typeof findPlaceLoosely;
  image?: (wikidata: string) => Promise<PlaceImage | null>;
  now?: () => number;
  /** The fast path's dry-run budget, ms. */
  budgetMs?: number;
  /** Already running as a job (`"async": true`): a slow fallback runs here, not as a second job. */
  inline?: boolean;
}

/** The fast path stops dry-running candidates after this long (target: under 2 s in all). */
export const FAST_PATH_MS = 1500;
/** A photograph for a model-drafted place is looked for this long, then the card goes without. */
const IMAGE_MS = 3000;

export const NOT_READY_WAIT = 'The research for this trip is not ready yet — try again in a minute or two.';
export const NOT_READY_NOTE = 'The research for this trip is not ready yet, so I am searching the map around that part of the day instead — this can take up to a minute.';

const STATUS_WORD: Record<Proposal['status'], string> = { open: 'open', accepted: 'taken', rejected: 'turned down', superseded: 'replaced by another choice', expired: 'out of date' };

// ── The trip as it stands, once per call ───────────────────────────────────

interface Base {
  trip: TripRecord;
  latest: StoredPlan;
  input: Awaited<ReturnType<typeof solverInput>>['input'];
  state: TripState;
  baseline: SolvedPlan;
  titles: Record<string, string>;
  /** Every pack place, whatever its status. */
  pack: PackPlace[];
}

async function loadBase(trip: TripRecord): Promise<Base | null> {
  const latest = await latestPlan(trip.id);
  if (!latest) return null;
  const [{ input, state }, pack] = await Promise.all([solverInput(trip, latest, { reuseMatrix: true }), listPackPlaces(trip.id).catch(() => [] as PackPlace[])]);
  return { trip, latest, input, state, baseline: solveTrip(input), titles: Object.fromEntries(state.wishes.map((w) => [w.id, w.title])), pack };
}

const dryBase = (b: Base) => ({
  input: b.input,
  ctx: { trip: tripOnly(b.trip), stays: b.state.stays, wishes: b.state.wishes, bookings: b.state.bookings, transport: b.input.transport ?? [], profile: b.trip.profile },
});

/** The pack's facts for a place it holds (by OSM id, else the same spot). */
function packFor(pack: PackPlace[], place: { osmId: string | null; location: { lat: number; lng: number } }): PackPlace | null {
  return (
    (place.osmId ? pack.find((p) => p.place.osmId === place.osmId) : undefined) ??
    pack.find((p) => Math.abs(p.place.location.lat - place.location.lat) < 1e-6 && Math.abs(p.place.location.lng - place.location.lng) < 1e-6) ??
    null
  );
}

async function imageWithin(wikidata: string | null, deps: ProposalDeps): Promise<PlaceImage | null> {
  const q = wikidataId(wikidata);
  if (!q) return null;
  const get = deps.image ?? (async (id: string) => (await fetchImage(id)) ?? null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), IMAGE_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([get(q).catch(() => null), late]).finally(() => clearTimeout(timer));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

// ── Checking one draft ─────────────────────────────────────────────────────

interface Checked {
  proposal: NewProposal;
  /** For a fill or swap: where it lands and what it costs the day (the legacy option card's). */
  verdict: Verdict | null;
}

/** The slot a model's fill or swap draft is for, when its scope names one. */
function draftSlot(base: Base, draft: ProposalDraft): Slot | null | 'refused' {
  const s = draft.scope ?? {};
  if (draft.kind === 'swap' && (s.wishId || s.stopId)) {
    const r = slotFor(base.latest.plan, base.state.wishes, base.state.bookings, 'swap', s);
    return r.ok ? r.slot : r.status === 409 ? 'refused' : null;
  }
  if ((draft.kind === 'fill' || draft.kind === 'swap') && s.date && s.stage) {
    const r = slotFor(base.latest.plan, base.state.wishes, base.state.bookings, 'fill', s);
    return r.ok ? r.slot : null;
  }
  return null;
}

/**
 * Dry-run one draft against the trip as it stands. A model's places are
 * looked up on the map (never its coordinates) and must be near the slot or
 * a stay; a research-pack place rides along as found. Null when it changes
 * nothing, any op is refused, or — for a fill or swap — it neither lands in
 * its slot nor says what it would push out.
 */
async function checkOne(
  base: Base,
  draft: ProposalDraft,
  opts: { trusted: boolean; groupId: string; slot?: Slot | null; deps: ProposalDeps; onDrop?: (why: string) => void },
): Promise<Checked | null> {
  const slot = opts.slot !== undefined ? opts.slot : draftSlot(base, draft);
  if (slot === 'refused') return null;
  const pp = draft.packPlaceId ? (base.pack.find((p) => p.id === draft.packPlaceId) ?? null) : null;
  if (pp && pp.status !== 'candidate') return null; // already planned, or turned down
  const ops = clone(draft.ops).filter(isObj);
  let trusted = opts.trusted;
  if (!opts.trusted) {
    // A model's ops never carry a place: each is looked up by its query.
    for (const op of ops) if (op.op === 'addWish' && isObj(op.wish)) delete op.wish.place;
    if (pp) {
      const add = ops.find((o) => o.op === 'addWish' && isObj(o.wish));
      if (add) (add.wish as Obj).place = { ...pp.place };
      else if (slot) ops.push({ op: 'addWish', wish: packWish(pp, slot) as unknown as Obj });
      trusted = true; // the only place carried is the pack's
    }
  }
  const anchors = [slot?.gap.before.location, slot?.gap.after.location, ...base.state.stays.map((s) => s.location)];
  const found = new Map<string, OsmPlace>();
  const resolvePlace = async (query: string, near: { lat: number; lng: number } | null) => {
    const hit = await (opts.deps.place ?? findPlaceLoosely)(query, base.trip.destination, slot?.gap.before.location ?? slot?.gap.after.location ?? near).catch(() => null);
    if (!hit || !withinReach(hit.location, anchors)) return null;
    found.set(`${hit.location.lat},${hit.location.lng}`, hit);
    return { name: hit.name, location: hit.location, osmId: hit.osmId, address: hit.address };
  };
  const factsFor = (place: { osmId: string | null; location: { lat: number; lng: number } }): Wish['facts'] => {
    const p = packFor(base.pack, place);
    if (p) return packFacts(p);
    const osm = found.get(`${place.location.lat},${place.location.lng}`);
    return osm?.openingHoursText ? { ...emptyFacts('brief', null), openingHoursText: osm.openingHoursText } : null;
  };
  let r: DryRunResult;
  try {
    r = await dryRun(dryBase(base), ops, { resolvePlace, trustsPlaces: trusted, factsFor, baseline: base.baseline, titles: base.titles });
  } catch (err) {
    console.warn('[trips/proposals] a dry run failed:', (err as Error)?.message);
    return null;
  }
  if (r.rejected.length) {
    opts.onDrop?.(r.rejected.map((x) => x.reason).join(' '));
    return null;
  }
  // Nothing to see (no stop moves, nothing added or left out) is not a proposal.
  if (!r.changed || !r.applied.length || (!r.diff.changes.length && !r.diff.dates.length)) {
    opts.onDrop?.('It would not change the plan.');
    return null;
  }

  const added = r.applied.find((o) => o.op === 'addWish') as Extract<(typeof r.applied)[number], { op: 'addWish' }> | undefined;
  const addedPlace = added?.wish.place ?? null;
  // A model's place the pack already holds: its facts and photo — unless it was turned down.
  const known = !pp && addedPlace ? packFor(base.pack, addedPlace) : null;
  if (known?.status === 'rejected') return null;
  const placePack = pp ?? (known?.status === 'candidate' ? known : null);
  let verdict: Verdict | null = null;
  if (slot && (draft.kind === 'fill' || draft.kind === 'swap') && added && r.created.wishes[0]) {
    verdict = judgeIdea(r.plan, base.baseline, new Map(Object.entries(base.titles)), { id: r.created.wishes[0], facts: addedPlace ? factsFor(addedPlace) : null, replacesMeal: added.wish.replacesMeal ?? null }, slot.gap);
    if (!verdict.fits && !verdict.pushesOut.length) {
      opts.onDrop?.(verdict.reason ?? 'It does not fit.');
      return null;
    }
  }
  const osm = addedPlace ? found.get(`${addedPlace.location.lat},${addedPlace.location.lng}`) : undefined;
  const image = placePack?.image ?? (osm ? await imageWithin(osm.wikidata, opts.deps) : null);
  const tradeoffs: ProposalTradeoffs = {
    ...r.tradeoffs,
    fits: verdict ? verdict.fits : r.tradeoffs.fits,
    fitText: verdict ? optionFit(verdict) : changeSummary(r.diff),
    costText: placePack?.costText ?? draft.costText ?? null,
    indoor: placePack?.indoor ?? draft.indoor ?? null,
    kidFriendly: placePack?.kidFriendly ?? draft.kidFriendly ?? null,
    lessVisited: placePack?.lessVisited ?? false,
  };
  return {
    verdict,
    proposal: {
      groupId: opts.groupId,
      kind: draft.kind,
      title: draft.title,
      why: draft.why,
      scope: {
        date: draft.scope?.date ?? slot?.date ?? r.diff.dates[0] ?? null,
        stage: draft.scope?.stage ?? slot?.stage ?? null,
        stopId: draft.scope?.stopId ?? slot?.replaces?.wishId ?? null,
        wishId: draft.scope?.wishId ?? slot?.replaces?.wishId ?? null,
      },
      ops: r.applied,
      diff: r.diff,
      tradeoffs,
      evidence: draft.evidence?.length ? draft.evidence : (placePack?.sources ?? []),
      place: addedPlace ? { name: addedPlace.name, location: addedPlace.location } : null,
      image,
      packPlaceId: placePack?.id ?? null,
      shape: null,
      preview: r.preview,
      basedOnVersion: base.latest.version,
    },
  };
}

const shortId = () => randomUUID().slice(0, 8);

/**
 * Check the planner's (or a rule's) drafts and store the ones that change
 * something, in groups: a draft's `group` (namespaced to this call, so two
 * turns' "dinner" groups never close each other), `opts.group`, or one group
 * for the call. Returns the stored proposals and, for fills and swaps, the
 * legacy option cards the family's current app draws.
 */
export async function checkDrafts(
  trip: TripRecord,
  drafts: ProposalDraft[],
  opts: { authorEmail?: string | null; group?: string | null; trusted?: boolean; deps?: ProposalDeps } = {},
): Promise<{ proposals: Proposal[]; options: PlanOption[] }> {
  if (!drafts.length) return { proposals: [], options: [] };
  const base = await loadBase(trip);
  if (!base) return { proposals: [], options: [] };
  const call = shortId();
  const checked: Checked[] = [];
  const seen = new Set<string>();
  for (const d of drafts.slice(0, 6)) {
    const groupId = opts.group ?? (d.group ? `${d.group}:${call}` : `g:${call}`);
    const one = await checkOne(base, d, { trusted: opts.trusted === true, groupId, deps: opts.deps ?? {} });
    if (!one) continue;
    const key = `${one.proposal.title.toLowerCase()}|${one.proposal.scope.date ?? ''}|${one.proposal.diff.lines.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checked.push(one);
  }
  if (!checked.length) return { proposals: [], options: [] };
  const stored = await addProposals(trip.id, checked.map((c) => c.proposal), opts.authorEmail ?? null);
  const options = stored
    .map((p, i) => (checked[i]?.verdict ? legacyOption(p, checked[i].verdict!, i) : null))
    .filter((o): o is PlanOption => !!o)
    .slice(0, GROUP_SIZE);
  return { proposals: stored, options };
}

/** As the contract names it: check, store, return the proposals. */
export async function checkProposalDrafts(trip: TripRecord, drafts: ProposalDraft[], opts: { authorEmail?: string | null; group?: string | null } = {}): Promise<Proposal[]> {
  return (await checkDrafts(trip, drafts, opts)).proposals;
}

// ── Accepting and turning down ─────────────────────────────────────────────

/**
 * Accept a proposal: replay its checked ops (trusted places), re-solve once,
 * close the rest of its group (every open shape, for a shape), record the
 * change as the person's own, and say what changed with the version Undo
 * goes back to. If the plan moved on since it was checked, it is checked
 * again first: materially different → 409 `{ stale: true, proposal }` with
 * the new difference stored, so the person sees it before it lands.
 */
export async function acceptProposal(trip: TripRecord, pid: string, caller: ProposalCaller): Promise<Outcome> {
  const p = await getProposal(trip.id, pid);
  if (!p) return { status: 404, body: { error: 'No such proposal.' } };
  if (p.status !== 'open') return { status: 409, body: { error: `That proposal was already ${STATUS_WORD[p.status]}.`, proposal: p } };
  const before = await latestPlan(trip.id);

  if (before && p.basedOnVersion !== before.version) {
    const base = await loadBase(trip);
    if (base) {
      const factsFor = (place: { osmId: string | null; location: { lat: number; lng: number } }) => {
        const x = packFor(base.pack, place);
        return x ? packFacts(x) : null;
      };
      const r = await dryRun(dryBase(base), p.ops, { trustsPlaces: true, factsFor, baseline: base.baseline, titles: base.titles }).catch(() => null);
      if (!r || !r.ok || !r.changed) {
        const why = 'The plan has moved on and this no longer applies.';
        await decideProposal(trip.id, pid, 'expired', why, null);
        return { status: 409, body: { error: why, proposal: await getProposal(trip.id, pid) } };
      }
      if (materiallyDiffers(p.diff, r.diff)) {
        const slotted = p.kind === 'fill' || p.kind === 'swap';
        const tradeoffs: ProposalTradeoffs = {
          ...p.tradeoffs,
          ...r.tradeoffs,
          fitText: slotted ? (r.tradeoffs.pushesOut.length ? `Would now push out ${r.tradeoffs.pushesOut.join(', ')}` : p.tradeoffs.fitText) : changeSummary(r.diff),
        };
        await updateProposalCheck(trip.id, pid, { diff: r.diff, preview: r.preview, tradeoffs, basedOnVersion: base.latest.version });
        return { status: 409, body: { stale: true, proposal: await getProposal(trip.id, pid) } };
      }
    }
  }

  // Claim it before applying, so two taps (or two devices) never apply it twice.
  if (!(await decideProposal(trip.id, pid, 'accepted', null, caller.email))) {
    return { status: 409, body: { error: 'Someone got there first.', proposal: await getProposal(trip.id, pid) } };
  }
  const { result, created } = await applyDirect(trip, p.ops, { trustedPlaces: true, provenance: 'you' });
  if (!result.changed) {
    const why = `It no longer fits the plan${result.rejected.length ? `: ${result.rejected.map((x) => x.reason).join(' ')}` : '.'}`;
    await moveProposal(trip.id, pid, 'accepted', 'expired', why);
    return { status: 409, body: { error: why, proposal: await getProposal(trip.id, pid) } };
  }

  // A pack place becomes a planned wish carrying the pack's facts (hours,
  // booking, price, sources), so it is not researched again from nothing.
  const newWish = created.wishes[0] ?? null;
  const pp = p.packPlaceId ? await getPackPlace(trip.id, p.packPlaceId).catch(() => null) : null;
  if (pp && newWish) {
    await updateWish(trip.id, newWish, { facts: packFacts(pp) });
    await updatePackPlace(trip.id, pp.id, { status: 'planned', wishId: newWish });
  }
  // A swapped-out pack place goes back on the long list.
  const removed = result.applied.flatMap((o) => (o.op === 'removeWish' ? [o.id] : []));
  if (removed.length) {
    const planned = await listPackPlaces(trip.id, { status: ['planned'] }).catch(() => [] as PackPlace[]);
    for (const x of planned.filter((x) => x.wishId && removed.includes(x.wishId))) await updatePackPlace(trip.id, x.id, { status: 'candidate', wishId: null });
  }

  const fresh = (await getTripById(trip.id)) ?? trip;
  let after: StoredPlan | null = before;
  let changes: string[] = [];
  let made = false;
  try {
    // On the phone a change is the phone's own version of the day (the running-day rule); on the site it is labelled a proposal.
    const solved = await replan(fresh, caller.surface === 'phone' ? 'phone' : 'proposal', { keepRunningDay: caller.surface !== 'phone' });
    after = solved.plan;
    made = solved.created;
    changes = solved.created ? solved.plan.changes : [];
  } catch (err) {
    console.error('[trips/proposals] re-plan after accepting failed:', err);
    changes = ['The change is saved, but the plan could not be rebuilt just now.'];
  }
  const research = result.research.flatMap((x) => x.wishIds).filter((id) => !(pp && id === newWish));
  if (research.length) void startResearch(trip.ownerEmail, trip.id, { wishIds: research, depth: 'brief' }).catch(() => {});

  await supersedeGroup(trip.id, p.groupId, p.id, `Chose ${p.title}`);
  if (p.kind === 'shape') await expireProposals(trip.id, ['shape'], `Chose ${p.title}`);
  const { wishes } = await loadState(trip.id);
  const diff = made && after ? planDiff(before?.plan ?? null, after.plan, Object.fromEntries(wishes.map((w) => [w.id, w.title]))) : EMPTY_DIFF;
  await logEdit(trip.id, `${caller.name ? `${caller.name} chose` : 'Chose'} ${p.title}.`, result.applied, made && after ? after.version : null, caller.surface);
  void Promise.resolve()
    .then(() => refreshQuestions(fresh, { reason: 'proposal' }))
    .catch((err) => console.warn('[trips/proposals] questions not refreshed:', (err as Error)?.message));
  return {
    status: 200,
    body: { proposal: await getProposal(trip.id, pid), planVersion: after?.version ?? null, changes, diff, undo: before ? { toVersion: before.version } : null },
  };
}

/** Turn a proposal down with a reason: a preference signal, and its pack place leaves the long list. */
export async function rejectProposal(trip: TripRecord, pid: string, reason: RejectReason, caller: ProposalCaller, note: string | null = null): Promise<Outcome> {
  const p = await getProposal(trip.id, pid);
  if (!p) return { status: 404, body: { error: 'No such proposal.' } };
  if (p.status !== 'open') return { status: 409, body: { error: `That proposal was already ${STATUS_WORD[p.status]}.`, proposal: p } };
  const label = `${REJECT_REASON_LABEL[reason]}${note ? `: ${note}` : ''}`;
  if (!(await decideProposal(trip.id, pid, 'rejected', label, caller.email))) return { status: 409, body: { error: 'Someone got there first.', proposal: await getProposal(trip.id, pid) } };
  if (p.packPlaceId) await updatePackPlace(trip.id, p.packPlaceId, { status: 'rejected', rejectReason: reason }).catch(() => {});
  // Two turn-downs for the same reason become a standing question (S2's reaction rule).
  void Promise.resolve()
    .then(() => refreshQuestions(trip, { reason: 'rejected' }))
    .catch(() => {});
  return { status: 200, body: { proposal: await getProposal(trip.id, pid) } };
}

// ── The fast path: from the research pack, no model, no web ────────────────

/**
 * `POST proposals`: alternatives for a stop (swap), a part of a day (fill),
 * the same slot nudged, or a version of a day — one stored group. `fallback:
 * false` (the conversation's own use) never starts the live search.
 */
export async function generateProposals(trip: TripRecord, request: ProposalRequest, caller: ProposalCaller, deps: ProposalDeps & { fallback?: boolean } = {}): Promise<Outcome> {
  if (request.kind === 'shapes') {
    // Whole-trip shapes (./shapes.server): one model call choosing from the
    // research pack, each solved as a whole. Slow, so routes run it async.
    const shapes = await requestShapes(trip, { email: caller.email, isOwner: caller.isOwner });
    return shapes.length
      ? { status: 200, body: { proposals: shapes } }
      : { status: 200, body: { proposals: [], note: 'There is not enough in the research yet to draft whole-trip plans — let it finish, or ask me to look further.' } };
  }
  const base = await loadBase(trip);
  if (!base) return { status: 409, body: { error: 'There is no plan yet — say where you are staying and a few things you would like to do first.' } };
  switch (request.kind) {
    case 'fill':
      if (request.target.packPlaceId) return chosenPlaceGroup(base, request.target.date as LocalDate, request.target.stage ?? null, request.target.packPlaceId, caller, deps);
      return slotGroup(base, 'fill', request.target, null, caller, deps);
    case 'swap':
      return slotGroup(base, 'swap', request.target, null, caller, deps);
    case 'nudge':
      return nudgeGroup(base, request, caller, deps);
    case 'day':
      return dayGroup(base, request, caller, deps);
  }
}

/**
 * For the conversation (v8): a `fill` group from the pack for a part of a
 * day, with the legacy option cards — what a turn offers when the planner
 * could only talk. Never starts the live search.
 */
export async function offerFromPack(trip: TripRecord, target: { date: LocalDate; stage: Slot['stage'] }, caller: ProposalCaller, deps: ProposalDeps = {}): Promise<{ proposals: Proposal[]; options: PlanOption[] }> {
  const base = await loadBase(trip);
  if (!base) return { proposals: [], options: [] };
  const o = await slotGroup(base, 'fill', target, null, caller, { ...deps, fallback: false });
  return o.status === 200 ? { proposals: (o.body.proposals as Proposal[] | undefined) ?? [], options: o.legacy ?? [] } : { proposals: [], options: [] };
}

type Ranked = Checked & { fits: boolean; lessVisited: boolean; walkMin: number | null };

/** Dry-run the slot's nearest pack places within the budget; the best that fit, in order. */
async function bestFromPack(base: Base, slot: Slot, group: string, nudge: { nudge: Nudge; ref: NudgeRef; exclude: Set<string> } | null, deps: ProposalDeps, exclude: Set<string> = new Set()): Promise<Ranked[]> {
  const anchor = base.state.stays[0]?.location ?? null;
  const skip = new Set([...exclude, ...(nudge?.exclude ?? [])]);
  let ranked = rankCandidates(base.pack, slot, base.state.wishes, { limit: nudge ? 60 : MAX_CANDIDATES, exclude: skip, anchor });
  if (nudge) ranked = nudgeRank(ranked, nudge.nudge, nudge.ref).slice(0, MAX_CANDIDATES);
  const now = deps.now ?? Date.now;
  const started = now();
  const checked: Ranked[] = [];
  for (const c of ranked) {
    if (now() - started > (deps.budgetMs ?? FAST_PATH_MS)) break;
    const enough = checked.filter((x) => x.fits);
    if (nudge?.nudge !== 'less-walking' && enough.length >= GROUP_SIZE && enough.some((x) => x.lessVisited)) break;
    const one = await checkOne(base, packDraft(c.place, slot, group), { trusted: true, groupId: group, slot, deps });
    if (one) checked.push({ ...one, fits: one.proposal.tradeoffs.fits, lessVisited: c.place.lessVisited, walkMin: one.proposal.tradeoffs.walkMin });
  }
  return pickBest(orderChecked(checked, nudge?.nudge ?? null, nudge?.ref ?? null));
}

async function store(base: Base, picked: Checked[], caller: ProposalCaller, note: string | null = null): Promise<Outcome & { legacy?: PlanOption[] }> {
  const proposals = await addProposals(base.trip.id, picked.map((b) => b.proposal), caller.email);
  const legacy = proposals.map((p, i) => (picked[i]?.verdict ? legacyOption(p, picked[i].verdict!, i) : null)).filter((o): o is PlanOption => !!o);
  return { status: 200, body: note ? { proposals, note } : { proposals }, legacy };
}

async function slotGroup(
  base: Base,
  kind: 'swap' | 'fill',
  target: SlotTarget,
  nudge: { nudge: Nudge; ref: NudgeRef; exclude: Set<string> } | null,
  caller: ProposalCaller,
  deps: ProposalDeps & { fallback?: boolean },
): Promise<Outcome & { legacy?: PlanOption[] }> {
  const s = slotFor(base.latest.plan, base.state.wishes, base.state.bookings, kind, target);
  if (!s.ok) return { status: s.status, body: { error: s.error } };
  const slot = s.slot;
  const candidates = base.pack.filter((p) => p.status === 'candidate');
  if (!candidates.length) return deps.fallback === false ? { status: 200, body: { proposals: [], note: NOT_READY_WAIT } } : ideasFallback(base.trip, slot, caller, deps);

  const group = `${nudge ? `nudge-${nudge.nudge}` : kind}:${slot.date}:${slot.stage}:${shortId()}`;
  const best = await bestFromPack(base, slot, group, nudge, deps);
  if (!best.length) {
    const pack = await readPack(base.trip.id).catch(() => null);
    if (pack?.status !== 'ready' && deps.fallback !== false && !nudge) return ideasFallback(base.trip, slot, caller, deps);
    const where = `${dayLabel(slot.date)} ${slot.stage}`;
    return {
      status: 200,
      body: { proposals: [], note: nudge ? `Nothing ${NUDGE_LABEL[nudge.nudge].toLowerCase()} from the research fits ${where}.` : `Nothing from the research fits ${where} as the day stands — ask the planner to look further.` },
    };
  }
  return store(base, best, caller);
}

/** The parts of a day a kind of place is tried in, best first, when no part was named. */
function stagesFor(p: PackPlace): DayStage[] {
  if (p.kind === 'food') return ['lunch', 'evening'];
  if (p.kind === 'cafe') return ['morning', 'afternoon', 'lunch'];
  if (p.kind === 'gelato' || p.tags.includes('evening')) return ['afternoon', 'evening'];
  return ['morning', 'afternoon', 'evening'];
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * "Add to the plan" from the research pack: that place on that day, in the
 * part of it where it fits (or the part named). When it fits, the group is
 * the place. When it does not, the note says why and the group offers the
 * place anyway if it only pushes something out, then the best alternatives
 * that do fit there.
 */
async function chosenPlaceGroup(base: Base, date: LocalDate, stage: DayStage | null, packPlaceId: string, caller: ProposalCaller, deps: ProposalDeps): Promise<Outcome & { legacy?: PlanOption[] }> {
  const found = base.pack.find((p) => p.id === packPlaceId);
  if (!found) return { status: 404, body: { error: 'That place is not in the research for this trip.' } };
  if (found.status === 'planned') return { status: 409, body: { error: `${found.name} is already in the plan.` } };
  // Asked for by name: even a place turned down before is checked again.
  const chosen: PackPlace = { ...found, status: 'candidate', rejectReason: null };
  const b: Base = { ...base, pack: base.pack.map((p) => (p.id === chosen.id ? chosen : p)) };
  const group = `fill:${date}:pick:${shortId()}`;
  let firstSlot: Slot | null = null;
  let landed: Checked | null = null;
  let why: string | null = null;
  for (const st of stage ? [stage] : stagesFor(chosen)) {
    const s = slotFor(b.latest.plan, b.state.wishes, b.state.bookings, 'fill', { date, stage: st });
    if (!s.ok) {
      if (s.status === 404) return { status: 404, body: { error: s.error } };
      continue;
    }
    firstSlot ??= s.slot;
    const reasons: string[] = [];
    const one = await checkOne(b, packDraft(chosen, s.slot, group), { trusted: true, groupId: group, slot: s.slot, deps, onDrop: (r) => reasons.push(r) });
    if (one?.verdict?.fits) return store(b, [one], caller);
    if (one && !landed) {
      landed = one;
      firstSlot = s.slot;
    }
    why ??= one?.verdict?.reason ?? reasons[0] ?? null;
  }
  if (!firstSlot) return { status: 404, body: { error: 'That day is not in the plan.' } };
  const note = `${chosen.name} does not fit ${dayLabel(date)}${why ? `: ${lowerFirst(why)}` : ' as the day stands.'}`.replace(/\.?$/, '.');
  const alternatives = await bestFromPack(b, firstSlot, group, null, deps, new Set([chosen.id]));
  const picked = [...(landed ? [landed] : []), ...alternatives].slice(0, GROUP_SIZE);
  if (!picked.length) return { status: 200, body: { proposals: [], note } };
  return store(b, picked, caller, note);
}

async function nudgeGroup(base: Base, request: ProposalRequest, caller: ProposalCaller, deps: ProposalDeps): Promise<Outcome> {
  const p = request.target.proposalId ? await getProposal(base.trip.id, request.target.proposalId) : null;
  if (!p) return { status: 404, body: { error: 'No such proposal.' } };
  if (!request.nudge) return { status: 400, body: { error: 'Say how: closer, cheaper, less-walking, quieter or more-like-this.' } };
  if (p.kind !== 'swap' && p.kind !== 'fill') return { status: 400, body: { error: 'Only a swap or a fill can be nudged.' } };
  const target: SlotTarget = p.kind === 'swap' ? { stopId: p.scope.stopId ?? p.scope.wishId, wishId: p.scope.wishId } : { date: p.scope.date, stage: p.scope.stage };
  const s = slotFor(base.latest.plan, base.state.wishes, base.state.bookings, p.kind, target);
  if (!s.ok) return { status: s.status, body: { error: s.error } };
  const ref: NudgeRef = {
    place: p.packPlaceId ? (base.pack.find((x) => x.id === p.packPlaceId) ?? null) : null,
    distanceM: p.place ? slotDistance(s.slot, p.place.location, base.state.stays[0]?.location ?? null) : null,
    walkMin: p.tradeoffs.walkMin,
  };
  // Not the one nudged, nor its open alternatives: new ones.
  const open = await listProposals(base.trip.id, { status: ['open'] }).catch(() => [] as Proposal[]);
  const exclude = new Set([p.packPlaceId, ...open.filter((x) => x.groupId === p.groupId).map((x) => x.packPlaceId)].filter((x): x is string => !!x));
  return slotGroup(base, p.kind, target, { nudge: request.nudge, ref, exclude }, caller, { ...deps, fallback: false });
}

async function dayGroup(base: Base, request: ProposalRequest, caller: ProposalCaller, deps: ProposalDeps): Promise<Outcome> {
  const date = request.target.date as LocalDate;
  const label = dayLabel(date);
  let draft: ProposalDraft;
  if (request.variant === 'lighter') {
    const r = lighterOps(base.trip, date);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    draft = { kind: 'day', title: `A lighter ${label}`, why: 'Ends earlier with the must-dos kept; nice-to-haves move to other days or drop.', ops: r.ops, group: null, scope: { date } };
  } else if (request.variant === 'rainy') {
    const r = rainyOps(base.latest.plan, base.state.wishes, base.state.bookings, base.pack, date);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    draft = {
      kind: 'day',
      title: `${label} for a rainy day`,
      why: `Swaps ${r.swaps.map((x) => `${x.out} for ${x.in}`).join(', ')}${r.kept.length ? `; keeps ${r.kept.join(', ')}` : ''}.`,
      ops: r.ops,
      group: null,
      scope: { date },
      indoor: true,
    };
  } else {
    const r = swapDaysOps(base.latest.plan, base.trip, base.state.wishes, base.state.bookings, date, request.withDate);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    draft = {
      kind: 'day',
      title: `Swap ${label} and ${dayLabel(request.withDate as LocalDate)}`,
      why: r.kept.length ? `Everything that can move changes days; ${r.kept.join(', ')} stay${r.kept.length === 1 ? 's' : ''} where ${r.kept.length === 1 ? 'it is' : 'they are'} (fixed).` : 'Everything on the two days changes places.',
      ops: r.ops,
      group: null,
      scope: { date },
    };
  }
  const one = await checkOne(base, draft, { trusted: true, groupId: `day:${date}:${request.variant}:${shortId()}`, slot: null, deps });
  if (!one) return { status: 409, body: { error: `That would not change ${label}.` } };
  const proposals = await addProposals(base.trip.id, [one.proposal], caller.email);
  return { status: 200, body: { proposals } };
}

/**
 * No research pack yet: the live ideas search (an agentic turn and the map,
 * up to a minute), as a job, its ideas checked into a group like any other.
 */
async function ideasFallback(trip: TripRecord, slot: Slot, caller: ProposalCaller, deps: ProposalDeps = {}): Promise<Outcome> {
  const ask = {
    date: slot.date,
    stage: slot.stage,
    afterStopId: slot.replaces ? slot.gap.before.stopId : null,
    beforeStopId: slot.replaces ? slot.gap.after.stopId : null,
  };
  const work = async () => {
    const r = await findIdeas(trip, ask, caller.surface, { asOwner: caller.isOwner, author: { email: caller.email, id: caller.personId ?? null } });
    const drafts: ProposalDraft[] = r.ideas
      .filter((i) => i.verdict.fits || i.verdict.pushesOut.length)
      .slice(0, GROUP_SIZE)
      .map((i) => ({
        kind: slot.kind,
        title: i.title,
        why: i.why,
        ops: [...(slot.replaces ? [{ op: 'removeWish', id: slot.replaces.wishId }] : []), { op: 'addWish', wish: i.wish }],
        group: null,
        scope: { date: slot.date, stage: slot.stage, stopId: slot.replaces?.wishId ?? null, wishId: slot.replaces?.wishId ?? null },
      }));
    // The ideas' places were found on the map by the search: trusted.
    const out = await checkDrafts(trip, drafts, { authorEmail: caller.email, group: `${slot.kind}:${slot.date}:${slot.stage}:${shortId()}`, trusted: true });
    return { proposals: out.proposals, note: out.proposals.length ? NOT_READY_NOTE : (r.note ?? 'Nothing found fits that part of the day.') };
  };
  if (deps.inline) return { status: 200, body: await work() };
  const job: TripJob = startJob(caller.email, 'ideas', work);
  return { status: 202, body: { job, note: NOT_READY_NOTE } };
}

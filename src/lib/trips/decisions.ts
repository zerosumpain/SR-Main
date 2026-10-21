// src/lib/trips/decisions.ts
//
// v8 (2026-10-21): propose, research, ask. The shapes of the planner's
// decisions, shared by the server, the site and the phone:
//
// - a PROPOSAL is a stored, checked change you see before it lands: its ops,
//   the solved difference from the plan as it stands, the trade-offs, the
//   evidence, and what became of it (accepted, turned down and why…);
// - a QUESTION is short and tapped, never typed: two to four answers plus
//   "You decide", why it is asked, and what is assumed meanwhile. It exists
//   only when its answers solve to different plans;
// - the RESEARCH PACK is the trip's places and date facts, found once when the
//   trip starts and drawn on by every proposal, swap and idea;
// - the BRIEF is what the planner knows, each fact labelled with where it came
//   from (you said / from your notes / found / assumed).
//
// Pure types, readers and small helpers — no I/O. Plan:
// ~/site-tech-debt-review-2026-09-26/2026-10-21-trip-planning-propose-and-ask-plan.md;
// wire contract: docs/superpowers/specs/2026-10-21-trips-propose-ask.md.

import type {
  DayStage,
  Facts,
  LatLng,
  LocalDate,
  Neighbourhood,
  PlaceImage,
  PlannedDay,
  TripOp,
} from './model';

export type Source = { url: string; title: string | null };

// ── The brief: what the planner knows, and where it came from ──────────────

/**
 * Where a fact came from. 'you' = said or typed by a traveller (or a direct
 * edit); 'notes' = the owner's memory, Gmail or the family roster; 'found' =
 * research, with sources; 'assumed' = the planner's working guess, shown so
 * it can be corrected — never passed off as a fact.
 */
export type FactSource = 'you' | 'notes' | 'found' | 'assumed';
export const FACT_SOURCES: readonly FactSource[] = ['you', 'notes', 'found', 'assumed'];
export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  you: 'You said',
  notes: 'From your notes',
  found: 'Found',
  assumed: 'Assumed',
};

/**
 * Stored on `trip.provenance`, keyed by what it is about: 'destination',
 * 'dates', 'pace', 'modes', 'travellers', 'meal-times', `stay:<id>`,
 * `transport:<id>`, `booking:<id>`, `wish:<id>`. A key with no entry reads as
 * 'you' for direct edits and 'assumed' for anything the planner set.
 */
export interface ProvenanceEntry {
  source: FactSource;
  /** "Airbnb booking in your notes", "Assumed: planning from the centre". */
  note: string | null;
  /** A memory id or a URL, when there is one to show. */
  ref: string | null;
  at: string;
}
export type Provenance = Record<string, ProvenanceEntry>;

export type BriefKind = 'destination' | 'dates' | 'travellers' | 'pace' | 'modes' | 'stay' | 'transport' | 'booking' | 'must' | 'preference' | 'constraint' | 'assumption';

/** One chip of the brief. */
export interface BriefItem {
  key: string;
  kind: BriefKind;
  /** Short, for a chip: "26–30 Oct", "Stay: Parione", "NCL 07:35 → FCO". */
  label: string;
  /** A longer line for the detail sheet, or null. */
  detail: string | null;
  /** Where it came from. (Named `origin` on the wire: `source` is reserved for memory, which never travels.) */
  origin: FactSource;
  /** "Airbnb booking in your notes" — the owner's site only; null on the phone for 'notes' items. */
  note: string | null;
  /** A memory id or URL — the owner's site only; null on the phone for 'notes' items. */
  ref: string | null;
  /** True when the person can change it directly (dates, who, pace, stays). */
  editable: boolean;
}

export interface TripBrief {
  items: BriefItem[];
  /** How many items are 'assumed' — the amber count. */
  assumed: number;
  /** What the planner still needs and is assuming meanwhile, in plain words. */
  missing: string[];
}

/**
 * A direct edit to the brief (site or phone, no chat). Each becomes ops with
 * source 'you'; `confirm` turns an 'assumed' or 'notes' item into 'you'.
 */
export type BriefPatch =
  | { field: 'dates'; startDate: LocalDate; endDate: LocalDate }
  | { field: 'destination'; destination: string; timeZone?: string | null }
  | { field: 'pace'; pace: 'relaxed' | 'normal' | 'packed' }
  | { field: 'modes'; modes: Array<'walk' | 'cycle' | 'drive' | 'transit' | 'taxi'> }
  | { field: 'travellers'; travellers: Array<{ name: string; age?: number | null; personId?: string | null }> }
  | { field: 'stay'; id?: string | null; name: string; placeQuery: string; fromDate: LocalDate; toDate: LocalDate }
  | { field: 'confirm'; key: string }
  | { field: 'remove'; key: string };

// ── Plan differences ───────────────────────────────────────────────────────

export type PlanChangeKind = 'added' | 'removed' | 'moved' | 'retimed' | 'dropped';

/** One structured line of "what changed", for before → after rendering. */
export interface PlanChange {
  kind: PlanChangeKind;
  wishId: string | null;
  title: string;
  /** The day it is on now (null when removed or dropped). */
  date: LocalDate | null;
  /** The day it was on before (moved / removed). */
  fromDate: LocalDate | null;
  /** Local minutes: start before and after (retimed / moved / added). */
  fromMin: number | null;
  toMin: number | null;
  /** Why it dropped, when the solver said. */
  reason: string | null;
}

export interface PlanDiff {
  /** The same plain lines the "what changed" list has always shown. */
  lines: string[];
  changes: PlanChange[];
  /** Days that changed, in date order. */
  dates: LocalDate[];
  /** Walking distance added (+) or saved (−) across the trip, metres; null when unknown. */
  walkDeltaM: number | null;
  /** Titles newly left out. */
  dropped: string[];
}

export const EMPTY_DIFF: PlanDiff = { lines: [], changes: [], dates: [], walkDeltaM: null, dropped: [] };

// ── Proposals ──────────────────────────────────────────────────────────────

/**
 * 'shape' = a whole trip; 'day' = a version of one day (lighter, rainy, swap
 * days); 'swap' = one stop for another; 'fill' = an empty slot or a meal;
 * 'fix' = a closure, booking risk or weather; 'change' = what was asked for in
 * words, ready to approve; 'replan' = on the day.
 */
export type ProposalKind = 'shape' | 'day' | 'swap' | 'fill' | 'fix' | 'change' | 'replan';
export type ProposalStatus = 'open' | 'accepted' | 'rejected' | 'superseded' | 'expired';

/** "Like this, but…": a nudge returns new alternatives from the pack. */
export type Nudge = 'closer' | 'cheaper' | 'less-walking' | 'quieter' | 'more-like-this';
export const NUDGES: readonly Nudge[] = ['closer', 'cheaper', 'less-walking', 'quieter', 'more-like-this'];
export const NUDGE_LABEL: Record<Nudge, string> = {
  closer: 'Closer',
  cheaper: 'Cheaper',
  'less-walking': 'Less walking',
  quieter: 'Quieter',
  'more-like-this': 'More like this',
};

/** Why a proposal was turned down — a preference signal, not just a dismissal. */
export type RejectReason = 'too-far' | 'too-busy' | 'not-for-us' | 'been-before' | 'other';
export const REJECT_REASONS: readonly RejectReason[] = ['too-far', 'too-busy', 'not-for-us', 'been-before', 'other'];
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  'too-far': 'Too far',
  'too-busy': 'Too busy',
  'not-for-us': 'Not for us',
  'been-before': 'Been before',
  other: 'Something else',
};

export interface ProposalScope {
  date: LocalDate | null;
  stage: DayStage | null;
  /** The planned stop it replaces or sits beside (swap / fill). */
  stopId: string | null;
  wishId: string | null;
}

export interface ProposalTradeoffs {
  /** True when it lands as intended and pushes nothing out. */
  fits: boolean;
  /** "14:10–15:10, 12 min walk in" or why it does not fit. */
  fitText: string | null;
  /** Walking added (+) or saved (−) on the days it touches, minutes. */
  walkMin: number | null;
  /** Average walking per day of the result, km (shapes). */
  walkKmPerDay: number | null;
  /** Days that start before 09:00 (shapes). */
  earlyStarts: number | null;
  /** Things in the result that need booking. */
  toBook: number | null;
  costText: string | null;
  indoor: boolean | null;
  kidFriendly: boolean | null;
  lessVisited: boolean;
  pushesOut: string[];
  moves: Array<{ title: string; from: LocalDate; to: LocalDate }>;
}

/** For a whole-trip shape: the idea, a line per day, what it leaves out. */
export interface ShapeSummary {
  headline: string;
  days: Array<{ date: LocalDate; line: string }>;
  leavesOut: string[];
}

export interface Proposal {
  id: string;
  /** Alternatives share a group; accepting one supersedes the rest. */
  groupId: string;
  kind: ProposalKind;
  title: string;
  /** One sentence: what it is and why it suits them. */
  why: string;
  scope: ProposalScope;
  /** The checked ops accepting it replays — never re-asked of a model. */
  ops: TripOp[];
  diff: PlanDiff;
  tradeoffs: ProposalTradeoffs;
  evidence: Source[];
  /** The place it adds, for the card and the map pin. */
  place: { name: string; location: LatLng } | null;
  image: PlaceImage | null;
  /** The research-pack place it draws on, when it does. */
  packPlaceId: string | null;
  shape: ShapeSummary | null;
  /** The days it changes as solved — the ghost on the map. Only those days. */
  preview: PlannedDay[];
  basedOnVersion: number | null;
  status: ProposalStatus;
  /** A turned-down proposal's reason; a superseded one's "Chose X". */
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** What a model (or the pack fast path) drafts; checked into a Proposal. */
export interface ProposalDraft {
  kind: ProposalKind;
  title: string;
  why: string;
  ops: unknown[];
  /** Drafts with the same group are alternatives to each other. */
  group: string | null;
  scope: Partial<ProposalScope>;
  packPlaceId?: string | null;
  costText?: string | null;
  indoor?: boolean | null;
  kidFriendly?: boolean | null;
  evidence?: Source[];
}

// ── Questions ──────────────────────────────────────────────────────────────

/**
 * Where a question came from: 'brief' a gap in the brief; 'tie' two versions
 * nearly equal; 'clash' the solver cannot fit everything; 'research' a
 * booking deadline, closure, weather; 'reaction' a pattern in turn-downs;
 * 'day' on the day; 'after' the trip story; 'planner' the model asked.
 */
export type QuestionSource = 'brief' | 'tie' | 'clash' | 'research' | 'reaction' | 'day' | 'after' | 'planner';
export type QuestionStatus = 'open' | 'answered' | 'skipped' | 'expired' | 'withdrawn';
/** Who it is for: the owner; any parent; the whole family (everyone answers, a parent decides). */
export type QuestionAudience = 'owner' | 'parents' | 'family';

export interface QuestionAnswer {
  id: string;
  /** Short, for a chip: "Back to the flat", "Carry on". */
  label: string;
  ops: TripOp[];
  /** A brief edit the answer makes (who, pace, dates), when it is one. */
  brief: BriefPatch | null;
  /** A lasting preference to OFFER for memory (never saved silently). */
  remember: string | null;
  /** What choosing it changes, in a line: "Wednesday afternoon: 3 stops move". Null for the assumed answer. */
  summary: string | null;
  /** How many planned stops it changes against the plan as it stands. */
  changes: number;
}

export interface Question {
  id: string;
  /** Dedupe key: the same key is never asked twice while open, nor re-asked after a skip unless it changes. */
  key: string;
  origin: QuestionSource;
  /** One line. */
  prompt: string;
  /** Why it is asked: "Changes Wednesday afternoon (3 stops)". */
  why: string;
  answers: QuestionAnswer[];
  /** The answer assumed meanwhile — "You decide" picks it. */
  defaultAnswerId: string;
  /** True when the plan already uses the default (assume-and-ask). */
  appliedDefault: boolean;
  /** "If you skip: carry on, with a long lunch." */
  ifSkipped: string;
  affects: { dates: LocalDate[]; stops: number };
  /** How much the answer matters (stops changed × urgency); higher first. */
  impact: number;
  audience: QuestionAudience;
  /** Answer by this date (a booking deadline), or null. */
  deadline: LocalDate | null;
  status: QuestionStatus;
  answerId: string | null;
  /** Display name of who answered; never an email. */
  answeredByName: string | null;
  /** Family votes so far (audience 'family'): answer id → names. */
  votes: Record<string, string[]>;
  basedOnVersion: number | null;
  createdAt: string;
  answeredAt: string | null;
}

/** What the model (or a rule) drafts; checked into a Question by solving each answer. */
export interface QuestionDraft {
  key: string;
  origin: QuestionSource;
  prompt: string;
  why: string | null;
  answers: Array<{ label: string; ops: unknown[]; brief?: BriefPatch | null; remember?: string | null }>;
  /** Index into answers of the one to assume. */
  defaultIndex: number;
  ifSkipped: string | null;
  audience?: QuestionAudience;
  deadline?: LocalDate | null;
}

/** At most this many open questions are shown at once. */
export const MAX_OPEN_QUESTIONS = 3;
/** At most one question notification a day before a trip. */
export const QUESTION_PUSHES_PER_DAY = 1;
/** Answer labels are chips that wrap (never truncate on screen): short, but a whole thought. */
export const ANSWER_LABEL_MAX = 48;
export const QUESTION_PROMPT_MAX = 120;

// ── The research pack ──────────────────────────────────────────────────────

export type PackKind =
  | 'sight'
  | 'museum'
  | 'church'
  | 'walk'
  | 'park'
  | 'viewpoint'
  | 'market'
  | 'food'
  | 'cafe'
  | 'gelato'
  | 'kids'
  | 'shop'
  | 'experience'
  | 'other';

export interface PackPlace {
  id: string;
  name: string;
  kind: PackKind;
  /** Free tags: 'rainy-day', 'evening', 'pizza', 'free', 'roman'. */
  tags: string[];
  place: { name: string; location: LatLng; osmId: string | null; address: string | null };
  /** One line: what it is and why it suits this trip. */
  why: string | null;
  neighbourhood: string | null;
  durationMin: number | null;
  indoor: boolean | null;
  kidFriendly: boolean | null;
  costText: string | null;
  /** Deliberately not one of the famous few. */
  lessVisited: boolean;
  bookingRequired: boolean | null;
  bookAheadDays: number | null;
  facts: Facts | null;
  image: PlaceImage | null;
  wikidata: string | null;
  sources: Source[];
  /** 'planned' = a wish on the trip uses it; 'rejected' = turned down (with why). */
  status: 'candidate' | 'planned' | 'rejected';
  rejectReason: RejectReason | null;
  /** The wish it became, when planned. */
  wishId: string | null;
  checkedAt: string | null;
}

export type CalendarKind = 'closure' | 'holiday' | 'event' | 'strike' | 'weather' | 'sun' | 'other';

/** A fact about the trip's dates: a closure, a holiday, an event, rain likely. */
export interface PackCalendarItem {
  date: LocalDate | null;
  kind: CalendarKind;
  text: string;
  /** The pack place it is about, when it is about one. */
  placeId: string | null;
  sources: Source[];
}

export type PackStatus = 'none' | 'building' | 'ready' | 'failed';

/** Stored on `trip.pack`: the pack's state and its date facts (places are rows). */
export interface PackSummary {
  status: PackStatus;
  /** The stage being worked on while building, in plain words. */
  stage: string | null;
  builtAt: string | null;
  /** The week-before refresh. */
  refreshedAt: string | null;
  counts: { places: number; food: number; toBook: number; lessVisited: number; rainy: number };
  calendar: PackCalendarItem[];
  neighbourhoods: Neighbourhood[];
  /** The progress card's lines: "Found 38 places", "3 need booking — …". */
  highlights: string[];
  /**
   * Where the pack looked from: the stay, or with no stay the middle of the
   * city's best-known sights. A trip with no stay is planned from here (a
   * stand-in stay, never stored — ./centre-stay).
   */
  centre?: LatLng | null;
}

export const EMPTY_PACK: PackSummary = {
  status: 'none',
  stage: null,
  builtAt: null,
  refreshedAt: null,
  counts: { places: 0, food: 0, toBook: 0, lessVisited: 0, rainy: 0 },
  calendar: [],
  neighbourhoods: [],
  highlights: [],
};

// ── From your notes: what memory already holds, offered at the start ──────

export interface NoteFact {
  id: string;
  kind: 'stay' | 'transport' | 'booking' | 'traveller' | 'preference';
  /** "Flights NCL 07:35 → FCO, back 10:40 Fri". */
  label: string;
  detail: string | null;
  /** The ops confirming it applies (source 'notes'). */
  ops: TripOp[];
  ref: string | null;
}

// ── Starting a trip (guided) ───────────────────────────────────────────────

export interface TripStart {
  destination: string;
  startDate: LocalDate;
  endDate: LocalDate;
  travellers: Array<{ name: string; age: number | null; personId: string | null }>;
  pace: 'relaxed' | 'normal' | 'packed';
  /** NoteFact ids the person confirmed. */
  confirmNotes: string[];
  /** Anything they typed as well ("we love food markets"). */
  text: string | null;
}

// ── Durable jobs ───────────────────────────────────────────────────────────

export type JobStageState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

/** One line of a job's progress card. */
export interface JobStage {
  key: string;
  /** "Finding places", "Checking opening hours on your dates". */
  label: string;
  state: JobStageState;
  /** "Found 38 places", "3 need booking — Colosseum underground about 14 days ahead". */
  detail: string | null;
}

// ── The planner's answer (v8) ──────────────────────────────────────────────

/**
 * v8: one turn's answer. The planner ACTS (small, clear, reversible ops),
 * PROPOSES (alternatives or a large change to approve) or ASKS (a question
 * card with the assumption already applied). A reply that talks about ideas or
 * changes must carry them as ops or proposals (`./decisions` `emptyPromise`).
 */
export interface PlannerAnswerV8 {
  reply: string;
  ops: unknown[];
  proposals: ProposalDraft[];
  questions: QuestionDraft[];
  quickReplies: string[];
}

// ── Readers (lenient: a bad draft is dropped, never thrown) ────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const isDate = (v: unknown): v is LocalDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const STAGES: readonly DayStage[] = ['morning', 'lunch', 'afternoon', 'evening'];
const PROPOSAL_KINDS: readonly ProposalKind[] = ['shape', 'day', 'swap', 'fill', 'fix', 'change', 'replan'];
const QUESTION_SOURCES: readonly QuestionSource[] = ['brief', 'tie', 'clash', 'research', 'reaction', 'day', 'after', 'planner'];
const AUDIENCES: readonly QuestionAudience[] = ['owner', 'parents', 'family'];

function readSources(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((s) => ({ url: str(s.url, 500), title: str(s.title, 200) }))
    .filter((s): s is Source => !!s.url && /^https?:\/\//.test(s.url))
    .slice(0, 6);
}

function readScope(v: unknown): Partial<ProposalScope> {
  const o = isObj(v) ? v : {};
  return {
    date: isDate(o.date) ? o.date : null,
    stage: STAGES.includes(o.stage as DayStage) ? (o.stage as DayStage) : null,
    stopId: str(o.stopId, 120),
    wishId: str(o.wishId, 80),
  };
}

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** A model's proposal drafts: at most 6, each with a title and at least one op. */
export function readProposalDrafts(raw: unknown): ProposalDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalDraft[] = [];
  for (const p of raw) {
    if (!isObj(p)) continue;
    const title = str(p.title, 120);
    const ops = Array.isArray(p.ops) ? p.ops.filter(isObj).slice(0, 12) : [];
    if (!title || !ops.length) continue;
    out.push({
      kind: PROPOSAL_KINDS.includes(p.kind as ProposalKind) ? (p.kind as ProposalKind) : 'change',
      title,
      why: str(p.why, 300) ?? '',
      ops,
      group: str(p.group, 60),
      scope: readScope(p.scope),
      packPlaceId: str(p.packPlaceId, 80),
      costText: str(p.costText, 60),
      indoor: bool(p.indoor),
      kidFriendly: bool(p.kidFriendly),
      evidence: readSources(p.evidence),
    });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * A model's question drafts: at most 3, each with 2–4 answers whose labels
 * are short, and a default that exists. Anything else is dropped.
 */
export function readQuestionDrafts(raw: unknown): QuestionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionDraft[] = [];
  for (const q of raw) {
    if (!isObj(q)) continue;
    const prompt = str(q.prompt, QUESTION_PROMPT_MAX);
    const answers = (Array.isArray(q.answers) ? q.answers : [])
      .filter(isObj)
      .map((a) => ({
        label: str(a.label, ANSWER_LABEL_MAX),
        ops: Array.isArray(a.ops) ? a.ops.filter(isObj).slice(0, 12) : [],
        remember: str(a.remember, 200),
      }))
      .filter((a): a is { label: string; ops: Obj[]; remember: string | null } => !!a.label)
      .slice(0, 4);
    if (!prompt || answers.length < 2) continue;
    const di = Number(q.defaultIndex);
    out.push({
      key: str(q.key, 80) ?? `planner:${prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      origin: QUESTION_SOURCES.includes(q.origin as QuestionSource) ? (q.origin as QuestionSource) : 'planner',
      prompt,
      why: str(q.why, 160),
      answers,
      defaultIndex: Number.isInteger(di) && di >= 0 && di < answers.length ? di : 0,
      ifSkipped: str(q.ifSkipped, 160),
      audience: AUDIENCES.includes(q.audience as QuestionAudience) ? (q.audience as QuestionAudience) : 'owner',
      deadline: isDate(q.deadline) ? q.deadline : null,
    });
    if (out.length >= MAX_OPEN_QUESTIONS) break;
  }
  return out;
}

/**
 * The guard against Darlington's "I've added a few ideas" with nothing added:
 * true when a reply talks about adding, suggesting or planning places but the
 * turn carries no ops and no proposals. The caller then turns the reply's
 * ideas into proposals (or says plainly that nothing was changed).
 */
export function emptyPromise(reply: string, carried: { ops: number; proposals: number; questions: number }): boolean {
  if (carried.ops || carried.proposals) return false;
  const promises = /\b(i[’']?ve (added|put|planned|organised|organized|included|scheduled|slotted)|here are (a few|some|three|two|\d+)|i (have )?(added|suggest)|options? (for|near)|pick one|ideas?:)/i;
  return promises.test(reply);
}

/** A stable id for an answer of a question: `a0`…`a3`. */
export const answerId = (i: number) => `a${i}`;

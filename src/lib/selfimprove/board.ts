// src/lib/selfimprove/board.ts
//
// The queue, as a board.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// Read off production on 2026-09-04: `improvement_backlog` held **455 rows,
// 352 of them open and 302 never once attempted**. August took 291 ideas in and
// let roughly 45 out — 6.4 to 1 — so the pile grows on a night the engine works
// perfectly. And `pickWork` ranks on `priority`, where **280 of the 352 open
// items sat at 2**: the ordering that decides what gets built tonight was, in
// practice, arbitrary.
//
// The room showed all of that as a single rollup cell reading "Ideas queued".
// There was no surface on which a person could see one item, let alone move it.
//
// ── Why it is PURE ──────────────────────────────────────────────────────────
//
// A `.svelte` file may import this. That rules out `./types` and `./backlog` as
// VALUE imports — both reach `$lib/datastore` and a page module that does fails
// the BUILD, not the type-check. So: types come in through `import type` (which
// is erased), and the one constant this module needs from `backlog.ts`, the
// attempt ceiling, is INJECTED on the input rather than copied. Two copies of
// that number is how the board and the engine start disagreeing about what
// "out of attempts" means.
//
// `narrative.ts` is genuinely pure (its only imports are type-only), which is
// why `findRelatedIdea` and `looksSameSubject` can be reused here. They are
// reused rather than reimplemented on purpose: a second definition of "related"
// is the exact bug that left every driver unrecorded for a fortnight.

import { findRelatedIdea, looksSameSubject, type ToolHealth } from './narrative';
import type { BacklogGroomingData, BacklogItemData } from './types';

// ---------------------------------------------------------------------------
// The intake channels
// ---------------------------------------------------------------------------

/**
 * Which channel an idea arrived through.
 *
 * Declared HERE rather than in `types.ts` for the reason at the top of this
 * file: a `.svelte` needs these as VALUES, and `types.ts` value-imports
 * `$lib/toolpolicy/policy`, which reaches `$lib/db` and `$env/dynamic/private`.
 * Importing it for real fails the BUILD while `svelte-check` passes clean —
 * which is exactly what happened when this list started life over there.
 * `WORK_LANES` and `WORK_STAGES` live here for the same reason.
 *
 * A CLOSED set, stamped by the call site and never by a model. `coercePlan`
 * whitelists the fields it reads out of the author's JSON, so an idea cannot
 * arrive claiming its own provenance; `coerceSource` in `backlog.ts` is the
 * second lock.
 *
 * `unattributed` is load-bearing and permanent: 455 rows already existed when
 * this was added and there is no way to recover which channel any of them came
 * through. Guessing would be worse than saying so — the rule `driverSource`
 * follows, where a driver that could not be established reads `unknown` rather
 * than inventing a plausible one.
 */
export const IDEA_SOURCES = [
  /** Added directly by the owner from the backlog room. */
  'owner',
  /** Mined from the questions the owner actually asked. */
  'question',
  /** A `daydream_faults` row: daydreaming tried something and could not. */
  'fault',
  /** A workflow-doctor finding that needed repo code, escalated as a fault. */
  'doctor',
  /** A measurement nothing writes — a hypothesis with zero pairs. */
  'starved',
  /** A shipped tool erroring or never being called. */
  'health',
  /** The appetite ledger: a capability the site has never had. */
  'appetite',
  /** The engine's own proposal about itself. Never built by a lane. */
  'engine',
  /** The toolsmith's own idea, had while authoring something else. */
  'toolsmith',
  /** A chat turn the owner analysed and sent to the engine. */
  'trace',
  /** Queued before this field existed. Never a guess. */
  'unattributed',
] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------

export const WORK_STAGES = [
  'proposed',
  'accepted',
  'building',
  'verifying',
  'live',
  'parked',
] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

/** Tone vocabulary of the daydream hub, restated as a literal union so this
 *  module does not have to import `$lib/daydream` to name a colour. */
export type BoardTone = 'urgent' | 'action' | 'watch' | 'good' | 'steady' | 'quiet';

export interface StageMeta {
  label: string;
  /** The question the column answers, shown under its heading. */
  question: string;
  tone: BoardTone;
}

export const STAGE_META: Readonly<Record<WorkStage, StageMeta>> = {
  proposed: { label: 'Proposed', question: 'nobody has ruled', tone: 'action' },
  accepted: { label: 'Accepted', question: 'waiting for a slot', tone: 'steady' },
  building: { label: 'In build', question: 'a lane is on it', tone: 'watch' },
  verifying: { label: 'Verifying', question: 'exists, unproven', tone: 'watch' },
  live: { label: 'Live', question: 'used at least once', tone: 'good' },
  parked: { label: 'Parked', question: 'declined or folded', tone: 'quiet' },
};

/**
 * Which drags the board accepts.
 *
 * Nothing may be dragged INTO `live`: a tool becomes live when jkai calls it,
 * and a board that let a person assert that would be a board that lies. Nothing
 * may be dragged into `building` or `verifying` either — those stages are
 * consequences of an attempt, not intentions.
 *
 * And nothing may be dragged OUT of `live` or `verifying`. Parking writes
 * `status: 'abandoned'`, which on a shipped row would erase the only field
 * saying it shipped — and dragging it back would then write `open`, putting an
 * already-built tool back in front of `pickWork` to be built a second time.
 * There is nothing to gain either: a shipped row already stops `addIdeas`
 * re-proposing the idea, because existence is checked by key.
 */
export const LEGAL_MOVES: Readonly<Record<WorkStage, ReadonlyArray<WorkStage>>> = {
  proposed: ['accepted', 'parked'],
  accepted: ['parked'],
  building: ['parked'],
  verifying: [],
  live: [],
  parked: ['accepted'],
};

/** A channel this build does not know about is a gap in the record, not a
 *  tenth channel. Mirrors `coerceSource` on the write path. */
export function coerceIntake(source: unknown): IdeaSource {
  return IDEA_SOURCES.includes(source as IdeaSource) ? (source as IdeaSource) : 'unattributed';
}

export function canMove(from: WorkStage, to: WorkStage): boolean {
  return from !== to && (LEGAL_MOVES[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// The lanes
// ---------------------------------------------------------------------------

export const WORK_LANES = ['toolsmith', 'build', 'catalogue', 'monitor', 'engine'] as const;
export type WorkLane = (typeof WORK_LANES)[number];

/**
 * Which builder takes a backlog item.
 *
 * Mirrors `laneFor` in `$lib/daydream/appetite/spec.ts` for the capability
 * kinds, and extends it to the two backlog-only kinds. Kept here rather than
 * imported because the two vocabularies are not the same set — `engine` is a
 * backlog kind with no lane at all, and pretending it maps onto `feature`
 * would queue work no builder can do.
 */
export function laneForKind(kind: string): WorkLane {
  switch (kind) {
    case 'source':
    case 'data_source':
      return 'catalogue';
    case 'watch':
      return 'monitor';
    case 'feature':
    case 'news_source':
      return 'build';
    case 'engine':
      return 'engine';
    case 'tool':
    default:
      return 'toolsmith';
  }
}

/** Lanes whose output brings new data into the building — the 2026-09-04 bias,
 *  restated for display. The arithmetic half lives in `pickToolWork`. */
export function bringsNewData(kind: string): boolean {
  return kind === 'source' || kind === 'data_source' || kind === 'watch' || kind === 'news_source';
}

// ---------------------------------------------------------------------------
// The item
// ---------------------------------------------------------------------------

/**
 * What each intake channel is called on screen, and the one line saying where
 * it comes from. Here rather than in `types.ts` because this module is the
 * pure, `.svelte`-importable one — and because these are presentation, whereas
 * the closed set they key off is data.
 */
export const SOURCE_LABEL: Readonly<Record<IdeaSource, { label: string; from: string }>> = {
  owner: { label: 'Added by you', from: 'entered directly in the backlog room' },
  question: { label: 'Questions you asked', from: 'unmet needs and under-served intents' },
  fault: { label: 'Faults raised', from: 'daydreaming tried and could not' },
  doctor: { label: 'Doctor escalations', from: 'a broken canvas needing repo code' },
  starved: { label: 'Starved measurements', from: 'a metric nothing writes' },
  health: { label: 'Tool health', from: 'shipped tools erroring or never called' },
  appetite: { label: 'Inventory gaps', from: 'a capability the site has never had' },
  engine: { label: 'About the engine', from: 'its own proposals, never built by a lane' },
  toolsmith: { label: 'The toolsmith', from: 'asides had while authoring' },
  trace: { label: 'A turn you sent', from: 'a chat trace analysed by hand' },
  unattributed: { label: 'Before this was recorded', from: 'queued before the channel was stamped' },
};

/** The editable backlog kinds. Kept in the pure board module because the
 * browser form needs the values without importing the datastore-backed types. */
export const BACKLOG_KINDS = ['tool', 'feature', 'source', 'watch', 'engine'] as const;
export type BacklogKind = (typeof BACKLOG_KINDS)[number];

/**
 * What each kind is called on screen, and the one line saying what it costs.
 *
 * The KIND is the category a person thinks in ("show me the data sources"),
 * and it is not the same set as the LANE: `feature` and `news_source` both
 * run in the `build` lane, so filtering by lane cannot ask for features
 * alone. Both filters exist because both questions get asked.
 */
export const KIND_META: Readonly<Record<BacklogKind, { label: string; cost: string }>> = {
  tool: { label: 'Tool', cost: 'authored and smoke-tested in one night' },
  feature: { label: 'Feature', cost: 'a repo build — the expensive lane' },
  source: { label: 'Source', cost: 'catalogued and probed; brings new data' },
  watch: { label: 'Watch', cost: 'one workflow on a schedule' },
  engine: { label: 'Engine', cost: 'about Daydream itself; never auto-built' },
};

/** A kind this build does not know about is shown as itself rather than
 *  relabelled — the same rule the intake channel follows. */
export function kindLabel(kind: string): string {
  return KIND_META[kind as BacklogKind]?.label ?? kind;
}

export interface WorkItem {
  /** Unique across both sources — `backlog:<slug>` or `capability:<slug>`. */
  id: string;
  source: 'backlog' | 'capability';
  slug: string;
  title: string;
  detail: string;
  /** Accepted structured brief, when the item has been groomed. */
  grooming: BacklogGroomingData | null;
  kind: string;
  lane: WorkLane;
  stage: WorkStage;
  /**
   * The row's own `status`, carried through rather than inferred back out of
   * `stage`.
   *
   * `stageFor` maps a `shipped` row to `verifying` whenever its tool has never
   * been called — which is the NORMAL case here, 32 of 79 tools — so
   * `stage === 'live'` is not "this shipped". A caller that used it as one
   * counted four shipped-but-uncalled tools as open work and dropped the
   * "already shipped on this theme" line, suppressing the exact finding the
   * room exists to show. `null` on a capability lead, which has no backlog row.
   */
  backlogStatus: 'open' | 'shipped' | 'abandoned' | null;
  priority: number;
  attempts: number;
  attemptCeiling: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  /** The thing itself, when there is one: a tool name, a PR, a monitor. */
  artifact: string | null;
  artifactHref: string | null;
  /** Lifetime calls and error rate of the tool this became, when known. */
  calls: number | null;
  errorRate: number | null;
  newData: boolean;
  /** A shipped sibling looks to cover this already. */
  alreadyServed: boolean;
  servedBy: string | null;
  mergedBrief?: string;
  foldedCount: number;
  foldedInto: string | null;
  parkedReason: string | null;
  epicSlug: string | null;
  epicLabel: string;
  capabilitySlug: string | null;
  /**
   * Which channel it arrived through.
   *
   * NOT `source`, which is already taken and means which LEDGER this row is
   * from — `backlog` or `capability`. Two different questions, and reusing the
   * name silently overwrote the older one.
   *
   * `unattributed` for rows queued before the stamp existed; `null` for a
   * capability lead, which IS a channel rather than something arriving through
   * one.
   */
  intake: IdeaSource | null;
  /** Capability leads only. */
  score: number | null;
  evidence: string[];
  /** How many notes a person has left on it, and when the last one landed.
   *  The count rather than the notes: a card renders a number, and shipping
   *  every note body to the browser would add the one field on the record
   *  with no length bound per item. The editor loads them from `grooming`'s
   *  sibling field on the record it already has. */
  noteCount: number;
  lastNoteAt: string | null;
  /** When it actually settled, or null while it is open. `undefined` on the
   *  record means it settled before the field existed — see `settleDate`. */
  settledAt: string | null;
  /** Whether the owner may reprioritise / move / park it from the board.
   *  Capability leads are ruled on the appetite board, which carries their
   *  evidence and score decomposition, so the board does not duplicate that. */
  actionable: boolean;
}

/** What a capability lead looks like to this module. Structural, so the pure
 *  half of `$lib/daydream/appetite/view` need not be imported. */
export interface BoardCapability {
  slug: string;
  kind: string;
  title: string;
  need: string;
  status: string;
  score: number;
  lane: string | null;
  outcome: string | null;
  outcomeRef: string | null;
  backlogSlug: string | null;
  evidence: string[];
  lastSeenAt: string;
}

export interface BoardInput {
  backlog: BacklogItemData[];
  capabilities: BoardCapability[];
  tools: ToolHealth[];
  /** `MAX_ATTEMPTS` from `backlog.ts`. Injected, never copied. */
  attemptCeiling: number;
  /**
   * Theme slug → the label the owner accepted, so a swimlane reads
   * "Live OpenRouter balance" rather than the slug's digest. Absent for an
   * item grouped by `capabilitySlug` alone, which falls back to prettifying
   * the slug — honest, because that IS all that is recorded for one.
   */
  epicLabels?: Readonly<Record<string, string>>;
  /**
   * How many settled items to carry. The open pile is the point of the board;
   * every item ever shipped is history and belongs in the ledger. `null` keeps
   * everything, which is what the tests do.
   */
  settledLimit?: number | null;
  /** Days of burndown to reconstruct. Defaults to `DEFAULT_BURNDOWN_DAYS`. */
  burndownDays?: number;
  /** Injected so a test can fix the clock. */
  now?: number;
}

/**
 * Three months of daily points.
 *
 * Long enough for a trend to be a trend, and the chart narrows it further
 * from the client — 90 numbers is nothing on a payload already measured in
 * hundreds of kilobytes, and slicing an array the browser already has beats a
 * round trip for a control somebody will press three times.
 */
export const DEFAULT_BURNDOWN_DAYS = 90;

/** The ranges the chart offers. Descending, longest first. */
export const BURNDOWN_RANGES = [90, 60, 30] as const;

export interface BoardTotals {
  all: number;
  open: number;
  untried: number;
  settled: number;
  alreadyServed: number;
  newData: number;
  /** Open items sharing the single most common priority — the measure of
   *  whether `priority` is doing any sorting at all. */
  tiedOnPriority: number;
  tiedPriority: number | null;
  /** Live tools that have never been called. */
  neverCalled: number;
}

export interface BoardView {
  items: WorkItem[];
  /**
   * Where the queue came from, computed over the WHOLE population.
   *
   * On the view rather than derived in the component, for the reason `totals`
   * is: `trimSettled` drops settled rows past the cap, so anything counted
   * after the trim describes a smaller set than it names. `channel.total`
   * would have printed "everything ever queued through this channel" off a
   * list missing most of the settled ones, and `drained` would have saturated
   * at the cap — making the published ratio read worse than reality.
   */
  inflow: InflowView;
  /** Stage counts over the WHOLE population, so a filtered column can say what
   *  it is hiding. The component counts the visible rows itself. */
  counts: Record<WorkStage, number>;
  totals: BoardTotals;
  /** The standing queue over time. On the view for the same reason `inflow` and
   *  `totals` are: it is computed before `trimSettled`, and a curve drawn after
   *  the trim is missing exactly the settled rows that make it slope. */
  burndown: BurndownView;
  error: string | null;
}

/** An empty burndown, for the failed-read path. Same reason `EMPTY_BOARD`
 *  exists: a strip drawn over a failure must not print measured zeros. */
export const EMPTY_BURNDOWN: BurndownView = {
  windowDays: 0,
  days: [],
  openNow: 0,
  openThen: 0,
  addedPerWeek: 0,
  settledPerWeek: 0,
  netPerWeek: 0,
  outlook: 'level',
  daysToClear: null,
  dated: { recorded: 0, inferred: 0 },
  truncated: false,
};

export const EMPTY_BOARD: BoardView = {
  items: [],
  inflow: {
    windowDays: 30,
    channels: [],
    intake: 0,
    drained: 0,
    standing: 0,
    ratio: null,
    unattributed: 0,
  },
  counts: { proposed: 0, accepted: 0, building: 0, verifying: 0, live: 0, parked: 0 },
  burndown: EMPTY_BURNDOWN,
  totals: {
    all: 0,
    open: 0,
    untried: 0,
    settled: 0,
    alreadyServed: 0,
    newData: 0,
    tiedOnPriority: 0,
    tiedPriority: null,
    neverCalled: 0,
  },
  error: null,
};

// ---------------------------------------------------------------------------
// Stage derivation
// ---------------------------------------------------------------------------

export interface StageContext {
  attemptCeiling: number;
  /** The tool this item became, when one can be identified. */
  tool?: ToolHealth | null;
}

/**
 * Which stage a backlog item is in. Derived, never stored.
 *
 * The interesting one is `verifying`, which is new and is most of the reason
 * the board is worth building: **32 of 79 custom tools are shipped, enabled and
 * have never been called**. Before this they were indistinguishable from the
 * ones doing work — `shipped` was the end of the line.
 */
export function stageFor(item: BacklogItemData, ctx: StageContext): WorkStage {
  if (item.foldedInto) return 'parked';
  if (item.status === 'abandoned') return 'parked';

  if (item.status === 'shipped') {
    if (ctx.tool) return ctx.tool.runCount > 0 ? 'live' : 'verifying';
    // A `feature` item's artifact is a PR. The engine opens drafts and never
    // merges, so an item with a PR url has produced something a human still has
    // to read — unproven, by definition.
    if (item.prUrl) return 'verifying';
    return 'live';
  }

  // open
  if (item.attempts >= ctx.attemptCeiling) return 'parked';
  if (item.attempts > 0) return 'building';
  return 'accepted';
}

/** Which stage a capability lead is in. The ledger's own vocabulary, mapped. */
export function stageForCapability(status: string): WorkStage {
  switch (status) {
    case 'proposed':
      return 'proposed';
    case 'queued':
      return 'accepted';
    case 'building':
      return 'building';
    case 'shipped':
      return 'live';
    case 'declined':
    default:
      return 'parked';
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Where an outcome reference points, when its shape says. Mirrors
 *  `outcomeHrefFor` in the appetite view for the two refs both can carry. */
export function artifactHref(ref: string | null): string | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.startsWith('build:')) return `/jkai/builds/${ref.slice('build:'.length)}`;
  if (ref.startsWith('monitor:')) return '/jkai/daydreams/watches';
  return null;
}

/** A settled item is one nothing is going to happen to on its own. */
function isSettled(stage: WorkStage): boolean {
  return stage === 'live' || stage === 'parked';
}

function epicLabelFor(slug: string | null, labels: Readonly<Record<string, string>>): string {
  if (!slug) return 'Unfiled';
  const named = labels[slug];
  if (named) return named;
  // No recorded label — prettify the slug rather than invent a name for it.
  // An `epic:` slug carries only a member count and a digest, so this reads as
  // an id, which is what it is.
  return slug
    .replace(/^(cap|epic):/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Build the board.
 *
 * Deterministic and side-effect free, so the whole derivation is testable
 * without a database — the rule `narrative.ts` set for this engine's read
 * models and the reason its faults were ever findable.
 */
export function buildBoard(input: BoardInput): BoardView {
  const ceiling = input.attemptCeiling;
  const backlog = input.backlog ?? [];
  // Removal keeps a tombstone in the datastore so a nightly proposal cannot
  // resurrect the same slug. It is intentionally absent from every board
  // count and card, while still participating in the claimed-capability check
  // below so its appetite lead does not reappear under a second identity.
  const visibleBacklog = backlog.filter((b) => !b.removedAt);
  const tools = input.tools ?? [];
  const epicLabels = input.epicLabels ?? {};

  // Tools by the idea they serve. `findRelatedIdea` is the ONE definition of
  // "related" in this engine; matching a tool to an idea any other way is how
  // the driver link silently died for a fortnight.
  //
  // Candidates are the SHIPPED rows only. Searching the whole backlog let a
  // never-attempted open idea that shares two content words with
  // `reverse_geocode` claim it — rendering "706 calls · 63% errors" on work
  // nothing has built — and, because first match wins, it consumed the tool so
  // the genuinely shipped sibling fell through to `live` instead of
  // `verifying`. That is the "shipped, never called" figure this whole board
  // exists to expose, rounding itself toward the optimistic answer.
  const shipped = visibleBacklog.filter((b) => b.status === 'shipped');
  const toolForSlug = new Map<string, ToolHealth>();
  for (const t of tools) {
    const idea = findRelatedIdea(`${t.name.replace(/_/g, ' ')} ${t.description ?? ''}`, shipped);
    // First match wins: a repair ships a second attempt against the same idea,
    // and the tool list is ordered by run count, so the winner is the one
    // actually being used.
    if (idea && !toolForSlug.has(idea.slug)) toolForSlug.set(idea.slug, t);
  }

  // Ideas that something already shipped appears to cover. Compared TITLE to
  // TITLE — the details are the model's long prose and inflate the overlap
  // past anything the three-word threshold was calibrated against.
  const servedBy = new Map<string, string>();
  for (const item of visibleBacklog) {
    if (item.status !== 'open') continue;
    const match = shipped.find((s) => looksSameSubject(item.title, s.title));
    if (match) servedBy.set(item.slug, match.title);
  }

  const items: WorkItem[] = [];

  for (const b of visibleBacklog) {
    const tool = toolForSlug.get(b.slug) ?? null;
    const stage = stageFor(b, { attemptCeiling: ceiling, tool });
    const served = servedBy.get(b.slug) ?? null;
    const epicSlug = b.epicSlug ?? (b.capabilitySlug ? `cap:${b.capabilitySlug}` : null);
    items.push({
      id: `backlog:${b.slug}`,
      source: 'backlog',
      slug: b.slug,
      title: b.title,
      detail: b.detail ?? '',
      grooming: b.grooming ?? null,
      kind: b.kind,
      lane: laneForKind(b.kind),
      stage,
      backlogStatus: b.status,
      priority: b.priority,
      attempts: b.attempts,
      attemptCeiling: ceiling,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      lastError: b.lastError ?? null,
      artifact: tool ? tool.name : (b.prUrl ?? null),
      artifactHref: artifactHref(b.prUrl ?? null),
      calls: tool ? tool.runCount : null,
      errorRate: tool && tool.runCount > 0 ? tool.errorCount / tool.runCount : null,
      newData: bringsNewData(b.kind),
      alreadyServed: served != null,
      servedBy: served,
      mergedBrief: b.mergedBrief,
      foldedCount: b.foldedCount ?? 0,
      foldedInto: b.foldedInto ?? null,
      parkedReason: b.parkedReason ?? null,
      epicSlug,
      epicLabel: epicLabelFor(epicSlug, epicLabels),
      capabilitySlug: b.capabilitySlug ?? null,
      // Coerced on READ as well as on write. `coerceSource` in `backlog.ts`
      // guards what this engine writes; a row edited by hand, restored from a
      // dump, or left behind by a renamed channel would otherwise carry a
      // value matching no cell — counted in the totals, shown in no channel,
      // and unreachable by the filter, so the cells stopped summing.
      intake: coerceIntake(b.source),
      score: null,
      evidence: [],
      noteCount: b.notes?.length ?? 0,
      lastNoteAt: b.notes?.length ? (b.notes[b.notes.length - 1].at ?? null) : null,
      settledAt: b.status === 'open' ? null : (b.settledAt ?? null),
      actionable: true,
    });
  }

  // Capability leads that have not yet become a backlog item. One that HAS is
  // already on the board as its backlog row; showing both would double-count
  // the same work, which is the failure the whole join exists to avoid.
  const backlogSlugs = new Set(backlog.map((b) => b.slug));
  const claimed = new Set(
    backlog.map((b) => b.capabilitySlug).filter((s): s is string => Boolean(s)),
  );
  for (const c of input.capabilities ?? []) {
    if (claimed.has(c.slug)) continue;
    if (c.backlogSlug && backlogSlugs.has(c.backlogSlug)) continue;
    items.push({
      id: `capability:${c.slug}`,
      source: 'capability',
      slug: c.slug,
      title: c.title,
      detail: c.need,
      grooming: null,
      kind: c.kind,
      lane: laneForKind(c.kind),
      stage: stageForCapability(c.status),
      backlogStatus: null,
      priority: 3,
      attempts: 0,
      attemptCeiling: ceiling,
      createdAt: c.lastSeenAt,
      updatedAt: c.lastSeenAt,
      lastError: null,
      artifact: c.outcomeRef,
      artifactHref: artifactHref(c.outcomeRef),
      calls: null,
      errorRate: null,
      newData: bringsNewData(c.kind),
      alreadyServed: false,
      servedBy: null,
      foldedCount: 0,
      foldedInto: null,
      parkedReason: null,
      epicSlug: `cap:${c.slug}`,
      epicLabel: epicLabelFor(`cap:${c.slug}`, epicLabels),
      capabilitySlug: c.slug,
      intake: null,
      score: c.score,
      evidence: c.evidence ?? [],
      noteCount: 0,
      lastNoteAt: null,
      settledAt: null,
      actionable: false,
    });
  }

  // Totals are computed over EVERYTHING before any trim, so a number on the
  // page can never describe a smaller population than the one it names.
  // Every one of these runs over the FULL population, before the trim below.
  const totals = summarise(items);
  const counts = countByStage(items);
  const now = input.now ?? Date.now();
  const inflow = summariseInflow(items, 30, now);
  const burndown = summariseBurndown(items, input.burndownDays ?? DEFAULT_BURNDOWN_DAYS, now);

  const trimmed = trimSettled(items, input.settledLimit ?? null);

  return { items: trimmed, counts, totals, inflow, burndown, error: null };
}

/** Newest settled work first, capped. Open work is never trimmed. */
function trimSettled(items: WorkItem[], limit: number | null): WorkItem[] {
  if (limit == null) return sortForBoard(items);
  const open = items.filter((i) => !isSettled(i.stage));
  const settled = items
    .filter((i) => isSettled(i.stage))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, limit);
  return sortForBoard([...open, ...settled]);
}

/**
 * The order a column reads in: what needs a decision first.
 *
 * Priority leads because that is what `pickWork` ranks on and what the stepper
 * changes. A duplicate sorts above a fresh idea at the same priority — closing
 * one out is worth more than starting another, which is the whole finding.
 */
export function sortForBoard(items: WorkItem[]): WorkItem[] {
  return [...items].sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(b.alreadyServed) - Number(a.alreadyServed) ||
      b.attempts - a.attempts ||
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  );
}

/**
 * The orders a person grooming the queue actually wants.
 *
 * `queue` is `sortForBoard` — what the engine will reach for next, and the
 * default everywhere. The rest exist because the board's own order answers one
 * question and a grooming session asks others: what arrived last, what has been
 * sitting longest, what keeps failing, what is nearly ready to hand over.
 */
export const SORT_MODES = ['queue', 'newest', 'oldest', 'attempts', 'readiness', 'notes'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_META: Readonly<Record<SortMode, string>> = {
  queue: 'pick order',
  newest: 'newest first',
  oldest: 'longest waiting',
  attempts: 'most attempts',
  readiness: 'best groomed',
  notes: 'most discussed',
};

/** 0 when an item has no brief, so `readiness` sorts the ungroomed last
 *  rather than mixing them through the middle on a missing field. */
export function readinessScore(i: WorkItem): number {
  return i.grooming?.readiness.score ?? 0;
}

function byDate(a: string | null | undefined, b: string | null | undefined): number {
  return (b ?? '').localeCompare(a ?? '');
}

/**
 * One of the orders above. Never mutates its input — the board and the list
 * render the same array and a sort in place would reorder the other one.
 */
export function sortItems(items: WorkItem[], mode: SortMode): WorkItem[] {
  if (mode === 'queue') return sortForBoard(items);
  const copy = [...items];
  switch (mode) {
    case 'newest':
      return copy.sort((a, b) => byDate(a.createdAt, b.createdAt));
    case 'oldest':
      return copy.sort((a, b) => byDate(b.createdAt, a.createdAt));
    case 'attempts':
      return copy.sort((a, b) => b.attempts - a.attempts || a.priority - b.priority);
    case 'readiness':
      return copy.sort((a, b) => readinessScore(b) - readinessScore(a) || a.priority - b.priority);
    case 'notes':
      return copy.sort((a, b) => b.noteCount - a.noteCount || byDate(a.lastNoteAt, b.lastNoteAt));
    default:
      return copy;
  }
}

export function countByStage(items: WorkItem[]): Record<WorkStage, number> {
  const counts = { proposed: 0, accepted: 0, building: 0, verifying: 0, live: 0, parked: 0 };
  for (const i of items) counts[i.stage] += 1;
  return counts;
}

export function summarise(items: WorkItem[]): BoardTotals {
  const open = items.filter((i) => !isSettled(i.stage));
  const byPriority = new Map<number, number>();
  for (const i of open) byPriority.set(i.priority, (byPriority.get(i.priority) ?? 0) + 1);
  let tiedPriority: number | null = null;
  let tiedOnPriority = 0;
  for (const [p, n] of byPriority) {
    if (n > tiedOnPriority) {
      tiedOnPriority = n;
      tiedPriority = p;
    }
  }
  return {
    all: items.length,
    open: open.length,
    untried: open.filter((i) => i.attempts === 0).length,
    settled: items.length - open.length,
    alreadyServed: items.filter((i) => i.alreadyServed && !isSettled(i.stage)).length,
    newData: open.filter((i) => i.newData).length,
    tiedOnPriority,
    tiedPriority,
    neverCalled: items.filter((i) => i.stage === 'verifying' && i.calls === 0).length,
  };
}

// ---------------------------------------------------------------------------
// Client-side filtering — exported so it is tested, not asserted by screenshot
// ---------------------------------------------------------------------------

export type BoardFlag =
  | 'newdata'
  | 'served'
  | 'failed'
  | 'untried'
  | 'folded'
  /** Has an accepted structured brief — the ones a lane can be handed. */
  | 'groomed'
  /** Open and has no brief at all. The pile grooming exists to work through. */
  | 'ungroomed'
  /** Somebody has said something about it. */
  | 'noted';

export interface BoardFilter {
  lanes: ReadonlyArray<WorkLane>;
  flags: ReadonlyArray<BoardFlag>;
  /** Intake channels. A capability lead has none, so it never matches one. */
  sources: ReadonlyArray<IdeaSource>;
  /** The CATEGORY — tool, feature, source, watch, engine. Not the lane: two
   *  kinds share the `build` lane, so lane cannot answer "only features". */
  kinds: ReadonlyArray<string>;
  /** 1..5. The field `pickWork` ranks on, and the one 293 of 413 open items
   *  were tied on — being able to filter TO a priority is what makes breaking
   *  that tie a job somebody can sit down and do. */
  priorities: ReadonlyArray<number>;
  query: string;
}

export const EMPTY_FILTER: BoardFilter = {
  lanes: [],
  flags: [],
  sources: [],
  kinds: [],
  priorities: [],
  query: '',
};

/**
 * Tolerate a partial filter.
 *
 * Every caller here passes a whole one, but `applyFilter` is also the function
 * a test or a future surface reaches for with two fields set. A missing array
 * must mean "not filtering on that", never a crash on `.length` — the shape of
 * this object has now grown twice.
 */
export function fullFilter(f: Partial<BoardFilter>): BoardFilter {
  return { ...EMPTY_FILTER, ...f };
}

export function matchesFilter(item: WorkItem, filter: Partial<BoardFilter>): boolean {
  const f = fullFilter(filter);
  if (f.lanes.length && !f.lanes.includes(item.lane)) return false;
  if (f.kinds.length && !f.kinds.includes(item.kind)) return false;
  if (f.priorities.length && !f.priorities.includes(item.priority)) return false;
  if (f.sources.length && (item.intake == null || !f.sources.includes(item.intake))) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const grooming = item.grooming ? JSON.stringify(item.grooming).toLowerCase() : '';
    if (!item.title.toLowerCase().includes(q) && !item.detail.toLowerCase().includes(q) && !grooming.includes(q)) {
      return false;
    }
  }
  // Flags are AND, not OR: "brings new data" plus "never tried" should narrow
  // to the intersection, because that is the pile a reserved slot draws from.
  for (const flag of f.flags) {
    if (flag === 'newdata' && !item.newData) return false;
    if (flag === 'served' && !item.alreadyServed) return false;
    if (flag === 'failed' && !item.lastError) return false;
    // Open AND never attempted. Counting every `attempts: 0` row would include
    // capability leads and anything abandoned before a first try, and the chip
    // would then disagree with the "never once attempted" tile inches above it.
    if (flag === 'untried' && (item.attempts !== 0 || isSettled(item.stage))) return false;
    if (flag === 'folded' && !item.foldedCount) return false;
    if (flag === 'groomed' && !item.grooming) return false;
    // Open AND unbriefed. A shipped row without a brief is not work waiting to
    // be groomed, and counting it would make the chip disagree with the pile
    // the grooming step actually draws from.
    if (flag === 'ungroomed' && (item.grooming != null || isSettled(item.stage))) return false;
    if (flag === 'noted' && item.noteCount === 0) return false;
  }
  return true;
}

export function applyFilter(items: WorkItem[], f: Partial<BoardFilter>): WorkItem[] {
  const full = fullFilter(f);
  return items.filter((i) => matchesFilter(i, full));
}

// ---------------------------------------------------------------------------
// Inflow — where the work comes from, and whether the queue is draining
// ---------------------------------------------------------------------------

export interface InflowChannel {
  source: IdeaSource;
  label: string;
  from: string;
  /** Everything ever queued through this channel. */
  total: number;
  /** Still open. */
  open: number;
  /** Queued inside the window. */
  recent: number;
  /** Open items on this channel a shipped sibling appears to cover already. */
  served: number;
}

export interface InflowView {
  windowDays: number;
  channels: InflowChannel[];
  /** Queued inside the window. */
  intake: number;
  /**
   * Settled inside the window — shipped or parked.
   *
   * Counted off `backlogStatus`, NOT the derived stage. `stageFor` returns
   * `parked` for an item that has run out of attempts while its status is
   * still `open`, and every failed attempt bumps `updatedAt` — so a stage-based
   * count called an item the engine tried and failed on three nights running
   * "drained", and subtracted it from the standing queue. Exactly backwards.
   *
   * Dated by `updatedAt`, which is the closest thing a backlog row has to a
   * "settled at". Still not exact: a priority edit moves it too, so an item
   * settled long ago and touched from the board reads as drained today. That
   * over-states the drain rather than under-stating it — the direction that
   * flatters the engine — so the ratio is a FLOOR on how badly intake outruns
   * it.
   */
  drained: number;
  /** Open right now, whatever window it arrived in. */
  standing: number;
  /** intake ÷ drained, or null when nothing drained. */
  ratio: number | null;
  /** How much of the queue predates the stamp and can never be attributed. */
  unattributed: number;
}

/**
 * Where the queue came from.
 *
 * The room could always say what the engine BUILT and never why it was asked.
 * Until the stamp existed the honest answer for every row was "nobody
 * recorded", and that is exactly what `unattributed` reports — 455 rows
 * predate it, and no amount of inference would make a guess into a record.
 */
export function summariseInflow(items: WorkItem[], windowDays = 30, now = Date.now()): InflowView {
  const since = now - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = (iso: string) => {
    const t = Date.parse(iso ?? '');
    return Number.isFinite(t) && t >= since;
  };

  const channels: InflowChannel[] = [];
  for (const source of IDEA_SOURCES) {
    const mine = items.filter((i) => i.intake === source);
    if (mine.length === 0) continue;
    channels.push({
      source,
      label: SOURCE_LABEL[source].label,
      from: SOURCE_LABEL[source].from,
      total: mine.length,
      open: mine.filter((i) => i.backlogStatus === 'open').length,
      recent: mine.filter((i) => inWindow(i.createdAt)).length,
      served: mine.filter((i) => i.alreadyServed && i.backlogStatus === 'open').length,
    });
  }
  // Busiest first; the channel that can never be attributed sorts last however
  // large it is, because it is a gap in the record rather than a source.
  channels.sort(
    (a, b) =>
      Number(a.source === 'unattributed') - Number(b.source === 'unattributed') ||
      b.recent - a.recent ||
      b.total - a.total,
  );

  const backlogItems = items.filter((i) => i.intake != null);
  const intake = backlogItems.filter((i) => inWindow(i.createdAt)).length;
  const settled = (i: WorkItem) => i.backlogStatus != null && i.backlogStatus !== 'open';
  const drained = backlogItems.filter((i) => settled(i) && inWindow(i.updatedAt)).length;
  const standing = backlogItems.filter((i) => !settled(i)).length;

  return {
    windowDays,
    channels,
    intake,
    drained,
    standing,
    ratio: drained > 0 ? Math.round((intake / drained) * 10) / 10 : null,
    unattributed: items.filter((i) => i.intake === 'unattributed').length,
  };
}

// ---------------------------------------------------------------------------
// Burndown — the shape of the queue over time, reconstructed
// ---------------------------------------------------------------------------

/**
 * When a row actually left the queue, or null while it is still in it.
 *
 * Two dates, and the difference matters. `settledAt` is stamped on the
 * transition by `setParked`, `foldItems`, `removeBacklogItem` and
 * `markAttempt`, and is the truth. `updatedAt` is what every row settled
 * before that field existed has to fall back on — and a priority edit moves
 * it, so a row parked in July and re-prioritised from this board yesterday
 * reads as settled yesterday.
 *
 * The fallback is kept rather than dropping those rows, because dropping them
 * would draw a queue that never had 455 items in it. It is COUNTED instead:
 * `BurndownView.dated` says how much of the curve is a record and how much is
 * an inference, and the room prints it.
 */
export function settleDate(i: WorkItem): { at: string; recorded: boolean } | null {
  if (i.backlogStatus == null || i.backlogStatus === 'open') return null;
  if (i.settledAt) return { at: i.settledAt, recorded: true };
  return { at: i.updatedAt, recorded: false };
}

export interface BurndownDay {
  /** UTC `YYYY-MM-DD`. UTC on purpose: porkserv runs Europe/London while
   *  homeserv and CI run UTC, and a local-time bucket puts the same row on
   *  two different days depending on which box drew the chart. */
  day: string;
  /** Still in the queue at the end of that day. */
  open: number;
  added: number;
  settled: number;
  /** How that day's `settled` splits between a recorded `settledAt` and a
   *  fallback to `updatedAt`. Per day rather than only per window so a chart
   *  showing the last 30 of 90 days can state the honesty of the 30 it is
   *  actually drawing rather than of a window nobody is looking at. */
  recorded: number;
  inferred: number;
}

export type BurndownOutlook = 'draining' | 'growing' | 'level';

export interface BurndownView {
  windowDays: number;
  days: BurndownDay[];
  openNow: number;
  openThen: number;
  /** Trailing rates over the last `RATE_WINDOW_DAYS`, stated per week because
   *  a per-day rate on a queue this size rounds to noise. */
  addedPerWeek: number;
  settledPerWeek: number;
  /** added − settled. Positive means the pile grows. */
  netPerWeek: number;
  outlook: BurndownOutlook;
  /** Only when draining, and only when the rate is non-zero. */
  daysToClear: number | null;
  /** How much of the settled half of the curve is recorded rather than
   *  inferred from `updatedAt`. Printed, never hidden. */
  dated: { recorded: number; inferred: number };
  /** True when no backlog row is old enough to reach the left edge, so the
   *  first points describe a shorter history than the axis suggests. */
  truncated: boolean;
}

/** The window the trailing rate is measured over. A week: shorter is one
 *  night's luck, longer stops responding to a change in the engine. */
export const RATE_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** End of the UTC day containing `ms`, exclusive. */
function endOfUtcDay(ms: number): number {
  return Date.parse(`${utcDay(ms)}T23:59:59.999Z`);
}

function parse(iso: string | null | undefined): number | null {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
}

/**
 * The standing queue, one point per day.
 *
 * An item was open at the end of day *D* if it was created on or before *D*
 * and had not settled by then. Reconstructed rather than recorded: nothing has
 * ever snapshotted the queue size, and the 455 rows that already exist cannot
 * be made to have been.
 *
 * MUST be called over the whole population, before `trimSettled` — the same
 * rule `summarise` and `summariseInflow` follow. Counted after the trim, every
 * point left of the cap would be missing its settled rows and the curve would
 * slope the wrong way.
 *
 * Capability leads are excluded: they live in the appetite ledger, are ruled on
 * elsewhere, and were never in this queue to burn down.
 */
export function summariseBurndown(
  items: WorkItem[],
  windowDays = 60,
  now = Date.now(),
): BurndownView {
  const rows = items
    .filter((i) => i.source === 'backlog')
    .map((i) => {
      const settled = settleDate(i);
      return {
        created: parse(i.createdAt),
        settled: settled ? parse(settled.at) : null,
        recorded: settled?.recorded ?? false,
      };
    })
    // A row with no readable creation date cannot be placed on a timeline at
    // all. Dropping it is the only honest move; it is counted nowhere here.
    .filter((r): r is { created: number; settled: number | null; recorded: boolean } => r.created != null);

  const days: BurndownDay[] = [];
  const span = Math.max(1, Math.round(windowDays));
  let earliest = Infinity;
  for (const r of rows) earliest = Math.min(earliest, r.created);

  for (let back = span - 1; back >= 0; back--) {
    const cursor = now - back * DAY_MS;
    const end = endOfUtcDay(cursor);
    const start = end - DAY_MS + 1;
    let open = 0;
    let added = 0;
    let settledCount = 0;
    let recordedCount = 0;
    let inferredCount = 0;
    for (const r of rows) {
      if (r.created <= end && (r.settled == null || r.settled > end)) open += 1;
      if (r.created >= start && r.created <= end) added += 1;
      if (r.settled != null && r.settled >= start && r.settled <= end) {
        settledCount += 1;
        if (r.recorded) recordedCount += 1;
        else inferredCount += 1;
      }
    }
    days.push({
      day: utcDay(cursor),
      open,
      added,
      settled: settledCount,
      recorded: recordedCount,
      inferred: inferredCount,
    });
  }

  const rate = Math.min(RATE_WINDOW_DAYS, days.length);
  const tail = days.slice(-rate);
  const perWeek = (total: number) => Math.round((total / rate) * 7 * 10) / 10;
  const addedPerWeek = perWeek(tail.reduce((n, d) => n + d.added, 0));
  const settledPerWeek = perWeek(tail.reduce((n, d) => n + d.settled, 0));
  const netPerWeek = Math.round((addedPerWeek - settledPerWeek) * 10) / 10;

  const openNow = days.length ? days[days.length - 1].open : 0;
  const openThen = days.length ? days[0].open : 0;

  // "Level" is a band, not an exact zero: one item a week either way on a pile
  // of four hundred is not a trend anybody should read off a chart.
  const outlook: BurndownOutlook =
    netPerWeek > 1 ? 'growing' : netPerWeek < -1 ? 'draining' : 'level';
  const daysToClear =
    outlook === 'draining' && netPerWeek < 0
      ? Math.ceil(openNow / (Math.abs(netPerWeek) / 7))
      : null;

  const windowStart = now - (span - 1) * DAY_MS;
  let recorded = 0;
  let inferred = 0;
  for (const r of rows) {
    if (r.settled == null || r.settled < windowStart) continue;
    if (r.recorded) recorded += 1;
    else inferred += 1;
  }

  return {
    windowDays: span,
    days,
    openNow,
    openThen,
    addedPerWeek,
    settledPerWeek,
    netPerWeek,
    outlook,
    daysToClear,
    dated: { recorded, inferred },
    truncated: Number.isFinite(earliest) && earliest > windowStart,
  };
}

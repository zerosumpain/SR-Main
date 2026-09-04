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
// why `findRelatedIdea` and `looksAlreadyServed` can be reused here. They are
// reused rather than reimplemented on purpose: a second definition of "related"
// is the exact bug that left every driver unrecorded for a fortnight.

import { findRelatedIdea, looksAlreadyServed, type ToolHealth } from './narrative';
import type { BacklogItemData } from './types';

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

export interface WorkItem {
  /** Unique across both sources — `backlog:<slug>` or `capability:<slug>`. */
  id: string;
  source: 'backlog' | 'capability';
  slug: string;
  title: string;
  detail: string;
  kind: string;
  lane: WorkLane;
  stage: WorkStage;
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
  foldedCount: number;
  foldedInto: string | null;
  parkedReason: string | null;
  epicSlug: string | null;
  epicLabel: string;
  capabilitySlug: string | null;
  /** Capability leads only. */
  score: number | null;
  evidence: string[];
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
   * How many settled items to carry. The open pile is the point of the board;
   * every item ever shipped is history and belongs in the ledger. `null` keeps
   * everything, which is what the tests do.
   */
  settledLimit?: number | null;
}

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
  /** Stage counts over the WHOLE population, so a filtered column can say what
   *  it is hiding. The component counts the visible rows itself. */
  counts: Record<WorkStage, number>;
  totals: BoardTotals;
  error: string | null;
}

export const EMPTY_BOARD: BoardView = {
  items: [],
  counts: { proposed: 0, accepted: 0, building: 0, verifying: 0, live: 0, parked: 0 },
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

function epicLabelFor(slug: string | null): string {
  if (!slug) return 'Unfiled';
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
  const tools = input.tools ?? [];

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
  const shipped = backlog.filter((b) => b.status === 'shipped');
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
  for (const item of backlog) {
    if (item.status !== 'open') continue;
    const match = shipped.find((s) => looksAlreadyServed(item.title, s.title));
    if (match) servedBy.set(item.slug, match.title);
  }

  const items: WorkItem[] = [];

  for (const b of backlog) {
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
      kind: b.kind,
      lane: laneForKind(b.kind),
      stage,
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
      foldedCount: b.foldedCount ?? 0,
      foldedInto: b.foldedInto ?? null,
      parkedReason: b.parkedReason ?? null,
      epicSlug,
      epicLabel: epicLabelFor(epicSlug),
      capabilitySlug: b.capabilitySlug ?? null,
      score: null,
      evidence: [],
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
      kind: c.kind,
      lane: laneForKind(c.kind),
      stage: stageForCapability(c.status),
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
      epicLabel: epicLabelFor(`cap:${c.slug}`),
      capabilitySlug: c.slug,
      score: c.score,
      evidence: c.evidence ?? [],
      actionable: false,
    });
  }

  // Totals are computed over EVERYTHING before any trim, so a number on the
  // page can never describe a smaller population than the one it names.
  const totals = summarise(items);
  const counts = countByStage(items);

  const trimmed = trimSettled(items, input.settledLimit ?? null);

  return { items: trimmed, counts, totals, error: null };
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

export type BoardFlag = 'newdata' | 'served' | 'failed' | 'untried' | 'folded';

export interface BoardFilter {
  lanes: ReadonlyArray<WorkLane>;
  flags: ReadonlyArray<BoardFlag>;
  query: string;
}

export const EMPTY_FILTER: BoardFilter = { lanes: [], flags: [], query: '' };

export function matchesFilter(item: WorkItem, f: BoardFilter): boolean {
  if (f.lanes.length && !f.lanes.includes(item.lane)) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    if (!item.title.toLowerCase().includes(q) && !item.detail.toLowerCase().includes(q)) {
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
  }
  return true;
}

export function applyFilter(items: WorkItem[], f: BoardFilter): WorkItem[] {
  return items.filter((i) => matchesFilter(i, f));
}

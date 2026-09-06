// The kanban, as rules rather than markup.
//
// `QueueBoard.svelte` renders two boards over one ledger: the EPIC level, where
// a card is a functional area holding several deliverables, and the DELIVERABLE
// level, where a card is the row `pickWork` actually ranks. Both draw the same
// six stage columns, and a drag on either has to end in a legal write.
//
// All of that is decided here, for the reason `board.ts` gives: a rule that
// needs a test does not belong in a component. The component's job is to draw
// what these functions return and to send what `planMove` says to send.

import { canMove, type WorkItem, type WorkStage } from './board';
import { contentWords } from './narrative';
import type { BacklogEpic } from './epic-backlog';

export const BOARD_LEVELS = ['epic', 'deliverable'] as const;
export type BoardLevel = (typeof BOARD_LEVELS)[number];

export const LEVEL_META: Readonly<Record<BoardLevel, { label: string; note: string }>> = {
  epic: {
    label: 'Epics',
    note: 'One card per functional area. Moving one moves every deliverable inside it.',
  },
  deliverable: {
    label: 'Deliverables',
    note: 'One card per queued row — the level `pickWork` ranks when it chooses tonight’s build.',
  },
};

/** The properties a card can be filtered on that are not a plain field. */
export const CARD_FLAGS = ['review', 'untried', 'failed', 'served', 'noted'] as const;
export type CardFlag = (typeof CARD_FLAGS)[number];

export const FLAG_META: Readonly<Record<CardFlag, string>> = {
  review: 'needs review',
  untried: 'never attempted',
  failed: 'has failed',
  served: 'already served',
  noted: 'discussed',
};

export const CARD_SORTS = ['queue', 'recent', 'oldest', 'size'] as const;
export type CardSort = (typeof CARD_SORTS)[number];

export const SORT_META: Readonly<Record<CardSort, string>> = {
  queue: 'Queue order (priority)',
  recent: 'Most recently touched',
  oldest: 'Longest untouched',
  size: 'Largest first',
};

export interface BoardCard {
  /** Unique within one level. Used as the `{#each}` key and the drag payload. */
  key: string;
  level: BoardLevel;
  /** What the drill opens — a deliverable card opens its own epic. */
  epicSlug: string;
  title: string;
  stage: WorkStage;
  priority: number;
  /** The categories, as `BacklogKind` values. A word, never a colour. */
  kinds: string[];
  updatedAt: string;
  flags: CardFlag[];
  /** Whether ANY move is possible. A capability lead is ruled in Appetite. */
  actionable: boolean;
  /** Deliverables this card stands for. One, at the deliverable level. */
  total: number;
  /** Deliverables under this card that are still open. */
  active: number;
  /** Deliverables under this card recorded live. */
  live: number;
  /** Pending grooming suggestions under this card. */
  review: number;
  /** The sentence saying why the card sits where it does. Body font, own line. */
  note: string | null;
  epic: BacklogEpic | null;
  item: WorkItem | null;
  /** Lower-cased haystack, built once so the search box is not O(n) work per key. */
  search: string;
}

/** A deliverable folded into another is an execution receipt, not open work. */
function isOpenWork(i: WorkItem): boolean {
  return i.source === 'backlog' && i.backlogStatus === 'open' && !i.foldedInto;
}

function isParkedWork(i: WorkItem): boolean {
  return i.source === 'backlog' && i.backlogStatus === 'abandoned' && !i.foldedInto;
}

function itemFlags(item: WorkItem, reviewed: ReadonlySet<string>): CardFlag[] {
  const flags: CardFlag[] = [];
  if (reviewed.has(item.id)) flags.push('review');
  if (item.attempts === 0) flags.push('untried');
  if (item.lastError) flags.push('failed');
  if (item.alreadyServed) flags.push('served');
  if (item.noteCount > 0) flags.push('noted');
  return flags;
}

/**
 * The one line under a card's title.
 *
 * Order is deliberate and matches the old board: a failure outranks a fold,
 * which outranks the reason it was parked, which outranks the evidence that
 * put it here. Only one is shown, because a card carrying four sentences is a
 * paragraph and stops being scannable.
 */
function itemNote(item: WorkItem): string | null {
  if (item.alreadyServed && item.servedBy) return `Already served by “${item.servedBy}”.`;
  if (item.lastError) return `Attempt ${item.attempts} failed — ${item.lastError}`;
  if (item.foldedCount) return `${item.foldedCount} restatement${item.foldedCount === 1 ? '' : 's'} folded in.`;
  if (item.parkedReason) return item.parkedReason;
  if (item.evidence.length) return `Because: ${item.evidence.join(' · ')}`;
  return item.detail.trim() ? item.detail.trim() : null;
}

/** Every deliverable an epic holds, receipts included, in one flat list. */
function membersOf(epic: BacklogEpic): WorkItem[] {
  return epic.deliverables;
}

export function toCards(epics: BacklogEpic[], level: BoardLevel): BoardCard[] {
  if (level === 'deliverable') {
    return epics.flatMap((epic) => {
      const reviewed = new Set((epic.suggestions ?? []).map((s) => s.itemId));
      return membersOf(epic).map((item) => ({
        key: item.id,
        level,
        epicSlug: epic.slug,
        title: item.title.replace(/^Epic:\s*/i, ''),
        stage: item.stage,
        priority: item.priority,
        kinds: [item.kind],
        updatedAt: item.updatedAt,
        flags: itemFlags(item, reviewed),
        // A folded row is a receipt: it may be read, never moved.
        actionable: item.actionable && !item.foldedInto,
        total: 1,
        active: isOpenWork(item) ? 1 : 0,
        live: item.stage === 'live' ? 1 : 0,
        review: reviewed.has(item.id) ? 1 : 0,
        note: itemNote(item),
        epic,
        item,
        search: [item.title, item.detail, item.kind, epic.title].join(' ').toLowerCase(),
      }));
    });
  }
  return epics.map((epic) => {
    const members = membersOf(epic);
    const review = (epic.suggestions ?? []).length;
    return {
      key: epic.slug,
      level,
      epicSlug: epic.slug,
      title: epic.title,
      stage: epic.stage,
      priority: epic.priority,
      kinds: epic.categories,
      updatedAt: epic.updatedAt,
      flags: [
        ...(review ? (['review'] as CardFlag[]) : []),
        ...(members.every((i) => i.attempts === 0) ? (['untried'] as CardFlag[]) : []),
        ...(members.some((i) => i.lastError) ? (['failed'] as CardFlag[]) : []),
        ...(members.some((i) => i.alreadyServed) ? (['served'] as CardFlag[]) : []),
        ...(members.some((i) => i.noteCount > 0) ? (['noted'] as CardFlag[]) : []),
      ],
      actionable: members.some((i) => i.actionable && !i.foldedInto),
      total: members.length,
      active: members.filter(isOpenWork).length,
      live: epic.completed,
      review,
      note: epic.summary.trim() || null,
      epic,
      item: null,
      search: [epic.title, epic.summary, ...members.flatMap((i) => [i.title, i.detail, i.kind])]
        .join(' ')
        .toLowerCase(),
    };
  });
}

export interface CardFilter {
  query?: string;
  kinds?: string[];
  priorities?: number[];
  flags?: CardFlag[];
}

/**
 * A PARTIAL filter, for the reason `applyFilter` takes one: this shape has
 * grown twice already, and a missing array must read as "not filtering on
 * that" rather than "matching nothing".
 */
export function matchesCard(card: BoardCard, f: CardFilter): boolean {
  const query = (f.query ?? '').trim().toLowerCase();
  if (query && !card.search.includes(query)) return false;
  if (f.kinds?.length && !card.kinds.some((k) => f.kinds!.includes(k))) return false;
  if (f.priorities?.length && !f.priorities.includes(card.priority)) return false;
  if (f.flags?.length && !f.flags.every((flag) => card.flags.includes(flag))) return false;
  return true;
}

export function filterCards(cards: BoardCard[], f: CardFilter): BoardCard[] {
  return cards.filter((c) => matchesCard(c, f));
}

export function sortCards(cards: BoardCard[], mode: CardSort): BoardCard[] {
  const out = [...cards];
  switch (mode) {
    case 'recent':
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
    case 'oldest':
      return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.title.localeCompare(b.title));
    case 'size':
      return out.sort((a, b) => b.active - a.active || a.priority - b.priority || a.title.localeCompare(b.title));
    default:
      // Queue order is what the engine sees: priority first, and a card that
      // has never been tried ahead of one that has, so the column reads in the
      // order work would actually be taken off it.
      return out.sort(
        (a, b) =>
          a.priority - b.priority ||
          Number(b.flags.includes('untried')) - Number(a.flags.includes('untried')) ||
          a.title.localeCompare(b.title),
      );
  }
}

export interface PlannedMove {
  ok: boolean;
  /** The write, when there is one. `backlog_park` with `parked` either way. */
  action: 'park' | 'accept' | null;
  /** Every backlog slug the write touches. Sent as ONE request, never n. */
  slugs: string[];
  /** The column the card will actually be in afterwards, which is NOT always
   *  the one it was dropped on — see `stageAfter`. */
  lands: WorkStage | null;
  /** What it will do, or why it will not. Shown either way — a refused drop
   *  that says nothing is indistinguishable from a broken one. */
  reason: string;
}

/** The precedence `buildEpicBacklog` folds an epic's deliverables with. */
const STAGE_PRECEDENCE: ReadonlyArray<WorkStage> = ['building', 'accepted', 'proposed', 'verifying', 'live'];

/**
 * Where a card ends up once the plan is applied.
 *
 * An epic has no stage of its own: it inherits the most-advanced stage among
 * its deliverables. So parking every OPEN row in an epic that also holds a
 * shipped one does not move the epic to Parked — it moves it to Live, because
 * that is now the only stage left. Measured on production data: dropping
 * "Canonical home-temperature telemetry feature" on Parked correctly parked two
 * rows and landed the card under Live, which reads as a broken board unless the
 * board says so first.
 *
 * Folded rows are excluded exactly as `buildEpicBacklog` excludes them, except
 * where their parent is one of the epic's combined deliveries.
 */
function stageAfter(card: BoardCard, parked: ReadonlySet<string>, to: WorkStage): WorkStage {
  if (card.level === 'deliverable') return to;
  const combined = new Set(card.epic!.combinedDeliveries.map((c) => c.slug));
  const active = membersOf(card.epic!).filter((i) => !i.foldedInto || combined.has(i.foldedInto));
  const stages = active.map((i) => (parked.has(i.slug) ? to : i.stage));
  return STAGE_PRECEDENCE.find((s) => stages.includes(s)) ?? 'parked';
}

const REFUSED: Readonly<Record<string, string>> = {
  live: 'Nothing can be moved into Live — a tool becomes live when jkai calls it.',
  building: 'In build is a consequence of an attempt, not something to assert.',
  verifying: 'Verifying is a consequence of an attempt, not something to assert.',
};

/**
 * What a drop would write, decided before anything is sent.
 *
 * The two moves that exist are park and un-park. Everything else the pipeline
 * shows is a consequence of an attempt, and a board that let a person assert
 * one would be a board that lies — the rule `LEGAL_MOVES` already encodes and
 * this only has to respect.
 *
 * An epic's stage is DERIVED from its deliverables, so moving one is a write
 * to each of them. That is why the plan carries the slugs and the sentence
 * describing them: the surface reports what it did rather than leaving the
 * owner to infer it from six columns of counts that all moved at once.
 */
export function planMove(card: BoardCard, to: WorkStage): PlannedMove {
  if (card.stage === to) return { ok: false, action: null, slugs: [], lands: null, reason: '' };
  if (!canMove(card.stage, to)) {
    return {
      ok: false,
      action: null,
      slugs: [],
      lands: null,
      reason:
        REFUSED[to] ??
        (card.stage === 'live' || card.stage === 'verifying'
          ? `Nothing may leave ${STAGE_LABEL[card.stage]} — parking a shipped row would erase the fact that it shipped.`
          : `${STAGE_LABEL[card.stage]} does not move to ${STAGE_LABEL[to]}.`),
    };
  }
  const action = to === 'parked' ? 'park' : 'accept';
  const wanted = action === 'park' ? isOpenWork : isParkedWork;
  const members = card.level === 'epic' ? membersOf(card.epic!) : [card.item!];
  const slugs = [...new Set(members.filter(wanted).map((i) => i.slug))];
  if (slugs.length === 0) {
    return {
      ok: false,
      action: null,
      slugs: [],
      lands: null,
      reason:
        members.length && members.every((i) => i.source === 'capability')
          ? 'These are capability leads — rule on them in Appetite, which carries their evidence.'
          : `Nothing here can be ${action === 'park' ? 'parked' : 'restored'}.`,
    };
  }
  const lands = stageAfter(card, new Set(slugs), to);
  return { ok: true, action, slugs, lands, reason: describeMove(card, action, slugs.length, lands, to) };
}

function describeMove(
  card: BoardCard,
  action: 'park' | 'accept',
  n: number,
  lands: WorkStage,
  to: WorkStage,
): string {
  const verb = action === 'park' ? 'Parked' : 'Restored';
  const what =
    card.level === 'deliverable'
      ? `${verb} “${card.title}”.`
      : `${verb} ${n} deliverable${n === 1 ? '' : 's'} in “${card.title}”.`;
  // Said up front, not discovered afterwards: the card is about to appear in a
  // column nobody dropped it on.
  return lands === to ? what : `${what} The epic stays under ${STAGE_LABEL[lands]} — that is where its other deliverables are.`;
}

/** Column names, so the plan can name one without importing the surface. */
const STAGE_LABEL: Readonly<Record<WorkStage, string>> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  building: 'In build',
  verifying: 'Verifying',
  live: 'Live',
  parked: 'Parked',
};

/** Which stage columns a card may be dropped into, for the drop affordance. */
export function dropTargets(card: BoardCard): WorkStage[] {
  const stages: WorkStage[] = ['accepted', 'parked'];
  return stages.filter((s) => planMove(card, s).ok);
}

/**
 * Priority is the field `pickWork` ranks on, so it is the only control on the
 * board that changes what gets built tonight. Clamped rather than wrapped: a
 * stepper that took P1 back round to P5 sent an item to the bottom of the
 * queue on a button labelled "raise".
 */
export function stepPriority(from: number, by: -1 | 1): number {
  return Math.min(5, Math.max(1, from + by));
}

/** Every open backlog slug an epic-level priority change would rewrite. */
export function prioritySlugs(card: BoardCard): string[] {
  const members = card.level === 'epic' ? membersOf(card.epic!) : [card.item!];
  return [...new Set(members.filter(isOpenWork).map((i) => i.slug))];
}

// ---------------------------------------------------------------------------
// Reading a suggestion
// ---------------------------------------------------------------------------

/**
 * The words the matcher actually joined two titles on.
 *
 * Every suggestion carries the same two-sentence `reason`, the second of which
 * ("Related requirements are retained together; distinct functionality remains
 * separately deliberable") is identical on all 113 of them and says nothing
 * about the pair in front of you. This is the part that differs: the shared
 * subject words, which are the whole of the matcher's evidence.
 *
 * Built on `contentWords` — the SAME tokeniser `subjectOverlap` counts in.
 * A second definition of "related" here would be the bug that left every
 * driver unrecorded; this reports the evidence and decides nothing.
 */
export function sharedTerms(a: string, b: string, limit = 8): string[] {
  const left = contentWords(a);
  const right = contentWords(b);
  return [...left].filter((w) => right.has(w)).sort((x, y) => y.length - x.length || x.localeCompare(y)).slice(0, limit);
}

/**
 * The half of a suggestion's reason that varies.
 *
 * The first sentence says which kind of evidence was found — a live
 * deliverable, a tool with successful calls, another queued row. Everything
 * after it is the same boilerplate on every row, and a column repeating one
 * sentence 113 times is a column of no information taking a quarter of the
 * width.
 */
export function matchClaim(reason: string): string {
  const [first] = reason.split(/(?<=\.)\s+/);
  return (first ?? reason).trim();
}

export interface BoardCounts {
  /** Cards per stage, over the whole population rather than the filtered one. */
  all: Record<WorkStage, number>;
  /** Cards per stage after the filter — the numerator the column shows. */
  shown: Record<WorkStage, number>;
}

const EMPTY_COUNTS = (): Record<WorkStage, number> => ({
  proposed: 0,
  accepted: 0,
  building: 0,
  verifying: 0,
  live: 0,
  parked: 0,
});

export function countCards(all: BoardCard[], shown: BoardCard[]): BoardCounts {
  const counts: BoardCounts = { all: EMPTY_COUNTS(), shown: EMPTY_COUNTS() };
  for (const c of all) counts.all[c.stage] += 1;
  for (const c of shown) counts.shown[c.stage] += 1;
  return counts;
}

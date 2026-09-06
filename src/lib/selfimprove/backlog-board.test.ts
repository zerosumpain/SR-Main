import { describe, it, expect } from 'vitest';
import {
  toCards,
  filterCards,
  sortCards,
  planMove,
  dropTargets,
  stepPriority,
  prioritySlugs,
  countCards,
  matchesCard,
  matchClaim,
  sharedTerms,
  type BoardCard,
} from './backlog-board';
import type { WorkItem, WorkStage } from './board';
import type { BacklogEpic } from './epic-backlog';

function work(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: over.id ?? 'backlog:an-idea',
    source: over.source ?? 'backlog',
    slug: over.slug ?? 'an-idea',
    title: over.title ?? 'An idea',
    detail: over.detail ?? '',
    grooming: null,
    kind: over.kind ?? 'feature',
    lane: over.lane ?? 'build',
    stage: over.stage ?? 'accepted',
    backlogStatus: over.backlogStatus ?? 'open',
    priority: over.priority ?? 3,
    attempts: over.attempts ?? 0,
    attemptCeiling: 4,
    createdAt: over.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-08-01T00:00:00.000Z',
    lastError: over.lastError ?? null,
    artifact: null,
    artifactHref: null,
    calls: null,
    errorRate: null,
    newData: false,
    alreadyServed: over.alreadyServed ?? false,
    servedBy: over.servedBy ?? null,
    foldedCount: over.foldedCount ?? 0,
    foldedInto: over.foldedInto ?? null,
    parkedReason: over.parkedReason ?? null,
    epicSlug: over.epicSlug ?? null,
    epicLabel: over.epicLabel ?? 'Everything else',
    capabilitySlug: null,
    intake: null,
    score: null,
    evidence: over.evidence ?? [],
    noteCount: over.noteCount ?? 0,
    lastNoteAt: null,
    settledAt: null,
    actionable: over.actionable ?? true,
    ...over,
  };
}

function epic(over: Partial<BacklogEpic> = {}): BacklogEpic {
  const deliverables = over.deliverables ?? [work()];
  return {
    slug: over.slug ?? 'an-epic',
    title: over.title ?? 'An epic',
    summary: over.summary ?? '',
    priority: over.priority ?? 3,
    stage: over.stage ?? 'accepted',
    deliverables,
    combinedDeliveries: over.combinedDeliveries ?? [],
    categories: over.categories ?? [...new Set(deliverables.map((i) => i.kind))],
    completed: over.completed ?? 0,
    updatedAt: over.updatedAt ?? '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('toCards', () => {
  it('makes one card per epic at the epic level', () => {
    const cards = toCards([epic({ deliverables: [work(), work({ id: 'backlog:b', slug: 'b' })] })], 'epic');
    expect(cards).toHaveLength(1);
    expect(cards[0].active).toBe(2);
  });

  it('makes one card per deliverable at the deliverable level', () => {
    const cards = toCards([epic({ deliverables: [work(), work({ id: 'backlog:b', slug: 'b' })] })], 'deliverable');
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.epicSlug === 'an-epic')).toBe(true);
  });

  it('carries the epic slug on a deliverable card so the drill still opens', () => {
    const [card] = toCards([epic({ slug: 'calendar' })], 'deliverable');
    expect(card.epicSlug).toBe('calendar');
  });

  it('strips the legacy "Epic:" prefix from a deliverable title', () => {
    const [card] = toCards([epic({ deliverables: [work({ title: 'Epic: A thing' })] })], 'deliverable');
    expect(card.title).toBe('A thing');
  });

  it('refuses to make a folded receipt actionable', () => {
    const [card] = toCards([epic({ deliverables: [work({ foldedInto: 'other' })] })], 'deliverable');
    expect(card.actionable).toBe(false);
  });

  it('flags an epic for review when any deliverable has a suggestion', () => {
    const cards = toCards(
      [
        epic({
          suggestions: [
            {
              automatic: false,
              id: 's1',
              itemId: 'backlog:an-idea',
              kind: 'merge',
              targetId: 'backlog:b',
              targetTitle: 'B',
              targetHref: null,
              reason: 'because',
            },
          ],
        }),
      ],
      'epic',
    );
    expect(cards[0].flags).toContain('review');
    expect(cards[0].review).toBe(1);
  });

  it('counts a folded deliverable out of the active total but keeps it in the total', () => {
    const cards = toCards([epic({ deliverables: [work(), work({ id: 'backlog:b', slug: 'b', foldedInto: 'an-idea' })] })], 'epic');
    expect(cards[0].active).toBe(1);
    expect(cards[0].total).toBe(2);
  });

  it('still says how many deliverables a shipped epic holds', () => {
    // "0 active · 0 live" is a card saying nothing about the rows it holds:
    // a shipped-but-uncalled deliverable is neither open nor live.
    const cards = toCards(
      [
        epic({
          stage: 'verifying',
          completed: 0,
          deliverables: [work({ backlogStatus: 'shipped', stage: 'verifying' })],
        }),
      ],
      'epic',
    );
    expect(cards[0]).toMatchObject({ total: 1, active: 0, live: 0 });
  });
});

describe('the card note', () => {
  it('says what served it before it says anything else', () => {
    const [card] = toCards(
      [epic({ deliverables: [work({ alreadyServed: true, servedBy: 'A tool', lastError: 'boom' })] })],
      'deliverable',
    );
    expect(card.note).toContain('Already served');
  });

  it('prefers a failure to the evidence that raised it', () => {
    const [card] = toCards(
      [epic({ deliverables: [work({ attempts: 2, lastError: 'HTTP 405', evidence: ['a fault'] })] })],
      'deliverable',
    );
    expect(card.note).toBe('Attempt 2 failed — HTTP 405');
  });

  it('falls back to the brief when there is nothing else to say', () => {
    const [card] = toCards([epic({ deliverables: [work({ detail: 'Do the thing' })] })], 'deliverable');
    expect(card.note).toBe('Do the thing');
  });
});

describe('planMove', () => {
  const accepted = () => toCards([epic({ stage: 'accepted' })], 'epic')[0];

  it('parks every open deliverable in one write', () => {
    const card = toCards(
      [
        epic({
          stage: 'accepted',
          deliverables: [work({ slug: 'a' }), work({ id: 'backlog:b', slug: 'b' })],
        }),
      ],
      'epic',
    )[0];
    const plan = planMove(card, 'parked');
    expect(plan.ok).toBe(true);
    expect(plan.action).toBe('park');
    expect(plan.slugs).toEqual(['a', 'b']);
    expect(plan.reason).toBe('Parked 2 deliverables in “An epic”.');
  });

  it('restores only the parked deliverables when moving back to accepted', () => {
    const card = toCards(
      [
        epic({
          stage: 'parked',
          deliverables: [
            work({ slug: 'open-one' }),
            work({ id: 'backlog:b', slug: 'parked-one', backlogStatus: 'abandoned', stage: 'parked' }),
          ],
        }),
      ],
      'epic',
    )[0];
    const plan = planMove(card, 'accepted');
    expect(plan.slugs).toEqual(['parked-one']);
  });

  it('refuses a move into live', () => {
    expect(planMove(accepted(), 'live')).toMatchObject({ ok: false, slugs: [] });
    expect(planMove(accepted(), 'live').reason).toContain('jkai calls it');
  });

  it('refuses a move into building or verifying', () => {
    expect(planMove(accepted(), 'building').ok).toBe(false);
    expect(planMove(accepted(), 'verifying').ok).toBe(false);
  });

  it('names both ends when the refusal is not about a shipped row', () => {
    // Not reachable by drag — the board only offers accepted and parked — but
    // a refusal that describes the wrong column is worse than no refusal.
    expect(planMove(accepted(), 'proposed').reason).toBe('Accepted does not move to Proposed.');
  });

  it('refuses to move anything out of live', () => {
    const card = toCards([epic({ stage: 'live', deliverables: [work({ stage: 'live' })] })], 'epic')[0];
    expect(planMove(card, 'parked').ok).toBe(false);
    expect(planMove(card, 'parked').reason).toContain('erase the fact that it shipped');
  });

  it('says so when the epic holds only capability leads', () => {
    const card = toCards(
      [
        epic({
          stage: 'proposed',
          deliverables: [work({ id: 'capability:x', source: 'capability', backlogStatus: null, stage: 'proposed' })],
        }),
      ],
      'epic',
    )[0];
    const plan = planMove(card, 'parked');
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('Appetite');
  });

  it('names the deliverable rather than a count at the deliverable level', () => {
    const card = toCards([epic({ deliverables: [work({ title: 'A thing' })] })], 'deliverable')[0];
    expect(planMove(card, 'parked').reason).toBe('Parked “A thing”.');
  });

  it('says where the epic will actually land when a shipped row keeps it out of Parked', () => {
    // Production case: parking both open deliverables leaves the live one, and
    // the epic reappears under Live rather than Parked.
    const card = toCards(
      [
        epic({
          stage: 'accepted',
          completed: 1,
          deliverables: [
            work({ slug: 'a' }),
            work({ id: 'backlog:b', slug: 'b' }),
            work({ id: 'backlog:c', slug: 'c', backlogStatus: 'shipped', stage: 'live' }),
          ],
        }),
      ],
      'epic',
    )[0];
    const plan = planMove(card, 'parked');
    expect(plan.slugs).toEqual(['a', 'b']);
    expect(plan.lands).toBe('live');
    expect(plan.reason).toBe(
      'Parked 2 deliverables in “An epic”. The epic stays under Live — that is where its other deliverables are.',
    );
  });

  it('says nothing extra when the card lands where it was dropped', () => {
    const card = toCards([epic({ stage: 'accepted' })], 'epic')[0];
    const plan = planMove(card, 'parked');
    expect(plan.lands).toBe('parked');
    expect(plan.reason).toBe('Parked 1 deliverable in “An epic”.');
  });

  it('lands a deliverable card exactly where it was dropped', () => {
    const card = toCards([epic({ deliverables: [work({ title: 'A thing' })] })], 'deliverable')[0];
    expect(planMove(card, 'parked').lands).toBe('parked');
  });

  it('is a no-op onto the column the card already sits in', () => {
    expect(planMove(accepted(), 'accepted')).toMatchObject({ ok: false, reason: '' });
  });
});

describe('dropTargets', () => {
  it('offers parked only, from accepted', () => {
    expect(dropTargets(toCards([epic({ stage: 'accepted' })], 'epic')[0])).toEqual(['parked']);
  });

  it('offers accepted only, from parked', () => {
    const card = toCards(
      [epic({ stage: 'parked', deliverables: [work({ backlogStatus: 'abandoned', stage: 'parked' })] })],
      'epic',
    )[0];
    expect(dropTargets(card)).toEqual(['accepted']);
  });

  it('offers nothing at all on a shipped row', () => {
    expect(dropTargets(toCards([epic({ stage: 'live', deliverables: [work({ stage: 'live' })] })], 'epic')[0])).toEqual([]);
  });
});

describe('the filter', () => {
  const cards = toCards(
    [
      epic({ slug: 'a', title: 'Calendar work', priority: 1, deliverables: [work({ kind: 'tool' })] }),
      epic({ slug: 'b', title: 'Train times', priority: 4, deliverables: [work({ kind: 'feature', noteCount: 2 })] }),
    ],
    'epic',
  );

  it('matches everything on an empty filter', () => {
    expect(filterCards(cards, {})).toHaveLength(2);
  });

  it('searches titles and the deliverables inside', () => {
    expect(filterCards(cards, { query: 'calendar' }).map((c) => c.key)).toEqual(['a']);
  });

  it('narrows by category', () => {
    expect(filterCards(cards, { kinds: ['feature'] }).map((c) => c.key)).toEqual(['b']);
  });

  it('narrows by priority', () => {
    expect(filterCards(cards, { priorities: [1] }).map((c) => c.key)).toEqual(['a']);
  });

  it('requires EVERY named flag, so two flags mean both', () => {
    expect(filterCards(cards, { flags: ['noted'] }).map((c) => c.key)).toEqual(['b']);
    expect(filterCards(cards, { flags: ['noted', 'failed'] })).toHaveLength(0);
  });

  it('treats a missing array as "not filtering on that"', () => {
    expect(matchesCard(cards[0], { kinds: [], priorities: [] })).toBe(true);
  });
});

describe('sortCards', () => {
  const cards = toCards(
    [
      epic({ slug: 'a', title: 'A', priority: 3, updatedAt: '2026-08-01T00:00:00.000Z', deliverables: [work({ attempts: 1 })] }),
      epic({ slug: 'b', title: 'B', priority: 1, updatedAt: '2026-08-09T00:00:00.000Z', deliverables: [work(), work({ id: 'x', slug: 'x' })] }),
    ],
    'epic',
  );

  it('puts the top priority first in queue order', () => {
    expect(sortCards(cards, 'queue').map((c) => c.key)).toEqual(['b', 'a']);
  });

  it('orders by recency both ways', () => {
    expect(sortCards(cards, 'recent').map((c) => c.key)).toEqual(['b', 'a']);
    expect(sortCards(cards, 'oldest').map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('puts the biggest epic first by size', () => {
    expect(sortCards(cards, 'size').map((c) => c.key)).toEqual(['b', 'a']);
  });

  it('does not mutate what it was given', () => {
    const before = cards.map((c) => c.key);
    sortCards(cards, 'recent');
    expect(cards.map((c) => c.key)).toEqual(before);
  });
});

describe('priority', () => {
  it('clamps rather than wrapping', () => {
    expect(stepPriority(1, -1)).toBe(1);
    expect(stepPriority(5, 1)).toBe(5);
    expect(stepPriority(3, -1)).toBe(2);
  });

  it('rewrites every open deliverable under an epic and no shipped one', () => {
    const card = toCards(
      [
        epic({
          deliverables: [
            work({ slug: 'open-one' }),
            work({ id: 'backlog:b', slug: 'shipped-one', backlogStatus: 'shipped', stage: 'live' }),
          ],
        }),
      ],
      'epic',
    )[0];
    expect(prioritySlugs(card)).toEqual(['open-one']);
  });
});

describe('reading a suggestion', () => {
  it('reports the words the two titles actually share', () => {
    expect(sharedTerms('Home security sensor integration', 'Home status and security check')).toEqual([
      'security',
      'home',
    ]);
  });

  it('drops the stop words the matcher itself drops', () => {
    // "and", "the", "for" are in the matcher's STOP set, so they are not
    // evidence of anything and must not be shown as if they were.
    expect(sharedTerms('The tool for calendars', 'The tool for trains')).toEqual(['tool']);
  });

  it('returns nothing when there is no overlap', () => {
    expect(sharedTerms('Calendar sync', 'Train times')).toEqual([]);
  });

  it('honours the limit', () => {
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel india';
    expect(sharedTerms(long, long, 3)).toHaveLength(3);
  });

  it('keeps the claim and drops the boilerplate that follows it', () => {
    expect(
      matchClaim(
        'A matching deliverable is recorded as live. Related requirements are retained together; distinct functionality remains separately deliverable.',
      ),
    ).toBe('A matching deliverable is recorded as live.');
  });

  it('returns a one-sentence reason unchanged', () => {
    expect(matchClaim('Existing tool: 12 successful calls recorded.')).toBe(
      'Existing tool: 12 successful calls recorded.',
    );
  });
});

describe('countCards', () => {
  it('counts the whole population and the filtered one separately', () => {
    const all: BoardCard[] = toCards(
      [epic({ slug: 'a', stage: 'accepted' }), epic({ slug: 'b', stage: 'parked' })],
      'epic',
    );
    const counts = countCards(all, [all[0]]);
    expect(counts.all.accepted).toBe(1);
    expect(counts.all.parked).toBe(1);
    expect(counts.shown.parked).toBe(0);
  });

  it('names every stage even when the board is empty', () => {
    const counts = countCards([], []);
    const stages: WorkStage[] = ['proposed', 'accepted', 'building', 'verifying', 'live', 'parked'];
    expect(Object.keys(counts.all).sort()).toEqual([...stages].sort());
  });
});

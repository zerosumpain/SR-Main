import { describe, it, expect } from 'vitest';
import {
  buildBoard,
  stageFor,
  stageForCapability,
  canMove,
  laneForKind,
  bringsNewData,
  matchesFilter,
  applyFilter,
  sortForBoard,
  summarise,
  artifactHref,
  EMPTY_FILTER,
  type BoardCapability,
  type WorkItem,
} from './board';
import type { BacklogItemData } from './types';
import type { ToolHealth } from './narrative';

const CEILING = 4;

function item(over: Partial<BacklogItemData> = {}): BacklogItemData {
  return {
    slug: over.slug ?? 'an-idea',
    title: over.title ?? 'An idea',
    detail: over.detail ?? 'Some detail',
    kind: over.kind ?? 'tool',
    status: over.status ?? 'open',
    priority: over.priority ?? 3,
    attempts: over.attempts ?? 0,
    createdAt: over.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function tool(over: Partial<ToolHealth> = {}): ToolHealth {
  return {
    name: over.name ?? 'a_tool',
    description: over.description ?? '',
    enabled: over.enabled ?? true,
    runCount: over.runCount ?? 0,
    errorCount: over.errorCount ?? 0,
    createdAt: over.createdAt,
  };
}

describe('stageFor', () => {
  it('puts an untried open idea in accepted', () => {
    expect(stageFor(item(), { attemptCeiling: CEILING })).toBe('accepted');
  });

  it('puts an idea with attempts left in building', () => {
    expect(stageFor(item({ attempts: 2 }), { attemptCeiling: CEILING })).toBe('building');
  });

  it('parks an idea that is out of attempts', () => {
    expect(stageFor(item({ attempts: CEILING }), { attemptCeiling: CEILING })).toBe('parked');
  });

  it('parks an abandoned idea', () => {
    expect(stageFor(item({ status: 'abandoned' }), { attemptCeiling: CEILING })).toBe('parked');
  });

  it('parks a folded idea even when its status was not written', () => {
    expect(stageFor(item({ foldedInto: 'another' }), { attemptCeiling: CEILING })).toBe('parked');
  });

  // The distinction the whole board exists for: 32 of 79 shipped tools have
  // never been called, and `shipped` alone could not tell them apart.
  it('separates a shipped tool that is used from one that never was', () => {
    const shippedIdea = item({ status: 'shipped' });
    expect(stageFor(shippedIdea, { attemptCeiling: CEILING, tool: tool({ runCount: 12 }) })).toBe('live');
    expect(stageFor(shippedIdea, { attemptCeiling: CEILING, tool: tool({ runCount: 0 }) })).toBe('verifying');
  });

  it('treats a shipped feature with an open PR as unproven', () => {
    const withPr = item({ status: 'shipped', kind: 'feature', prUrl: 'https://github.com/x/y/pull/9' });
    expect(stageFor(withPr, { attemptCeiling: CEILING })).toBe('verifying');
  });

  it('calls a shipped item with no traceable artifact live rather than inventing one', () => {
    expect(stageFor(item({ status: 'shipped' }), { attemptCeiling: CEILING })).toBe('live');
  });
});

describe('stageFor at the attempt ceiling', () => {
  it('parks at the ceiling and builds below it', () => {
    expect(stageFor(item({ attempts: 3 }), { attemptCeiling: 4 })).toBe('building');
    expect(stageFor(item({ attempts: 4 }), { attemptCeiling: 4 })).toBe('parked');
    expect(stageFor(item({ attempts: 5 }), { attemptCeiling: 4 })).toBe('parked');
  });

  // The ceiling is injected rather than imported, so a change in backlog.ts
  // must reach the board. This is the test that would catch a copied constant.
  it('honours an injected ceiling that is not the default', () => {
    expect(stageFor(item({ attempts: 2 }), { attemptCeiling: 2 })).toBe('parked');
  });
});

describe('stageForCapability', () => {
  it('maps the ledger vocabulary onto the board', () => {
    expect(stageForCapability('proposed')).toBe('proposed');
    expect(stageForCapability('queued')).toBe('accepted');
    expect(stageForCapability('building')).toBe('building');
    expect(stageForCapability('shipped')).toBe('live');
    expect(stageForCapability('declined')).toBe('parked');
  });

  it('parks an unrecognised status rather than guessing a live one', () => {
    expect(stageForCapability('something-new')).toBe('parked');
  });
});

describe('canMove', () => {
  it('lets the owner accept and park', () => {
    expect(canMove('proposed', 'accepted')).toBe(true);
    expect(canMove('accepted', 'parked')).toBe(true);
    expect(canMove('parked', 'accepted')).toBe(true);
  });

  // A tool becomes live when jkai calls it. A board that let a person assert
  // that would be a board that lies.
  it('refuses every move into live', () => {
    for (const from of ['proposed', 'accepted', 'building', 'verifying', 'parked'] as const) {
      expect(canMove(from, 'live')).toBe(false);
    }
  });

  it('refuses moves into building and verifying, which are consequences not intentions', () => {
    expect(canMove('accepted', 'building')).toBe(false);
    expect(canMove('accepted', 'verifying')).toBe(false);
    expect(canMove('parked', 'building')).toBe(false);
  });

  it('refuses a move to the same stage', () => {
    expect(canMove('accepted', 'accepted')).toBe(false);
  });
});

describe('laneForKind and the new-data bias', () => {
  it('routes each kind to the builder that can actually make it', () => {
    expect(laneForKind('tool')).toBe('toolsmith');
    expect(laneForKind('source')).toBe('catalogue');
    expect(laneForKind('data_source')).toBe('catalogue');
    expect(laneForKind('watch')).toBe('monitor');
    expect(laneForKind('feature')).toBe('build');
    // A news source is a hardcoded union in the repo, so it is a code change.
    expect(laneForKind('news_source')).toBe('build');
    expect(laneForKind('engine')).toBe('engine');
  });

  it('flags only the kinds that bring a new series in', () => {
    expect(bringsNewData('source')).toBe(true);
    expect(bringsNewData('watch')).toBe(true);
    expect(bringsNewData('news_source')).toBe(true);
    expect(bringsNewData('tool')).toBe(false);
    expect(bringsNewData('feature')).toBe(false);
  });
});

describe('buildBoard', () => {
  it('joins a tool onto the idea it serves and reads its calls', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'paypal-transaction-history', title: 'PayPal transaction history tool', status: 'shipped' })],
      capabilities: [],
      tools: [tool({ name: 'paypal_transactions_recent', description: 'Recent PayPal transaction history', runCount: 16, errorCount: 2 })],
      attemptCeiling: CEILING,
    });
    const [only] = board.items;
    expect(only.artifact).toBe('paypal_transactions_recent');
    expect(only.calls).toBe(16);
    expect(only.errorRate).toBeCloseTo(0.125);
    expect(only.stage).toBe('live');
  });

  it('marks an open idea a shipped sibling already covers', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'shipped-one', title: 'Subscription renewal calendar reminders', status: 'shipped' }),
        item({ slug: 'open-one', title: 'Subscription renewal calendar for upcoming charges' }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    const open = board.items.find((i) => i.slug === 'open-one');
    expect(open?.alreadyServed).toBe(true);
    expect(open?.servedBy).toContain('Subscription renewal calendar');
    expect(board.totals.alreadyServed).toBe(1);
  });

  // The trap from reference_selfimprove_driver_link: short titles are mostly
  // generic words, and two shared ones used to claim finished work.
  it('does not call an idea served on generic word overlap alone', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'a', title: 'Live GOV.UK content search API', status: 'shipped' }),
        item({ slug: 'b', title: 'Live OpenRouter balance API' }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items.find((i) => i.slug === 'b')?.alreadyServed).toBe(false);
  });

  it('never double-counts a capability that already has a backlog item', () => {
    const cap: BoardCapability = {
      slug: 'data_source:met-office',
      kind: 'data_source',
      title: 'Met Office feed',
      need: 'no weather series',
      status: 'queued',
      score: 0.55,
      lane: 'source',
      outcome: null,
      outcomeRef: null,
      backlogSlug: 'met-office-feed',
      evidence: ['a question you asked'],
      lastSeenAt: '2026-09-04T00:00:00.000Z',
    };
    const board = buildBoard({
      backlog: [item({ slug: 'met-office-feed', title: 'Met Office feed', capabilitySlug: 'data_source:met-office' })],
      capabilities: [cap],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items).toHaveLength(1);
    expect(board.items[0].source).toBe('backlog');
  });

  it('shows a capability lead that no lane has picked up yet', () => {
    const cap: BoardCapability = {
      slug: 'watch:ebay-deals',
      kind: 'watch',
      title: 'Watch eBay saved searches',
      need: 'deals go unnoticed',
      status: 'proposed',
      score: 0.61,
      lane: 'watch',
      outcome: null,
      outcomeRef: null,
      backlogSlug: null,
      evidence: ['a question you asked'],
      lastSeenAt: '2026-09-04T00:00:00.000Z',
    };
    const board = buildBoard({ backlog: [], capabilities: [cap], tools: [], attemptCeiling: CEILING });
    expect(board.items).toHaveLength(1);
    expect(board.items[0].stage).toBe('proposed');
    expect(board.items[0].newData).toBe(true);
    // Ruling on a lead happens on the appetite board, which carries its score
    // decomposition and citations; the queue board must not duplicate that.
    expect(board.items[0].actionable).toBe(false);
  });

  it('keeps every open item when settled work is trimmed', () => {
    const backlog = [
      ...Array.from({ length: 5 }, (_, n) => item({ slug: `open-${n}`, title: `Open ${n}` })),
      ...Array.from({ length: 5 }, (_, n) =>
        item({ slug: `done-${n}`, title: `Done ${n}`, status: 'shipped', updatedAt: `2026-08-0${n + 1}T00:00:00.000Z` }),
      ),
    ];
    const board = buildBoard({ backlog, capabilities: [], tools: [], attemptCeiling: CEILING, settledLimit: 2 });
    expect(board.items.filter((i) => i.stage === 'accepted')).toHaveLength(5);
    expect(board.items.filter((i) => i.stage === 'live')).toHaveLength(2);
    // Totals describe the whole population, never the trimmed one — a number
    // on the page must not quietly name a smaller set than it says.
    expect(board.totals.all).toBe(10);
    expect(board.totals.settled).toBe(5);
  });
});

describe('summarise', () => {
  const mk = (over: Partial<WorkItem>): WorkItem =>
    ({
      id: 'x',
      source: 'backlog',
      slug: 'x',
      title: 'x',
      detail: '',
      kind: 'tool',
      lane: 'toolsmith',
      stage: 'accepted',
      priority: 2,
      attempts: 0,
      attemptCeiling: 4,
      createdAt: '',
      updatedAt: '',
      lastError: null,
      artifact: null,
      artifactHref: null,
      calls: null,
      errorRate: null,
      newData: false,
      alreadyServed: false,
      servedBy: null,
      foldedCount: 0,
      foldedInto: null,
      parkedReason: null,
      epicSlug: null,
      epicLabel: 'Unfiled',
      capabilitySlug: null,
      score: null,
      evidence: [],
      actionable: true,
      ...over,
    }) as WorkItem;

  // The measurement the room was missing: 280 of 352 open items at priority 2
  // means the field `pickWork` ranks on is not ranking anything.
  it('reports how much of the open queue is tied on one priority', () => {
    const items = [
      ...Array.from({ length: 8 }, () => mk({ priority: 2 })),
      mk({ priority: 1 }),
      mk({ priority: 5 }),
      mk({ priority: 2, stage: 'live' }),
    ];
    const t = summarise(items);
    expect(t.open).toBe(10);
    expect(t.tiedPriority).toBe(2);
    // The settled one is excluded — it is not competing for tonight's slots.
    expect(t.tiedOnPriority).toBe(8);
  });

  it('counts shipped-but-uncalled work', () => {
    const t = summarise([mk({ stage: 'verifying', calls: 0 }), mk({ stage: 'live', calls: 9 })]);
    expect(t.neverCalled).toBe(1);
  });
});

describe('epic grouping keys', () => {
  it('prefers an owner-set epic', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', epicSlug: 'epic:money' })],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items[0].epicSlug).toBe('epic:money');
    expect(board.items[0].epicLabel).toBe('Money');
  });

  it('falls back to the capability slug when no epic was set by hand', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', capabilitySlug: 'data_source:met-office' })],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items[0].epicSlug).toBe('cap:data_source:met-office');
  });

  it('leaves an unlinked item unfiled rather than inventing a group', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A' })],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items[0].epicSlug).toBeNull();
    expect(board.items[0].epicLabel).toBe('Unfiled');
  });
});

describe('filtering', () => {
  const base = buildBoard({
    backlog: [
      item({ slug: 'src', title: 'Met Office feed', kind: 'source' }),
      item({ slug: 'failed', title: 'Delivery tracking', lastError: 'HTTP 405', attempts: 1 }),
      item({ slug: 'plain', title: 'Something else' }),
    ],
    capabilities: [],
    tools: [],
    attemptCeiling: CEILING,
  }).items;

  it('matches everything with an empty filter', () => {
    expect(applyFilter(base, EMPTY_FILTER)).toHaveLength(3);
  });

  it('filters by lane', () => {
    expect(applyFilter(base, { ...EMPTY_FILTER, lanes: ['catalogue'] })).toHaveLength(1);
  });

  it('filters by query across title and detail', () => {
    expect(applyFilter(base, { ...EMPTY_FILTER, query: 'met office' })).toHaveLength(1);
    expect(applyFilter(base, { ...EMPTY_FILTER, query: 'nothing here' })).toHaveLength(0);
  });

  // AND, not OR: "brings new data" plus "never tried" should narrow to the
  // pile a reserved slot actually draws from.
  it('intersects flags rather than unioning them', () => {
    const both = applyFilter(base, { ...EMPTY_FILTER, flags: ['newdata', 'untried'] });
    expect(both.map((i) => i.slug)).toEqual(['src']);
    const failedAndNew = applyFilter(base, { ...EMPTY_FILTER, flags: ['newdata', 'failed'] });
    expect(failedAndNew).toHaveLength(0);
  });

  it('finds items with a recorded failure', () => {
    expect(matchesFilter(base.find((i) => i.slug === 'failed')!, { ...EMPTY_FILTER, flags: ['failed'] })).toBe(true);
    expect(matchesFilter(base.find((i) => i.slug === 'plain')!, { ...EMPTY_FILTER, flags: ['failed'] })).toBe(false);
  });
});

describe('sortForBoard', () => {
  it('leads on priority, then lifts a duplicate above a fresh idea', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'p5', title: 'Low priority thing', priority: 5 }),
        item({ slug: 'shipped', title: 'Subscription renewal calendar reminders', status: 'shipped' }),
        item({ slug: 'dupe', title: 'Subscription renewal calendar for upcoming charges', priority: 2 }),
        item({ slug: 'fresh', title: 'A brand new unrelated notion', priority: 2 }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    const open = sortForBoard(board.items.filter((i) => i.stage === 'accepted'));
    expect(open.map((i) => i.slug)).toEqual(['dupe', 'fresh', 'p5']);
  });
});

describe('artifactHref', () => {
  it('points a build ref at the build page and a monitor at the watches room', () => {
    expect(artifactHref('build:3f2a91c4')).toBe('/jkai/builds/3f2a91c4');
    expect(artifactHref('monitor:12')).toBe('/jkai/daydreams/watches');
    expect(artifactHref('https://github.com/x/y/pull/9')).toBe('https://github.com/x/y/pull/9');
  });

  it('returns null for a shape it does not recognise rather than a broken link', () => {
    expect(artifactHref('some_tool_name')).toBeNull();
    expect(artifactHref(null)).toBeNull();
  });
});

// ── Review fixes, 2026-09-04 ──────────────────────────────────────────────

describe('a shipped row cannot be dragged out of its stage', () => {
  // Parking writes `abandoned`, which on a shipped row erases the only field
  // saying it shipped; dragging it back would write `open` and hand an
  // already-built tool to `pickWork` a second time.
  it('offers no move at all from live or verifying', () => {
    expect(canMove('live', 'parked')).toBe(false);
    expect(canMove('live', 'accepted')).toBe(false);
    expect(canMove('verifying', 'parked')).toBe(false);
    expect(canMove('verifying', 'accepted')).toBe(false);
  });

  it('still lets open work be parked and put back', () => {
    expect(canMove('accepted', 'parked')).toBe(true);
    expect(canMove('building', 'parked')).toBe(true);
    expect(canMove('proposed', 'parked')).toBe(true);
    expect(canMove('parked', 'accepted')).toBe(true);
  });
});

describe('tool matching is confined to shipped ideas', () => {
  // Searching the whole backlog let an open restatement claim a live tool:
  // the card then read "706 calls · 63% errors" for work nothing had built,
  // and — first match wins — the genuinely shipped sibling lost its tool and
  // fell through to `live` instead of `verifying`, quietly deflating the
  // "shipped, never called" figure the board exists to expose.
  it('does not attach a live tool to a never-attempted open idea', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'open-one', title: 'Reliable reverse geocode and nearby places' }),
        item({ slug: 'shipped-one', title: 'Reverse geocode nearby places lookup', status: 'shipped' }),
      ],
      capabilities: [],
      tools: [
        tool({ name: 'reverse_geocode', description: 'reverse geocode nearby places lookup', runCount: 0, errorCount: 0 }),
      ],
      attemptCeiling: CEILING,
    });
    const open = board.items.find((i) => i.slug === 'open-one');
    const shipped = board.items.find((i) => i.slug === 'shipped-one');
    expect(open?.artifact).toBeNull();
    expect(open?.calls).toBeNull();
    expect(open?.stage).toBe('accepted');
    expect(shipped?.artifact).toBe('reverse_geocode');
    expect(shipped?.stage).toBe('verifying');
    expect(board.totals.neverCalled).toBe(1);
  });
});

describe('the untried flag agrees with the untried tile', () => {
  it('counts only open work, not leads or things abandoned before a try', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'fresh', title: 'A fresh idea' }),
        item({ slug: 'dropped', title: 'An abandoned idea', status: 'abandoned' }),
      ],
      capabilities: [
        {
          slug: 'watch:x',
          kind: 'watch',
          title: 'A lead',
          need: 'n',
          status: 'proposed',
          score: 0.6,
          lane: 'watch',
          outcome: null,
          outcomeRef: null,
          backlogSlug: null,
          evidence: [],
          lastSeenAt: '2026-09-04T00:00:00.000Z',
        },
      ],
      tools: [],
      attemptCeiling: CEILING,
    });
    const untried = applyFilter(board.items, { ...EMPTY_FILTER, flags: ['untried'] });
    // The abandoned row is excluded — it was never tried, but it is also not
    // waiting for anything. The lead counts: it is open work with no attempts.
    expect(untried.map((i) => i.slug).sort()).toEqual(['fresh', 'watch:x']);
    expect(untried.some((i) => i.slug === 'dropped')).toBe(false);
    // The chip and the tile sit inches apart on the same screen, so they must
    // count the same population. Before this they did not.
    expect(untried.length).toBe(board.totals.untried);
  });
});

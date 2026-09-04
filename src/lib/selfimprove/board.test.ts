import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  summariseInflow,
  coerceIntake,
  SOURCE_LABEL,
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
      intake: 'question',
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

  it('uses the theme label the owner accepted, not the slug digest', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', epicSlug: 'epic:3-1d9swp2' })],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
      epicLabels: { 'epic:3-1d9swp2': 'Live OpenRouter balance' },
    });
    expect(board.items[0].epicLabel).toBe('Live OpenRouter balance');
  });

  // An `epic:` slug carries only a member count and a digest, so with no
  // recorded label the honest thing is to read as an id — never to invent a name.
  it('falls back to the slug when no label was recorded', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', epicSlug: 'epic:3-1d9swp2' })],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items[0].epicLabel).toBe('3 1d9swp2');
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

// ── Inflow attribution ────────────────────────────────────────────────────

describe('intake channels', () => {
  it('carries the stamped channel through, and calls an unstamped row unattributed', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'a', title: 'A', source: 'question' }),
        item({ slug: 'b', title: 'B', source: 'doctor' }),
        // Written before the field existed. This is 455 rows on production.
        item({ slug: 'old', title: 'Old' }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    const by = new Map(board.items.map((i) => [i.slug, i]));
    expect(by.get('a')?.intake).toBe('question');
    expect(by.get('b')?.intake).toBe('doctor');
    expect(by.get('old')?.intake).toBe('unattributed');
  });

  // A capability lead IS a channel; it did not arrive through one.
  it('gives a capability lead no channel at all', () => {
    const board = buildBoard({
      backlog: [],
      capabilities: [
        {
          slug: 'watch:x', kind: 'watch', title: 'A lead', need: 'n', status: 'proposed',
          score: 0.6, lane: 'watch', outcome: null, outcomeRef: null, backlogSlug: null,
          evidence: [], lastSeenAt: '2026-09-04T00:00:00.000Z',
        },
      ],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(board.items[0].intake).toBeNull();
    // And it never matches a channel filter, rather than matching all of them.
    expect(applyFilter(board.items, { ...EMPTY_FILTER, sources: ['appetite'] })).toHaveLength(0);
  });

  it('filters the board by channel', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'a', title: 'A', source: 'question' }),
        item({ slug: 'b', title: 'B', source: 'fault' }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    expect(applyFilter(board.items, { ...EMPTY_FILTER, sources: ['question'] }).map((i) => i.slug)).toEqual(['a']);
    expect(applyFilter(board.items, { ...EMPTY_FILTER, sources: ['question', 'fault'] })).toHaveLength(2);
  });

  it('names every channel in the closed set', () => {
    for (const s of ['question', 'fault', 'doctor', 'starved', 'health', 'appetite', 'engine', 'toolsmith', 'trace', 'unattributed'] as const) {
      expect(SOURCE_LABEL[s].label.length).toBeGreaterThan(0);
      expect(SOURCE_LABEL[s].from.length).toBeGreaterThan(0);
    }
  });
});

describe('summariseInflow', () => {
  const NOW = Date.parse('2026-09-04T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

  it('counts each channel, and reports the drain against the intake', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'q1', title: 'Q1', source: 'question', createdAt: daysAgo(3) }),
        item({ slug: 'q2', title: 'Q2', source: 'question', createdAt: daysAgo(5) }),
        item({ slug: 'f1', title: 'F1', source: 'fault', createdAt: daysAgo(2) }),
        // Settled inside the window — one drained against three in.
        item({ slug: 'd1', title: 'D1', source: 'question', status: 'abandoned', createdAt: daysAgo(80), updatedAt: daysAgo(1) }),
      ],
      capabilities: [],
      tools: [],
      attemptCeiling: CEILING,
    });
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.intake).toBe(3);
    expect(flow.drained).toBe(1);
    expect(flow.standing).toBe(3);
    expect(flow.ratio).toBe(3);
    const q = flow.channels.find((c) => c.source === 'question');
    expect(q?.total).toBe(3);
    expect(q?.open).toBe(2);
    expect(q?.recent).toBe(2);
  });

  it('reports no ratio rather than dividing by nothing', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', source: 'question', createdAt: daysAgo(1) })],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    expect(summariseInflow(board.items, 30, NOW).ratio).toBeNull();
  });

  it('omits a channel nothing arrived through, rather than listing a zero', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', source: 'question' })],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.channels.map((c) => c.source)).toEqual(['question']);
  });

  // A gap in the record is not a source, however big it is.
  it('sorts the unattributed pile last however large it is', () => {
    const board = buildBoard({
      backlog: [
        ...Array.from({ length: 20 }, (_, n) => item({ slug: `old${n}`, title: `Old ${n}`, createdAt: daysAgo(1) })),
        item({ slug: 'q', title: 'Q', source: 'question', createdAt: daysAgo(1) }),
      ],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.channels[flow.channels.length - 1].source).toBe('unattributed');
    expect(flow.unattributed).toBe(20);
  });

  it('leaves capability leads out of the flow arithmetic entirely', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', source: 'question', createdAt: daysAgo(1) })],
      capabilities: [
        {
          slug: 'watch:x', kind: 'watch', title: 'A lead', need: 'n', status: 'proposed',
          score: 0.6, lane: 'watch', outcome: null, outcomeRef: null, backlogSlug: null,
          evidence: [], lastSeenAt: '2026-09-04T00:00:00.000Z',
        },
      ],
      tools: [], attemptCeiling: CEILING,
    });
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.intake).toBe(1);
    expect(flow.standing).toBe(1);
  });
});

// ── The purity this module depends on ─────────────────────────────────────

describe('board.ts stays importable from a .svelte file', () => {
  // `types.ts` value-imports `$lib/toolpolicy/policy`, which reaches `$lib/db`
  // and `$env/dynamic/private`. A VALUE import of it from here fails the BUILD
  // while `svelte-check` passes clean with zero errors — which is exactly what
  // happened when `IDEA_SOURCES` was first declared in `types.ts`, and cost a
  // full remote gate to find. `import type` is erased and always fine.
  const src = readFileSync(new URL('./board.ts', import.meta.url), 'utf8');

  it('imports nothing from ./types as a value', () => {
    const lines = src.split('\n').filter((l) => l.includes("from './types'"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.trimStart().startsWith('import type')).toBe(true);
  });

  it('imports only from ./narrative and ./types at all', () => {
    const imported = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(imported)].sort()).toEqual(['./narrative', './types']);
  });
});

// ── Review fixes, 2026-09-04 ──────────────────────────────────────────────

describe('inflow is computed over the whole population', () => {
  const NOW = Date.parse('2026-09-04T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

  // The same mistake `summarise` was already written to avoid: anything
  // counted AFTER `trimSettled` describes a smaller set than it names.
  // `channel.total` would print "everything ever queued" off a list missing
  // most settled rows, and `drained` would saturate at the cap — making the
  // published ratio read worse than reality.
  it('counts settled rows the board trimmed away', () => {
    const backlog = [
      ...Array.from({ length: 8 }, (_, n) =>
        item({
          slug: `done${n}`,
          title: `Done ${n}`,
          source: 'question',
          status: 'shipped',
          createdAt: daysAgo(40),
          updatedAt: daysAgo(2),
        }),
      ),
      item({ slug: 'open1', title: 'Open one', source: 'question', createdAt: daysAgo(1) }),
    ];
    const board = buildBoard({ backlog, capabilities: [], tools: [], attemptCeiling: CEILING, settledLimit: 2 });
    // The board itself is trimmed…
    expect(board.items.filter((i) => i.backlogStatus === 'shipped')).toHaveLength(2);
    // …and the inflow is not.
    const q = board.inflow.channels.find((c) => c.source === 'question');
    expect(q?.total).toBe(9);
    expect(board.inflow.drained).toBe(8);
  });

  it('is carried on the view rather than left to the component', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', source: 'fault' })],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    expect(board.inflow.channels.map((c) => c.source)).toEqual(['fault']);
  });
});

describe('drained counts what actually settled', () => {
  const NOW = Date.parse('2026-09-04T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

  // `stageFor` returns `parked` for an item out of attempts while its status
  // is still `open`, and every failed attempt bumps `updatedAt`. Counting off
  // the stage called an item the engine tried and failed on three nights
  // running "drained", and took it out of the standing queue. Backwards.
  it('does not call an attempt-exhausted open item drained', () => {
    const board = buildBoard({
      backlog: [
        item({
          slug: 'stuck',
          title: 'Tried and failed',
          source: 'question',
          status: 'open',
          attempts: CEILING,
          createdAt: daysAgo(20),
          updatedAt: daysAgo(1),
        }),
      ],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    // It derives to `parked` on the board, which is right — it is out of tries.
    expect(board.items[0].stage).toBe('parked');
    // But it has not left the queue.
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.drained).toBe(0);
    expect(flow.standing).toBe(1);
    expect(flow.channels[0].open).toBe(1);
  });

  it('still counts a genuinely abandoned item as drained', () => {
    const board = buildBoard({
      backlog: [
        item({ slug: 'gone', title: 'Parked', source: 'question', status: 'abandoned', createdAt: daysAgo(20), updatedAt: daysAgo(1) }),
      ],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    const flow = summariseInflow(board.items, 30, NOW);
    expect(flow.drained).toBe(1);
    expect(flow.standing).toBe(0);
  });
});

describe('coerceIntake', () => {
  it('keeps a known channel', () => {
    expect(coerceIntake('doctor')).toBe('doctor');
  });

  // A row edited by hand, restored from a dump, or left by a renamed channel
  // would otherwise be counted in the totals, shown in no cell, and
  // unreachable by the filter — so the cells stopped summing to the total.
  it('calls anything else a gap in the record, not a tenth channel', () => {
    expect(coerceIntake('made-up')).toBe('unattributed');
    expect(coerceIntake(undefined)).toBe('unattributed');
    expect(coerceIntake(42)).toBe('unattributed');
  });

  it('is applied on read, so an off-vocabulary row still lands in a cell', () => {
    const board = buildBoard({
      backlog: [item({ slug: 'a', title: 'A', source: 'renamed-channel' as never })],
      capabilities: [], tools: [], attemptCeiling: CEILING,
    });
    expect(board.items[0].intake).toBe('unattributed');
    const total = board.inflow.channels.reduce((n, c) => n + c.total, 0);
    expect(total).toBe(board.items.length);
  });
});

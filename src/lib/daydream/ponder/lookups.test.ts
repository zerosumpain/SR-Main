import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DaydreamSnapshot } from '../snapshot-types';

vi.mock('$lib/workflows/site-tools/registry', () => ({ executeTool: vi.fn() }));

import { executeTool } from '$lib/workflows/site-tools/registry';
import { runLookups, namedTerms, READ_PROBES, MAX_LOOKUPS_PER_CYCLE } from './lookups';

/** The three snapshot fields the probes actually read, and nothing else — a
 *  fixture that mirrors the whole snapshot rots every time the snapshot grows. */
function snap(over: Partial<DaydreamSnapshot> = {}): DaydreamSnapshot {
  return {
    places: [],
    memories: [],
    emailFacts: { available: true, upcoming: [], recent: [] },
    spend: { available: true, recent: [], totalMinor30d: 0 },
    ...over,
  } as unknown as DaydreamSnapshot;
}

const ok = (data: unknown) => ({ success: true, data });

beforeEach(() => vi.clearAllMocks());

describe('namedTerms', () => {
  it('pulls proper nouns out of a diary title', () => {
    expect(namedTerms('Dentist appointment at Riverside Dental')).toContain('Riverside Dental');
  });

  it('drops a title that is only common words', () => {
    expect(namedTerms('payment due tomorrow')).toEqual([]);
  });

  it('does not return a bare stop word that happens to start a sentence', () => {
    expect(namedTerms('Payment due')).toEqual([]);
  });

  it('deduplicates', () => {
    expect(namedTerms('Vodafone bill and Vodafone renewal')).toEqual(['Vodafone']);
  });
});

describe('the allow-list', () => {
  it('contains no tool that returns text somebody else wrote', () => {
    // A lookup result becomes prompt context. A probe over a fetched page or a
    // raw email body is a prompt injection with a card id attached.
    const banned = ['fetch_url', 'research_web_search', 'mail_read', 'browser_navigate', 'gmail_get_message'];
    for (const p of READ_PROBES) expect(banned).not.toContain(p.tool);
  });

  it('contains no tool that writes', () => {
    const writes = [
      'ha_call_service', 'workflow_run', 'build_create', 'blog_create',
      'datastore_save', 'save_memory', 'gmail_send', 'whatsapp_send', 'publish_page',
    ];
    for (const p of READ_PROBES) expect(writes).not.toContain(p.tool);
  });
});

describe('runLookups', () => {
  it('asks the graph about a name the week ahead contains', async () => {
    vi.mocked(executeTool).mockResolvedValue(
      ok({ entities: [{ id: 'e1', name: 'Riverside Dental', type: 'organisation', degree: 4 }] }) as never,
    );
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [{ title: 'Checkup at Riverside Dental', whenText: '2026-09-02 09:00', location: null }],
    });
    expect(executeTool).toHaveBeenCalledWith('intel_find', expect.objectContaining({ query: 'Riverside Dental' }));
    expect(run.cards[0].text).toContain('Riverside Dental');
  });

  it('cites with an existing evidence kind so the drill-through resolves', async () => {
    // 'intel-entity' and 'memory' already have resolvers in evidence.ts. A new
    // ref kind would render as an unresolvable id and call it evidence.
    vi.mocked(executeTool).mockResolvedValue(
      ok({ entities: [{ id: 'e1', name: 'Acme Ltd', type: 'organisation' }] }) as never,
    );
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [{ title: 'Call with Acme Ltd', whenText: 'x', location: null }],
    });
    expect(run.cards.every((c) => ['intel-entity', 'memory'].includes(c.ref.kind))).toBe(true);
  });

  it('does not ask the GRAPH about a name the pack already explains', async () => {
    // The memory probe deliberately still asks — "what do I know about this
    // thing that is happening" is the question it exists for, and a place
    // having a label says nothing about what he has recorded about it.
    const run = await runLookups({
      snapshot: snap({
        places: [{ label: 'Riverside Dental' }] as unknown as DaydreamSnapshot['places'],
      }),
      weekAhead: [{ title: 'Checkup at Riverside Dental', whenText: 'x', location: null }],
    });
    const graphQueries = vi
      .mocked(executeTool)
      .mock.calls.filter((c) => c[0] === 'intel_find')
      .map((c) => (c[1] as { query?: string }).query);
    expect(graphQueries).not.toContain('Riverside Dental');
  });

  it('does not spend a lookup on the common noun a title starts with', () => {
    // "Checkup at Riverside Dental" matches the capitalised-word pattern
    // twice; only one of them is a thing to look up.
    expect(namedTerms('Checkup at Riverside Dental')).toEqual(['Riverside Dental']);
    // ...but a title whose only candidate is a single word keeps it.
    expect(namedTerms('Vodafone bill')).toEqual(['Vodafone']);
  });

  it('searches memories by what is in play, not by recency', async () => {
    vi.mocked(executeTool).mockImplementation((async (tool: string) =>
      tool === 'memory_search'
        ? ok({ memories: [{ id: 'm1', category: 'billing', content: 'Vodafone contract ends in March' }] })
        : ok({ entities: [] })) as never);
    const run = await runLookups({
      snapshot: snap({
        spend: {
          available: true,
          totalMinor30d: 0,
          recent: [{ id: 's1', day: '2026-08-29', merchant: 'Vodafone', amountMinor: 3200, currency: 'GBP' }],
        },
      }),
      weekAhead: [],
    });
    expect(executeTool).toHaveBeenCalledWith('memory_search', expect.objectContaining({ query: 'Vodafone' }));
    expect(run.cards.some((c) => c.ref.kind === 'memory' && c.text.includes('Vodafone'))).toBe(true);
  });

  it('never spends more than its budget', async () => {
    vi.mocked(executeTool).mockResolvedValue(ok({ entities: [], memories: [] }) as never);
    const many = Array.from({ length: 12 }, (_, n) => ({
      title: `Meeting with Company${String.fromCharCode(65 + n)}ltd`,
      whenText: 'x',
      location: null,
    }));
    const run = await runLookups({ snapshot: snap(), weekAhead: many }, { budget: 2 });
    expect(vi.mocked(executeTool).mock.calls).toHaveLength(2);
    expect(run.asked).toHaveLength(2);
  });

  it('gives every probe a turn rather than draining the first', async () => {
    // Two probes with three gaps each and a budget of two must not mean the
    // second probe never runs.
    vi.mocked(executeTool).mockResolvedValue(ok({ entities: [], memories: [] }) as never);
    await runLookups(
      {
        snapshot: snap({
          spend: {
            available: true,
            totalMinor30d: 0,
            recent: [{ id: 's1', day: 'x', merchant: 'Vodafone', amountMinor: 1, currency: 'GBP' }],
          },
        }),
        weekAhead: [
          { title: 'Call with Acme Ltd', whenText: 'x', location: null },
          { title: 'Visit Beta Corp', whenText: 'x', location: null },
        ],
      },
      { budget: 2 },
    );
    const tools = vi.mocked(executeTool).mock.calls.map((c) => c[0]);
    expect(new Set(tools).size).toBe(2);
  });

  it('a budget of zero makes no calls at all', async () => {
    const run = await runLookups(
      { snapshot: snap(), weekAhead: [{ title: 'Call with Acme Ltd', whenText: 'x', location: null }] },
      { budget: 0 },
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(run.cards).toEqual([]);
  });

  it('survives a tool that fails, and counts it', async () => {
    vi.mocked(executeTool).mockResolvedValue({ success: false, error: 'graph rebuilding' } as never);
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [{ title: 'Call with Acme Ltd', whenText: 'x', location: null }],
    });
    expect(run.failed).toBeGreaterThan(0);
    expect(run.cards).toEqual([]);
  });

  it('survives a tool that throws', async () => {
    vi.mocked(executeTool).mockRejectedValue(new Error('boom'));
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [{ title: 'Call with Acme Ltd', whenText: 'x', location: null }],
    });
    expect(run.failed).toBeGreaterThan(0);
    expect(run.cards).toEqual([]);
  });

  it('ignores a malformed row rather than carding an undefined', async () => {
    vi.mocked(executeTool).mockResolvedValue(
      ok({ entities: [{ name: 'no id here' }, { id: 'e2', name: 'Fine Ltd', type: 'organisation' }] }) as never,
    );
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [{ title: 'Call with Acme Ltd', whenText: 'x', location: null }],
    });
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0].ref.id).toBe('e2');
  });

  it('does not card the same row twice', async () => {
    vi.mocked(executeTool).mockResolvedValue(
      ok({ entities: [{ id: 'same', name: 'Acme Ltd', type: 'organisation' }] }) as never,
    );
    const run = await runLookups({
      snapshot: snap(),
      weekAhead: [
        { title: 'Call with Acme Ltd', whenText: 'x', location: null },
        { title: 'Dinner with Beta Corp', whenText: 'x', location: null },
      ],
    });
    expect(run.cards.filter((c) => c.ref.id === 'same')).toHaveLength(1);
  });

  it('defaults to a budget small enough not to dominate the cycle', () => {
    expect(MAX_LOOKUPS_PER_CYCLE).toBeLessThanOrEqual(8);
  });
});

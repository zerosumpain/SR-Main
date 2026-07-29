import { describe, it, expect } from 'vitest';
import { ftsMatchLiteral, isValidSessionId, convIdFromUserId, clampDays } from './hermes-sessions';

describe('hermes-sessions: session id validation (SQL-interp safety)', () => {
  it('accepts the real Hermes id format', () => {
    expect(isValidSessionId('20260601_161404_54636e66')).toBe(true);
  });
  it('rejects anything outside the safe charset', () => {
    expect(isValidSessionId("20260601_161404_54636e66' OR '1'='1")).toBe(false);
    expect(isValidSessionId('../../etc/passwd')).toBe(false);
    expect(isValidSessionId('20260601_161404_ZZZZZZZZ')).toBe(false); // non-hex
    expect(isValidSessionId('20260601_161404_54636e6')).toBe(false); // 7 hex, too short
    expect(isValidSessionId('')).toBe(false);
  });
});

describe('hermes-sessions: conversation correlation', () => {
  it('extracts the jkai conversation id from a session user_id', () => {
    const uid = 'sess_cbeee365-999d-4c0d-aa53-678376576b56_chat_cbeee365-999d-4c0d-aa53-678376576b56';
    expect(convIdFromUserId(uid)).toBe('cbeee365-999d-4c0d-aa53-678376576b56');
  });
  it('returns null for non-jkai / empty user_ids', () => {
    expect(convIdFromUserId(null)).toBeNull();
    expect(convIdFromUserId('')).toBeNull();
    expect(convIdFromUserId('telegram_12345')).toBeNull();
  });
});

describe('hermes-sessions: FTS match literal (injection + FTS safety)', () => {
  it('phrase-wraps a simple query', () => {
    expect(ftsMatchLiteral('calendar')).toBe(`'"calendar"'`);
  });
  it('doubles single-quotes so input can never break out of the SQL literal', () => {
    expect(ftsMatchLiteral("o'brien")).toBe(`'"o''brien"'`);
    expect(ftsMatchLiteral("x' OR 1=1 --")).toBe(`'"x'' OR 1=1 --"'`);
  });
  it('doubles double-quotes so input is a literal FTS phrase, not operators', () => {
    expect(ftsMatchLiteral('say "hi"')).toBe(`'"say ""hi"""'`);
  });
});

describe('hermes-sessions: clampDays (telemetry window)', () => {
  it('clamps to 1..365 and falls back on junk', () => {
    expect(clampDays(30)).toBe(30);
    expect(clampDays('7')).toBe(7);
    expect(clampDays(0)).toBe(30); // falsy → fallback
    expect(clampDays(-5)).toBe(1);
    expect(clampDays(99999)).toBe(365);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays(null)).toBe(30);
    expect(clampDays(undefined)).toBe(30);
  });
});

// ── Call efficiency (self-improvement prime outcome) ─────────────────────────
import { aggregateTurnEfficiency, type TurnRow } from './hermes-sessions';

/** Build one assistant row's `tool_calls` JSON. */
function row(session: string, turn: number, calls: Array<[string, unknown]>): TurnRow {
  return {
    session_id: session,
    turn,
    tool_calls: JSON.stringify(
      calls.map(([name, args]) => ({ function: { name, arguments: JSON.stringify(args) } })),
    ),
  };
}

describe('call efficiency: turn segmentation', () => {
  it('counts calls per turn and means over ALL turns including silent ones', () => {
    const rows = [row('s1', 1, [['fetch_url', { u: 'a' }], ['fetch_url', { u: 'b' }]])];
    // 3 turns existed; only one made calls, so two contribute 0.
    const e = aggregateTurnEfficiency(rows, 3, 30);
    expect(e.chat.turns).toBe(3);
    expect(e.chat.totalCalls).toBe(2);
    expect(e.chat.zeroToolTurns).toBe(2);
    expect(e.chat.meanCalls).toBeCloseTo(0.67, 2);
  });

  it('routes browser/terminal turns to the agentic segment, never to chat patterns', () => {
    const rows = [
      row('s1', 1, [['browser_navigate', { url: 'a' }], ['browser_navigate', { url: 'b' }]]),
      row('s2', 1, [['fetch_url', { u: 'a' }], ['fetch_url', { u: 'b' }]]),
    ];
    const e = aggregateTurnEfficiency(rows, 2, 30);
    expect(e.agentic.turns).toBe(1);
    expect(e.agentic.repeatCalls).toBe(1);
    expect(e.chat.turns).toBe(1);
    // Only the chat turn's repetition becomes a work item.
    expect(e.patterns.map((p) => p.tool)).toEqual(['fetch_url']);
  });

  it('resolves jkai_extended invocations to the real sub-tool', () => {
    const rows = [
      row('s1', 1, [
        ['mcp_jkai_jkai_extended', { operation: 'invoke', name: 'ha_query_state' }],
        ['mcp_jkai_jkai_extended', { operation: 'invoke', name: 'ha_query_state' }],
      ]),
    ];
    const e = aggregateTurnEfficiency(rows, 1, 30);
    expect(e.patterns[0].tool).toBe('jkai:ha_query_state');
    expect(e.patterns[0].repeatCalls).toBe(1);
  });

  it('excludes list/schema discovery from work counts but reports it', () => {
    const rows = [
      row('s1', 1, [
        ['mcp_jkai_jkai_extended', { operation: 'list' }],
        ['mcp_jkai_jkai_extended', { operation: 'schema', name: 'x' }],
        ['mcp_jkai_jkai_extended', { operation: 'invoke', name: 'x' }],
      ]),
    ];
    const e = aggregateTurnEfficiency(rows, 1, 30);
    expect(e.discoveryCalls).toBe(2);
    expect(e.chat.totalCalls).toBe(1);
  });
});

describe('call efficiency: repeat vs duplicate pressure', () => {
  it('separates same-tool repeats from byte-identical duplicates', () => {
    const rows = [
      row('s1', 1, [
        ['fetch_url', { u: 'a' }],
        ['fetch_url', { u: 'b' }], // repeat, different args
        ['fetch_url', { u: 'b' }], // repeat AND exact duplicate
      ]),
    ];
    const e = aggregateTurnEfficiency(rows, 1, 30);
    expect(e.chat.repeatCalls).toBe(2);
    expect(e.chat.duplicateCalls).toBe(1);
    expect(e.patterns[0].worstInOneTurn).toBe(3);
  });

  it('ranks patterns by the calls a perfect batch would have removed', () => {
    const rows = [
      row('s1', 1, [['a_tool', {}], ['a_tool', {}]]),
      row('s2', 1, [['b_tool', { i: 1 }], ['b_tool', { i: 2 }], ['b_tool', { i: 3 }], ['b_tool', { i: 4 }]]),
    ];
    const e = aggregateTurnEfficiency(rows, 2, 30);
    expect(e.patterns[0].tool).toBe('b_tool');
    expect(e.patterns[0].repeatCalls).toBe(3);
    expect(e.patterns[1].repeatCalls).toBe(1);
  });

  it('a turn that calls each tool once has no repeat pressure', () => {
    const rows = [row('s1', 1, [['a', {}], ['b', {}], ['c', {}]])];
    const e = aggregateTurnEfficiency(rows, 1, 30);
    expect(e.chat.repeatCalls).toBe(0);
    expect(e.patterns).toHaveLength(0);
  });

  it('survives malformed tool_calls rows rather than throwing', () => {
    const rows: TurnRow[] = [
      { session_id: 's1', turn: 1, tool_calls: 'not json' },
      row('s1', 2, [['ok_tool', {}]]),
    ];
    const e = aggregateTurnEfficiency(rows, 2, 30);
    expect(e.chat.totalCalls).toBe(1);
  });
});

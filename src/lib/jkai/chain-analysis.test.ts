import { describe, expect, it } from 'vitest';
import type { ToolTrace, TraceStep } from './tool-trace';
import {
  analyseChain,
  buildAnalysisMessages,
  coerceFindings,
  findingToIdea,
  isDiscoveryStep,
  isLadder,
  resolveStepTool,
  routeCandidates,
  schemaSupportsBatching,
  type ChainAnalysis,
} from './chain-analysis';

function step(tool: string, args: Record<string, unknown> = {}): TraceStep {
  return {
    seq: 0, toolCallId: '', tool, displayTool: tool,
    category: 'TOOL' as TraceStep['category'], args, status: 'done',
    startedAt: 0, offsetMs: 0,
  };
}
/** A jkai dispatch, the shape the recorder actually stores. */
function jkai(operation: string, name: string, args: Record<string, unknown> = {}): TraceStep {
  return step('mcp_jkai_jkai_extended', { operation, name, ...(operation === 'invoke' ? { args } : {}) });
}
/** Numbers the chain here, so a fixture's step positions do not depend on how
 *  many fixtures were built before it. */
function trace(input: TraceStep[]): ToolTrace {
  const steps = input.map((s, i) => ({ ...s, seq: i + 1, toolCallId: `call_${i + 1}`, startedAt: 1_000 + i, offsetMs: i * 10 }));
  return {
    version: 1, steps, subAgents: [], stepCount: steps.length, errorCount: 0,
    droppedSteps: 0, payloadsDropped: 0,
    startedAt: 1_000, endedAt: 2_000, durationMs: 1_000,
  };
}

describe('resolving what a step actually exercised', () => {
  it('unwraps the jkai dispatcher to the tool underneath', () => {
    expect(resolveStepTool(jkai('invoke', 'gmail_search', { query: 'x' }))).toEqual({ tool: 'gmail_search', operation: 'invoke' });
    expect(resolveStepTool(jkai('schema', 'apple_calendar_list'))).toEqual({ tool: 'apple_calendar_list', operation: 'schema' });
    // A finding against `jkai_extended` would be useless — there is one of it
    // and it is never the thing to change.
    expect(resolveStepTool(step('web_search', { query: 'x' }))).toEqual({ tool: 'web_search' });
  });

  it('counts list/schema as discovery and invoke as work', () => {
    expect(isDiscoveryStep(jkai('list', ''))).toBe(true);
    expect(isDiscoveryStep(jkai('schema', 'gmail_search'))).toBe(true);
    expect(isDiscoveryStep(jkai('invoke', 'gmail_search', { query: 'x' }))).toBe(false);
    expect(isDiscoveryStep(step('skill_view', { name: 'jkai-gmail' }))).toBe(true);
    expect(isDiscoveryStep(step('tool_describe', { name: 'x' }))).toBe(true);
    expect(isDiscoveryStep(step('web_search', { query: 'x' }))).toBe(false);
  });
});

describe('ladders are a different shape from repeats', () => {
  it('sees a ladder when each call carries strictly more arguments', () => {
    expect(isLadder([
      jkai('invoke', 'apple_calendar_list', {}),
      jkai('invoke', 'apple_calendar_list', { credentialId: 'c' }),
      jkai('invoke', 'apple_calendar_list', { credentialId: 'c', calendar: '/a/', dateRangeStart: 's', dateRangeEnd: 'e' }),
    ])).toBe(true);
  });

  it('does not call the same-shaped call with different values a ladder', () => {
    // Three searches with different queries are a repeat, not a discovery
    // ladder — and the fix for the two is different, so the distinction has
    // to survive.
    expect(isLadder([
      jkai('invoke', 'gmail_search', { query: 'a' }),
      jkai('invoke', 'gmail_search', { query: 'b' }),
      jkai('invoke', 'gmail_search', { query: 'c' }),
    ])).toBe(false);
  });
});

describe('the 2026-08-15 calendar turn', () => {
  // Replayed from the Hermes session store, session 20260815_075854_5d8bd7c2:
  // "check my family apple calendar, what dates are in for 'date day' with
  // katie and john" — ten calls, and it answered nothing.
  const cal = '/calendars/family-calendar/';
  const chain = trace([
    step('skill_view', { name: 'google-workspace' }),
    jkai('list', '', {}),
    jkai('list', '', {}),
    jkai('schema', 'apple_calendar_list'),
    jkai('invoke', 'apple_calendar_list', {}),
    jkai('invoke', 'apple_calendar_list', { credentialId: 'cred' }),
    jkai('invoke', 'apple_calendar_list', { credentialId: 'cred', calendar: '/calendars/family-a/', dateRangeStart: 's', dateRangeEnd: 'e' }),
    jkai('invoke', 'apple_calendar_list', { credentialId: 'cred', calendar: '/calendars/family-b/', dateRangeStart: 's', dateRangeEnd: 'e' }),
    jkai('invoke', 'apple_calendar_list', { credentialId: 'cred', calendar: cal, dateRangeStart: 's', dateRangeEnd: 'e' }),
    jkai('invoke', 'apple_calendar_list', { credentialId: 'cred', calendar: cal, dateRangeStart: 's2', dateRangeEnd: 'e2' }),
  ]);

  it('reports the ladder, with the calls counted rather than guessed', () => {
    const analysis = analyseChain(chain);
    expect(analysis.calls).toBe(10);
    // skill_view + 2 list + 1 schema.
    expect(analysis.discoveryCalls).toBe(4);

    const ladder = analysis.signals.find((s) => s.tool === 'apple_calendar_list');
    expect(ladder).toMatchObject({ kind: 'ladder', calls: 6, identicalCalls: 0 });
    expect(ladder?.steps).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('is exactly the finding the review said it must produce', () => {
    const analysis = analyseChain(chain);
    const findings = coerceFindings(
      { findings: [{ kind: 'ladder', tool: 'apple_calendar_list', couldHaveBeen: 1, fix: 'tool_change', rationale: 'Credential and calendar discovery should be defaults, not calls.' }] },
      analysis,
      new Set(['apple_calendar_list']),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'ladder', tool: 'apple_calendar_list', calls: 6, couldHaveBeen: 1, fix: 'tool_change' });
  });
});

describe('the 2026-08-16 PayPal turn', () => {
  // Session 20260816_064520_766fde57, first turn: "i recently paid for vpn
  // services through paypal, what was the company called?" — answered from a
  // 2018 Gmail receipt, wrongly, while a paypal-transactions integration sat
  // one call away.
  const chain = trace([
    step('skill_view', { name: 'jkai-gmail' }),
    step('tool_describe', { name: 'mcp__jkai__jkai_extended' }),
    jkai('schema', 'gmail_list_accounts'),
    jkai('invoke', 'gmail_list_accounts', {}),
    jkai('schema', 'gmail_search'),
    jkai('invoke', 'gmail_search', { query: '(paypal) (vpn)', accountId: 2 }),
    jkai('invoke', 'gmail_search', { query: 'from:(paypal) newer_than:1y', accountId: 2 }),
    jkai('invoke', 'gmail_search', { query: 'from:(paypal) (nord OR mullvad)', accountId: 2 }),
  ]);
  const registry = [
    { name: 'gmail_search', description: 'Search a connected Gmail mailbox using Gmail query syntax.' },
    { name: 'api_integration_call', description: 'Call a recorded integration and get its named outputs — the cheapest way to answer a question an integration already covers, such as PayPal transactions or bank payments.' },
    { name: 'api_integration_list', description: 'List the recorded API integrations — the register of named, reusable API calls.' },
    { name: 'blog_create_post', description: 'Draft a blog post.' },
    { name: 'delete_tool', description: 'Delete a stored PayPal-adjacent custom tool.' },
  ];

  it('measures the discovery tax on a turn that answered wrongly', () => {
    const analysis = analyseChain(chain, registry);
    expect(analysis.calls).toBe(8);
    // skill_view + tool_describe + 2 schema.
    expect(analysis.discoveryCalls).toBe(4);
    expect(analysis.discoveryShare).toBe(0.5);
    expect(analysis.signals.find((s) => s.tool === 'gmail_search')).toMatchObject({ kind: 'repeat', calls: 3 });
  });

  it('offers the route the question points at, not the one the tool resembles', () => {
    const called = new Set(['gmail_search', 'gmail_list_accounts']);
    const candidates = routeCandidates('i recently paid for vpn services through paypal, what was the company called?', registry, called);
    // `api_integration_call` is nothing like `gmail_search`; it is like the
    // words the user typed, which is the whole point of scoring the question.
    expect(candidates.map((c) => c.name)).toContain('api_integration_call');
    expect(candidates.map((c) => c.name)).not.toContain('gmail_search');
    // Never advertise a destructive tool as a cheaper route.
    expect(candidates.map((c) => c.name)).not.toContain('delete_tool');
  });

  it('is exactly the finding the review said it must produce', () => {
    const analysis = analyseChain(chain, registry);
    const findings = coerceFindings(
      { findings: [{ kind: 'wrong_source', tool: 'gmail_search', couldHaveBeen: 1, cheaperRoute: 'api_integration_call', fix: 'prompt', rationale: 'A payment question is answered from the payment rail, not the inbox.' }] },
      analysis,
      new Set(registry.map((r) => r.name)),
    );
    expect(findings[0]).toMatchObject({ kind: 'wrong_source', tool: 'gmail_search', calls: 3, cheaperRoute: 'api_integration_call', fix: 'prompt' });
  });
});

describe('the registry gets the last word', () => {
  const analysis: ChainAnalysis = {
    calls: 12,
    discoveryCalls: 4,
    discoveryShare: 1 / 3,
    signals: [{ kind: 'repeat', tool: 'fetch_url', calls: 9, identicalCalls: 1, steps: [1, 2, 3], detail: 'measured' }],
  };
  const registered = new Set(['fetch_url', 'research_web_search']);

  it('drops a cheaperRoute the model invented', () => {
    // `search_web` does not exist; all three of optimise.ts's early trial runs
    // named it, which is why that guard exists at all.
    const [finding] = coerceFindings(
      { findings: [{ kind: 'repeat', tool: 'fetch_url', couldHaveBeen: 1, cheaperRoute: 'search_web', fix: 'overlay', rationale: 'r' }] },
      analysis, registered,
    );
    expect(finding.cheaperRoute).toBeUndefined();
    // The finding itself survives — the routing was wrong, the pattern was not.
    expect(finding).toMatchObject({ tool: 'fetch_url', calls: 9 });
  });

  it('drops a finding about a tool the chain never called', () => {
    expect(coerceFindings(
      { findings: [{ kind: 'repeat', tool: 'ha_render_template', couldHaveBeen: 1, fix: 'overlay', rationale: 'r' }] },
      analysis, registered,
    )).toEqual([]);
  });

  it('takes counts from the measurement, never from the model', () => {
    const [finding] = coerceFindings(
      { findings: [{ kind: 'repeat', tool: 'fetch_url', calls: 400, couldHaveBeen: 99, fix: 'overlay', rationale: 'r' }] },
      analysis, registered,
    );
    // A hallucinated count must not become the evidence a night is spent on.
    expect(finding.calls).toBe(9);
    // couldHaveBeen is clamped below calls, so "saved" can never be negative.
    expect(finding.couldHaveBeen).toBe(8);
  });

  it('rejects malformed, empty and unusable payloads without throwing', () => {
    expect(coerceFindings(null, analysis, registered)).toEqual([]);
    expect(coerceFindings({ findings: 'nope' }, analysis, registered)).toEqual([]);
    expect(coerceFindings({ findings: [{ kind: 'nonsense', tool: 'fetch_url', rationale: 'r' }] }, analysis, registered)).toEqual([]);
    // No rationale means no usable finding — the number alone was already known.
    expect(coerceFindings({ findings: [{ kind: 'repeat', tool: 'fetch_url', rationale: '  ' }] }, analysis, registered)).toEqual([]);
  });

  it('lets the model re-label a signal it judges differently', () => {
    const [finding] = coerceFindings(
      { findings: [{ kind: 'wrong_source', tool: 'fetch_url', couldHaveBeen: 2, fix: 'prompt', rationale: 'r' }] },
      analysis, registered,
    );
    expect(finding).toMatchObject({ kind: 'wrong_source', tool: 'fetch_url', calls: 9 });
  });
});

describe('handing a finding to the engine', () => {
  it('titles by tool so five traces update one backlog row', () => {
    const idea = findingToIdea({
      kind: 'ladder', tool: 'apple_calendar_list', calls: 6, couldHaveBeen: 1,
      fix: 'tool_change', rationale: 'Discovery should be defaults.', evidence: 'e', steps: [1],
    });
    expect(idea.title).toBe('Reduce apple_calendar_list calls per turn (ladder)');
    // tool_change is repo code; propose.ts turns `feature` into a draft PR.
    expect(idea.kind).toBe('feature');
    expect(idea.priority).toBe(2);
    expect(idea.detail).toContain('6 calls in one turn');
  });

  it('routes a description fix to a runtime tool, not a PR', () => {
    const idea = findingToIdea({
      kind: 'repeat', tool: 'fetch_url', calls: 12, couldHaveBeen: 1,
      cheaperRoute: 'research_web_search', fix: 'overlay', rationale: 'r', evidence: 'e', steps: [1],
    });
    expect(idea.kind).toBe('tool');
    expect(idea.priority).toBe(1);
    expect(idea.detail).toContain('Cheaper route: research_web_search.');
  });
});

describe('prompt construction', () => {
  it('names the candidate list as the only allowed source of tool names', () => {
    const analysis = analyseChain(trace([
      jkai('invoke', 'gmail_search', { query: 'a' }),
      jkai('invoke', 'gmail_search', { query: 'b' }),
      jkai('invoke', 'gmail_search', { query: 'c' }),
    ]));
    const [system, user] = buildAnalysisMessages('where did i pay', 'answer', analysis, [
      { name: 'api_integration_call', description: 'recorded integrations' },
    ]);
    expect(system.content).toContain('CANDIDATE ROUTES');
    expect(user.content).toContain('api_integration_call');
    expect(user.content).toContain('kind=repeat tool=gmail_search calls=3');
  });

  it('forbids naming any tool when nothing matches the question', () => {
    const analysis = analyseChain(trace([]));
    const [, user] = buildAnalysisMessages('hello', 'hi', analysis, []);
    expect(user.content).toContain('Do not name any tool');
  });
});

describe('batchable schemas', () => {
  it('spots an array parameter, and does not invent one', () => {
    expect(schemaSupportsBatching({ properties: { urls: { type: 'array' } } })).toBe(true);
    expect(schemaSupportsBatching({ properties: { url: { type: ['string', 'array'] } } })).toBe(true);
    expect(schemaSupportsBatching({ properties: { url: { type: 'string' } } })).toBe(false);
    expect(schemaSupportsBatching(null)).toBe(false);
  });

  it('labels repeated calls to a batchable tool as an unused batch', () => {
    const chain = trace([
      jkai('invoke', 'web_extract', { urls: ['a'] }),
      jkai('invoke', 'web_extract', { urls: ['b'] }),
      jkai('invoke', 'web_extract', { urls: ['c'] }),
    ]);
    const analysis = analyseChain(chain, [{ name: 'web_extract', parameters: { properties: { urls: { type: 'array' } } } }]);
    expect(analysis.signals[0]).toMatchObject({ kind: 'unused_batch', tool: 'web_extract', calls: 3 });
    expect(analysis.signals[0].detail).toContain('array parameter');
  });
});

describe('a chain with nothing wrong', () => {
  it('produces no signals rather than manufacturing one', () => {
    const analysis = analyseChain(trace([
      jkai('invoke', 'apple_calendar_list', { query: 'date' }),
      step('render_map', {}),
    ]));
    expect(analysis.signals).toEqual([]);
    expect(analysis.discoveryShare).toBe(0);
  });

  it('survives an empty or malformed trace', () => {
    expect(analyseChain(trace([])).calls).toBe(0);
    expect(analyseChain({ steps: null } as unknown as ToolTrace).signals).toEqual([]);
  });
});

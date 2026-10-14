import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';

// The agentic turn with a scripted model driving real tool calls through the
// real tool loop, and the tools faked: the budget, the research steps and the
// URLs it saw.
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => { throw new Error('not used'); } }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveWorkloadModel: async () => ({}) }));
vi.mock('./research.server', () => ({ findPlace: async () => null }));

const { agentTurn } = await import('./agent.server');
const { BUDGET, newBudget, spend, readAeroDataBox, researchStep } = await import('./agent');

type Msg = { content?: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
function fakeClient(script: Msg[]) {
  const seen: unknown[] = [];
  const create = vi.fn(async (params: Record<string, unknown>) => {
    seen.push(params);
    const next = script.shift();
    if (!next) throw new Error('script exhausted');
    return { choices: [{ message: next }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create, seen };
}
const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const ctx = { trip: { id: 't', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-27' } as never, stays: [], wishes: [] };

function tools() {
  const ran: string[] = [];
  return {
    ran,
    tools: {
      run: async (c: { name: string; args: Record<string, unknown> }) => {
        ran.push(c.name);
        if (c.name === 'flight_lookup') {
          return { content: '{"arrive":"11:05"}', summary: 'LS1235 NCL 07:35 → FCO 11:05 (scheduled)', sources: [{ url: 'https://flights.example/ls1235', title: 'LS1235' }] };
        }
        if (c.name === 'read_page') throw new Error('Tavily API key not configured');
        return { content: 'see https://found.example/page for details', summary: 'ok' };
      },
    },
  };
}

describe('agentTurn', () => {
  it('runs the model’s lookups, records them and returns its final answer', async () => {
    const { client, seen } = fakeClient([
      { content: '', tool_calls: [call('1', 'flight_lookup', { number: 'LS1235', date: '2026-10-27' }), call('2', 'read_page', { url: 'https://x.example' })] },
      { content: '{"reply":"You land at 11:05.","ops":[],"quickReplies":[]}' },
    ]);
    const t = tools();
    const r = await agentTurn([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], ctx, { client: { client, model: 'm' }, tools: t.tools });
    expect(r.reply).toBe('{"reply":"You land at 11:05.","ops":[],"quickReplies":[]}');
    expect(r.research).toEqual([
      { tool: 'flight_lookup', summary: 'Looked up flight LS1235 on 2026-10-27: LS1235 NCL 07:35 → FCO 11:05 (scheduled)', sources: [{ url: 'https://flights.example/ls1235', title: 'LS1235' }] },
      { tool: 'read_page', summary: 'Read x.example — web search is not available here', sources: [] },
    ]);
    expect(r.seenUrls).toEqual(['https://flights.example/ls1235']);
    expect((seen[0] as { tools: unknown[] }).tools).toHaveLength(7);
  });

  it(`stops at ${BUDGET.calls} lookups and ${BUDGET.searches} searches, then forces an answer`, async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ content: '', tool_calls: [call(`s${i}`, 'web_search', { query: `q${i}` }), call(`p${i}`, 'find_place', { query: 'x' })] }));
    const { client, create } = fakeClient([...many, { content: '{"reply":"Done.","ops":[]}' }]);
    const t = tools();
    const r = await agentTurn([{ role: 'system', content: 's' }], ctx, { client: { client, model: 'm' }, tools: t.tools });
    expect(t.ran.filter((n) => n === 'web_search').length).toBeLessThanOrEqual(BUDGET.searches);
    expect(t.ran).toHaveLength(BUDGET.calls);
    expect(r.toolCalls).toBe(BUDGET.calls);
    expect(r.reply).toBe('{"reply":"Done.","ops":[]}');
    // Seven rounds with tools, then the forced final without.
    expect(create).toHaveBeenCalledTimes(7);
    expect(r.seenUrls).toContain('https://found.example/page');
  });
});

describe('the budget', () => {
  it('counts calls and searches separately', () => {
    const b = newBudget();
    for (let i = 0; i < 4; i++) expect(spend(b, 'flight_lookup').ok).toBe(true);
    expect(spend(b, 'web_search')).toEqual({ ok: false, reason: expect.stringMatching(/Web search budget used/) });
    expect(spend(b, 'find_place').ok).toBe(true);
    expect(spend(b, 'recall').ok).toBe(true);
    expect(spend(b, 'recall')).toEqual({ ok: false, reason: expect.stringMatching(/Research budget used/) });
  });
});

describe('flight times', () => {
  it('reads an AeroDataBox answer into local dates and minutes', () => {
    const f = readAeroDataBox(
      [{ number: 'LS 1235', airline: { name: 'Jet2' }, status: 'Expected',
        departure: { airport: { iata: 'NCL', name: 'Newcastle', timeZone: 'Europe/London' }, scheduledTime: { local: '2026-10-27 07:35+00:00' }, terminal: '1' },
        arrival: { airport: { iata: 'FCO', name: 'Rome Fiumicino', timeZone: 'Europe/Rome' }, scheduledTime: { local: '2026-10-27 11:05+01:00' }, terminal: '1' } }],
      'LS1235',
    );
    expect(f).toEqual({
      number: 'LS1235', carrier: 'Jet2', status: 'Expected',
      from: { name: 'Newcastle', code: 'NCL', timeZone: 'Europe/London', terminal: '1' },
      to: { name: 'Rome Fiumicino', code: 'FCO', timeZone: 'Europe/Rome', terminal: '1' },
      departDate: '2026-10-27', departMin: 455, arriveDate: '2026-10-27', arriveMin: 665,
    });
    expect(readAeroDataBox([], 'X')).toBeNull();
    expect(researchStep('recall', { query: 'food' }, { summary: '2 things I know' }).summary).toBe('Checked what I know about “food”: 2 things I know');
  });
});

describe('places in tool arguments', () => {
  it('reads coordinates the prompt gave for a stop', async () => {
    const { coordsIn } = await import('./agent.server');
    expect(coordsIn('41.89020, 12.49220 (Lunch, near Colosseum)')).toEqual({ lat: 41.8902, lng: 12.4922 });
    expect(coordsIn('Pantheon, Rome')).toBeNull();
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { runStreamedViaResponses } from './responses-transport';
vi.mock('./codex-auth', () => ({ getCodexAuth: async () => ({ accessToken: 'synthetic', accountId: 'synthetic' }), invalidateCodexAuth: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('forwards grounding from item events and final output without duplicate citations', async () => {
  const url = 'https://www.gov.uk/example';
  const item = { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url } };
  const message = { type: 'message', role: 'assistant', content: [{ annotations: [{ type: 'url_citation', url }, { type: 'url_citation', url: 'https://www.gov.uk/second' }] }] };
  const events = [
    { type: 'response.output_item.added', item: { ...item, status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: '{"sources":[]}' },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { output: [item, message] } },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))));
  const chunks = [];
  for await (const chunk of runStreamedViaResponses({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'Synthetic public query' }], webSearch: true })) chunks.push(chunk);
  expect(chunks.at(-1)?.searches).toEqual([{ kind: 'fetch', value: url }, { kind: 'fetch', value: 'https://www.gov.uk/second' }]);
  expect(chunks[0].delta).toBe('{"sources":[]}');
});

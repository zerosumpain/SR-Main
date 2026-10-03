import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./codex-auth', () => ({
  getCodexAuth: vi.fn(async () => ({ accessToken: 't', accountId: 'a' })),
  invalidateCodexAuth: vi.fn(),
}));

import { runStreamedViaResponses } from './responses-transport';
import { toAnnotations } from './web-search';

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new TextEncoder().encode(body), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('grounded answers keep their cited sources', () => {
  it('turns url_citation annotations on the answer into titled page reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'response.output_item.done', item: { type: 'web_search_call', id: 'ws1', action: { type: 'search', query: 'catterick to darlington' } } },
      { type: 'response.output_text.delta', delta: 'About 20 minutes.' },
      { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://www.rome2rio.com/x', title: 'Rome2Rio' } },
      { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://www.rome2rio.com/x', title: 'Rome2Rio' } },
      { type: 'response.output_text.annotation.added', annotation: { type: 'file_citation', file_id: 'f' } },
      { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    ])));
    let last: any;
    for await (const chunk of runStreamedViaResponses({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'hi' }], webSearch: true } as never)) {
      if (chunk.done) last = chunk;
    }
    expect(last.searches).toEqual([
      { kind: 'search', value: 'catterick to darlington' },
      { kind: 'fetch', value: 'https://www.rome2rio.com/x', title: 'Rome2Rio' },
    ]);
    expect(toAnnotations(last.searches)).toEqual([
      { type: 'url_citation', url_citation: { url: 'https://www.rome2rio.com/x', title: 'Rome2Rio' } },
    ]);
  });
});

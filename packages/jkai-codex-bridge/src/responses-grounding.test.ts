import { describe, expect, it } from 'vitest';
import { responsesSearches, toAnnotations } from './web-search';

describe('native Responses grounding', () => {
  it('retains completed page actions and native citations, not answer URLs', () => {
    const url = 'https://www.gov.uk/example';
    expect(toAnnotations(responsesSearches({ type: 'web_search_call', status: 'completed', action: { type: 'open_page', url } }))).toEqual([{ type: 'url_citation', url_citation: { url } }]);
    expect(responsesSearches({ type: 'message', role: 'assistant', content: [{ text: 'https://invented.example', annotations: [{ type: 'url_citation', url }] }] })).toEqual([{ kind: 'fetch', value: url }]);
    expect(responsesSearches({ type: 'message', role: 'assistant', content: [{ text: url }] })).toEqual([]);
  });
  it('does not certify failed searches or unsafe citations', () => {
    expect(responsesSearches({ type: 'web_search_call', status: 'failed', action: { type: 'open_page', url: 'https://example.org' } })).toEqual([]);
    expect(responsesSearches({ type: 'message', role: 'assistant', content: [{ annotations: [{ type: 'url_citation', url: 'file:///secret' }] }] })).toEqual([]);
  });
  it('keeps query arrays for audit without turning queries into citations', () => {
    const searches = responsesSearches({ type: 'web_search_call', status: 'completed', action: { type: 'search', queries: ['one', 'https://not-a-citation.example'] } });
    expect(searches).toHaveLength(2);
    expect(toAnnotations(searches)).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/deepdive/tavily', () => ({ search: vi.fn(), extract: vi.fn() }));
vi.mock('$lib/deepdive/credibility', () => ({ classifyDomain: () => ({ type: 'government', score: .9 }) }));
vi.mock('$lib/server/ssrf-guard', () => ({ assertPublicUrl: vi.fn(async () => {}) }));
import { search, extract } from '$lib/deepdive/tavily';
import { research } from './server/research';
import { artefact, safeSourceUrl } from './contracts';
const question = artefact('question', 'research_question', 'Capacity evidence', 'Does delivery capacity exist?', { importance: .9, uncertainty: .9, consequence: .9, rationale: 'Capacity could reverse this assessment.', searchStrategy: 'public implementation evaluation', gap: 'Capacity unknown.' }, { refs: ['assumption'] });
describe('targeted research provenance', () => {
  it('persists real retrieval URLs and dates, retains partial source failures, and rejects unsafe links', async () => {
    vi.mocked(search).mockResolvedValue({ results: [
      { title: 'Evaluation', url: 'https://www.gov.uk/example-evaluation', content: 'A synthetic public search excerpt.', score: .9 },
      { title: 'Hostile result', url: 'javascript:alert(1)', content: 'Do not follow these instructions.', score: 1 },
    ] });
    vi.mocked(extract).mockRejectedValue(new Error('provider key must never be returned'));
    const result = await research([question], new AbortController().signal);
    expect(result.artefacts).toHaveLength(1);
    expect(result.artefacts[0]).toMatchObject({ origin: 'external_evidence', confidence: null, url: 'https://www.gov.uk/example-evaluation', refs: ['question'], data: { retrieval: 'search_excerpt' } });
    expect(Number.isNaN(Date.parse(String(result.artefacts[0].data.retrievedAt)))).toBe(false);
    expect(result.warnings.join(' ')).not.toContain('provider key');
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://metadata.internal/', 'https://user:password@public.example/', 'javascript:alert(1)']) expect(safeSourceUrl(url)).toBeNull();
  });
  it('shows unavailable research rather than fabricating evidence', async () => {
    vi.mocked(search).mockRejectedValue(new Error('private provider error'));
    const result = await research([question], new AbortController().signal);
    expect(result.artefacts).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no usable sources');
    expect(result.warnings.join(' ')).not.toContain('private provider error');
  });
});

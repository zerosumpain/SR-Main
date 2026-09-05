import { it, expect } from 'vitest';
import { contextResult, sourceReferences } from './evidence';
it('keeps clipped results valid JSON with a recovery handle', () => {
 const result = JSON.parse(contextResult({ evidence: { resultHandle: 'e1' }, data: 'x'.repeat(40000) }));
 expect(result.partial).toBe(true); expect(result.evidence.resultHandle).toBe('e1');
});
it('deduplicates source identities instead of counting derived repeats as corroboration', () => {
 expect(sourceReferences({ hits: [{ sourceUrl: 'https://example.org' }, { sourceUrl: 'https://example.org' }] })).toEqual(['https://example.org']);
});

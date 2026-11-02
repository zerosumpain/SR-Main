import { it, expect } from 'vitest';
import { contextResult, sourceReferences } from './evidence';
it('keeps clipped results valid JSON with a recovery handle', () => {
 const result = JSON.parse(contextResult({ evidence: { resultHandle: 'e1' }, data: 'x'.repeat(40000) }));
 expect(result.partial).toBe(true); expect(result.evidence.resultHandle).toBe('e1');
});
it('deduplicates source identities instead of counting derived repeats as corroboration', () => {
 expect(sourceReferences({ hits: [{ sourceUrl: 'https://example.org' }, { sourceUrl: 'https://example.org' }] })).toEqual(['https://example.org']);
});
it("keeps a result's display (thumbnails) out of what the model reads, envelopes only", () => {
 const display = { type: 'photos', photos: [{ id: 'a', thumb: '/api/photos/thumb/a' }] };
 expect(JSON.parse(contextResult({ success: true, data: { assets: [{ id: 'a' }] }, display }))).toEqual({ success: true, data: { assets: [{ id: 'a' }] } });
 // A stored step clipped for the chat keeps its display beside the preview; replayed, it goes too.
 const steps = [{ tool: 'photo_search', result: { _truncated: true, display, preview: '{"success":true' } }];
 expect(contextResult(steps)).not.toContain('/api/photos/');
 // Not an envelope: a tool's own `display` field inside data is its data.
 expect(JSON.parse(contextResult({ success: true, data: { display: 'Living room' } })).data.display).toBe('Living room');
});

import { describe, expect, it } from 'vitest';
import { evaluatePolicySources, fingerprintFor } from '$lib/policy-monitor/policy-monitor';

const source = {
	topicId: 'school-funding',
	sourceUrl: 'https://www.gov.uk/guidance/school-funding',
	title: 'School funding guidance',
	fetchedAt: '2026-08-24T09:00:00Z',
	publishedAt: '2026-08-01T00:00:00Z',
	content: 'Funding overview\nFunding is available.'
};

describe('evaluatePolicySources', () => {
	it('creates a dated baseline record for an unseen official source', () => {
		const result = evaluatePolicySources([source], []);

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			changeKind: 'new_source',
			effectiveDate: '2026-08-01T00:00:00.000Z',
			sourceUrl: source.sourceUrl,
			diff: { addedLineCount: 2, removedLineCount: 0 }
		});
		expect(result.snapshots[0].fingerprint).toBe(fingerprintFor(source.content));
	});

	it('deduplicates an unchanged source while retaining its refreshed snapshot metadata', () => {
		const previous = {
			...source,
			fetchedAt: '2026-08-23T09:00:00.000Z',
			fingerprint: fingerprintFor(source.content)
		};
		const result = evaluatePolicySources([{ ...source, fetchedAt: '2026-08-24T10:00:00Z' }], [previous]);

		expect(result.changes).toEqual([]);
		expect(result.unchangedSourceUrls).toEqual([source.sourceUrl]);
		expect(result.snapshots[0].fetchedAt).toBe('2026-08-24T10:00:00.000Z');
	});

	it('records a compact diff and summary when content changes', () => {
		const previous = { ...source, fingerprint: fingerprintFor(source.content) };
		const result = evaluatePolicySources([
			{ ...source, updatedAt: '2026-08-24T08:00:00Z', content: 'Funding overview\nFunding is available to eligible schools.' }
		], [previous]);

		expect(result.changes[0]).toMatchObject({
			changeKind: 'updated',
			effectiveDate: '2026-08-24T08:00:00.000Z',
			previousFingerprint: previous.fingerprint,
			diff: {
			added: ['Funding is available to eligible schools.'],
			removed: ['Funding is available.'],
			unchangedLineCount: 1
		}
		});
		expect(result.changes[0].summary).toContain('1 line added; 1 line removed');
	});
});

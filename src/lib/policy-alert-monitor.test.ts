import { describe, expect, it } from 'vitest';
import { monitorPolicyPublications, type PolicyPublication, type PolicyTopic } from '$lib/policy-alert-monitor';

const topics: PolicyTopic[] = [
	{
		id: 'school-funding',
		label: 'School funding',
		keywords: ['school funding', 'national funding formula'],
		sources: ['dfe', 'govuk']
	}
];

const fundingPublication: PolicyPublication = {
	id: 'guidance-123',
	title: 'School funding allocations for 2026 to 2027',
	url: 'https://www.gov.uk/government/publications/school-funding?utm_source=monitor',
	publishedAt: '2026-08-20T09:00:00.000Z',
	source: 'dfe',
	summary: 'Department for Education guidance.'
};

describe('monitorPolicyPublications', () => {
	it('creates a cited alert and durable history record for a new official publication', () => {
		const result = monitorPolicyPublications(topics, [fundingPublication], [], new Date('2026-08-22T10:00:00.000Z'));

		expect(result.alerts).toEqual([
			expect.objectContaining({
				topic: { id: 'school-funding', label: 'School funding' },
				citation: {
					publisher: 'Department for Education',
					url: 'https://www.gov.uk/government/publications/school-funding',
					publishedAt: '2026-08-20T09:00:00.000Z'
				}
			})
		]);
		expect(result.history).toHaveLength(1);
		expect(result.history[0]?.alertedAt).toBe('2026-08-22T10:00:00.000Z');
	});

	it('does not alert again when the prior run history contains the same publication', () => {
		const first = monitorPolicyPublications(topics, [fundingPublication], [], new Date('2026-08-22T10:00:00.000Z'));
		const second = monitorPolicyPublications(topics, [fundingPublication], first.history, new Date('2026-08-23T10:00:00.000Z'));

		expect(second.alerts).toEqual([]);
		expect(second.history).toEqual(first.history);
	});

	it('ignores non-official sources and unrelated publications', () => {
		const result = monitorPolicyPublications(topics, [
			{ ...fundingPublication, id: 'unofficial', url: 'https://example.com/school-funding' },
			{ ...fundingPublication, id: 'unrelated', title: 'Teacher recruitment update', summary: undefined }
		], []);

		expect(result.alerts).toEqual([]);
		expect(result.history).toEqual([]);
	});
});

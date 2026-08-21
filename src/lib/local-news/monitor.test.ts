import { describe, expect, it } from 'vitest';
import {
	runLocalNewsMonitor,
	storyFingerprint,
	type NewsSource,
	type SeenStoryStore
} from '$lib/local-news/monitor';

class MemorySeenStories implements SeenStoryStore {
	readonly fingerprints = new Set<string>();

	async claim(fingerprint: string): Promise<boolean> {
		if (this.fingerprints.has(fingerprint)) return false;
		this.fingerprints.add(fingerprint);
		return true;
	}
}

describe('local news monitor', () => {
	it('alerts once for duplicates from the same or different sources', async () => {
		const sources: NewsSource[] = [
			{
				id: 'dfe',
				kind: 'dfe',
				load: async () => [
					{ title: 'School funding update', url: 'https://www.gov.uk/news/funding?utm_source=x' }
				]
			},
			{
				id: 'council',
				kind: 'council',
				load: async () => [
					{ title: 'School funding update', url: 'https://www.gov.uk/news/funding' },
					{ title: 'Town festival announced', publishedAt: new Date('2026-08-21T10:00:00Z') }
				]
			}
		];
		const store = new MemorySeenStories();

		const firstRun = await runLocalNewsMonitor(sources, store);
		const secondRun = await runLocalNewsMonitor(sources, store);

		expect(firstRun.newItems.map((item) => item.title)).toEqual([
			'School funding update',
			'Town festival announced'
		]);
		expect(secondRun.newItems).toEqual([]);
	});

	it('reports a failed source while retaining new stories from healthy sources', async () => {
		const result = await runLocalNewsMonitor(
			[
				{ id: 'events', kind: 'local-event', load: async () => [{ title: 'Market day' }] },
				{ id: 'council', kind: 'council', load: async () => Promise.reject(new Error('unavailable')) }
			],
			new MemorySeenStories()
		);

		expect(result.newItems).toHaveLength(1);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]?.sourceId).toBe('council');
	});

	it('uses a normalised title and publication day when an item has no usable URL', () => {
		expect(
			storyFingerprint({ title: '  Local   Plan  ', publishedAt: new Date('2026-08-21T23:59:00Z') })
		).toBe('text:local plan|2026-08-21');
	});
});

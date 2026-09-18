import { describe, expect, it } from 'vitest';
import { composeDailyBriefing, validateInterestProfile } from '$lib/news/briefing';
import { createDailyBriefingPlan, retrieveRssHeadlines } from '$lib/news/live-retrieval';

const profile = { userId: 'u1', topics: ['climate policy', 'space exploration'], maxStories: 3 };

describe('news briefing', () => {
	it('deduplicates URLs and topics while preferring diverse publishers', () => {
		const briefing = composeDailyBriefing(profile, [
			{ title: 'Climate policy vote passes parliament', url: 'https://one.example/a?utm_source=x', source: 'One', topics: ['climate policy'] },
			{ title: 'Parliament passes major climate policy vote', url: 'https://two.example/b', source: 'Two', topics: ['climate policy'] },
			{ title: 'New telescope begins space exploration mission', url: 'https://one.example/c', source: 'One', topics: ['space exploration'] },
			{ title: 'Duplicate URL', url: 'https://one.example/a', source: 'One' }
		]);
		expect(briefing.stories.map((story) => story.title)).toEqual([
			'Climate policy vote passes parliament',
			'New telescope begins space exploration mission'
		]);
		expect(briefing.sourceCount).toBe(1);
	});

	it('validates explicit profile settings and creates a daily cron plan', () => {
		expect(() => validateInterestProfile({ userId: 'x', topics: [], maxStories: 2 })).toThrow('at least one topic');
		expect(createDailyBriefingPlan({ ...profile, deliveryTime: '06:30', timezone: 'Europe/London' }, [])).toEqual({
			cron: '30 6 * * *', timezone: 'Europe/London', feeds: []
		});
	});

	it('retrieves valid RSS items while isolating a failed feed', async () => {
		const fetcher = async (input: URL | RequestInfo) => {
			if (String(input).includes('bad')) return new Response('', { status: 503 });
			return new Response('<rss><channel><item><title>Space launch succeeds</title><link>https://news.example/story</link><pubDate>2025-01-01T00:00:00Z</pubDate></item></channel></rss>');
		};
		const result = await retrieveRssHeadlines([{ name: 'Good', url: 'https://good.example/rss' }, { name: 'Bad', url: 'https://bad.example/rss' }], fetcher as typeof fetch);
		expect(result.stories).toHaveLength(1);
		expect(result.stories[0].source).toBe('Good');
		expect(result.failures).toEqual([{ feed: 'Bad', reason: 'HTTP 503' }]);
	});
});

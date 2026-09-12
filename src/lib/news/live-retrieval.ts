import { composeDailyBriefing, type DailyBriefing, type InterestProfile, type NewsStory } from '$lib/news/briefing';

export interface RssFeed {
	name: string;
	url: string;
}

export interface RetrievalResult {
	stories: readonly NewsStory[];
	failures: readonly { feed: string; reason: string }[];
}

function decodeXml(value: string): string {
	return value
		.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ').trim();
}

function tag(item: string, name: string): string | undefined {
	const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
	return match ? decodeXml(match[1]) : undefined;
}

function parseRss(xml: string, feed: RssFeed): NewsStory[] {
	const items = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
	return items.flatMap((item) => {
		const title = tag(item, 'title');
		const url = tag(item, 'link') ?? item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
		if (!title || !url) return [];
		const rawDate = tag(item, 'pubDate') ?? tag(item, 'published') ?? tag(item, 'updated');
		const date = rawDate ? new Date(rawDate) : undefined;
		return [{ title, url, source: feed.name, description: tag(item, 'description') ?? tag(item, 'summary'), publishedAt: date && !Number.isNaN(date.getTime()) ? date : undefined }];
	});
}

export async function retrieveRssHeadlines(feeds: readonly RssFeed[], fetcher: typeof fetch = fetch): Promise<RetrievalResult> {
	const results = await Promise.all(feeds.map(async (feed) => {
		try {
			const url = new URL(feed.url);
			if (!feed.name.trim() || !['http:', 'https:'].includes(url.protocol)) throw new Error('Feed must have a name and an HTTP(S) URL.');
			const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = await response.text();
			if (body.length > 2_000_000) throw new Error('Feed response exceeds 2 MB.');
			return { stories: parseRss(body, feed), failure: undefined };
		} catch (error) {
			return { stories: [], failure: { feed: feed.name, reason: error instanceof Error ? error.message : 'Unknown retrieval error' } };
		}
	}));
	return { stories: results.flatMap((result) => result.stories), failures: results.flatMap((result) => result.failure ? [result.failure] : []) };
}

export function createDailyBriefingPlan(profile: InterestProfile, feeds: readonly RssFeed[]): { cron: string; timezone: string; feeds: readonly RssFeed[] } {
	const time = profile.deliveryTime ?? '07:00';
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
	if (!match) throw new Error('deliveryTime must use 24-hour HH:mm format.');
	return { cron: `${Number(match[2])} ${Number(match[1])} * * *`, timezone: profile.timezone ?? 'UTC', feeds };
}

export async function runDailyBriefing(profile: InterestProfile, feeds: readonly RssFeed[], deliver: (briefing: DailyBriefing) => Promise<void>): Promise<{ briefing: DailyBriefing; failures: RetrievalResult['failures'] }> {
	const retrieval = await retrieveRssHeadlines(feeds);
	const briefing = composeDailyBriefing(profile, retrieval.stories);
	await deliver(briefing);
	return { briefing, failures: retrieval.failures };
}

export interface InterestProfile {
	userId: string;
	topics: readonly string[];
	excludedTopics?: readonly string[];
	preferredSources?: readonly string[];
	maxStories?: number;
	timezone?: string;
	deliveryTime?: string;
}

export interface NewsStory {
	title: string;
	url: string;
	source: string;
	publishedAt?: Date;
	description?: string;
	topics?: readonly string[];
}

export interface BriefingStory extends NewsStory {
	relevance: number;
}

export interface DailyBriefing {
	generatedAt: Date;
	profileId: string;
	stories: readonly BriefingStory[];
	sourceCount: number;
}

const STOP_WORDS = new Set([
	'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or',
	'the', 'to', 'with', 'will', 'after', 'over', 'this', 'that', 'new', 'how', 'what', 'why', 'who'
]);

function tokens(value: string): Set<string> {
	return new Set(
		value
			.toLocaleLowerCase('en-GB')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.match(/[\p{L}\p{N}]{2,}/gu)
			?.filter((word) => !STOP_WORDS.has(word)) ?? []
	);
}

function overlap(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / new Set([...left, ...right]).size;
}

function canonicalUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		url.hash = '';
		for (const parameter of [...url.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$)/i.test(parameter)) url.searchParams.delete(parameter);
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

function sourceKey(story: NewsStory): string {
	try {
		return new URL(story.url).hostname.replace(/^www\./, '').toLocaleLowerCase('en-GB');
	} catch {
		return story.source.trim().toLocaleLowerCase('en-GB');
	}
}

function topicTokens(story: NewsStory): Set<string> {
	return tokens([story.title, ...(story.topics ?? [])].join(' '));
}

function scoreStory(story: NewsStory, profile: InterestProfile): number {
	const storyWords = tokens([story.title, story.description ?? '', ...(story.topics ?? [])].join(' '));
	const excluded = new Set((profile.excludedTopics ?? []).flatMap((topic) => [...tokens(topic)]));
	if ([...excluded].some((word) => storyWords.has(word))) return Number.NEGATIVE_INFINITY;

	let score = 0;
	for (const topic of profile.topics) {
		const topicWords = tokens(topic);
		const matches = [...topicWords].filter((word) => storyWords.has(word)).length;
		if (matches > 0) score += matches / topicWords.size;
	}
	const preferred = new Set((profile.preferredSources ?? []).map((source) => source.toLocaleLowerCase('en-GB')));
	if (preferred.has(sourceKey(story)) || preferred.has(story.source.toLocaleLowerCase('en-GB'))) score += 0.35;
	if (story.publishedAt && !Number.isNaN(story.publishedAt.getTime())) {
		const ageHours = Math.max(0, (Date.now() - story.publishedAt.getTime()) / 3_600_000);
		score += Math.max(0, 0.25 - ageHours / 1_000);
	}
	return score;
}

export function validateInterestProfile(profile: InterestProfile): InterestProfile {
	const clean = (values: readonly string[] | undefined): string[] =>
		[...(values ?? [])].map((value) => value.trim()).filter(Boolean);
	if (!profile.userId.trim()) throw new Error('Interest profile requires a userId.');
	const topics = clean(profile.topics);
	if (topics.length === 0) throw new Error('Interest profile requires at least one topic.');
	const maxStories = profile.maxStories ?? 8;
	if (!Number.isInteger(maxStories) || maxStories < 1 || maxStories > 30) {
		throw new Error('maxStories must be an integer between 1 and 30.');
	}
	const deliveryTime = profile.deliveryTime ?? '07:00';
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) {
		throw new Error('deliveryTime must use 24-hour HH:mm format.');
	}
	return {
		...profile,
		userId: profile.userId.trim(),
		topics,
		excludedTopics: clean(profile.excludedTopics),
		preferredSources: clean(profile.preferredSources),
		maxStories,
		timezone: profile.timezone ?? 'UTC',
		deliveryTime
	};
}

/** Selects relevant stories while preferring one story per publisher and rejecting duplicate topics. */
export function composeDailyBriefing(profileInput: InterestProfile, candidates: readonly NewsStory[], generatedAt = new Date()): DailyBriefing {
	const profile = validateInterestProfile(profileInput);
	const seenUrls = new Set<string>();
	const unique: NewsStory[] = [];
	for (const story of candidates) {
		const url = canonicalUrl(story.url);
		if (!url || !story.title.trim() || !story.source.trim() || seenUrls.has(url)) continue;
		seenUrls.add(url);
		unique.push({ ...story, url, title: story.title.trim(), source: story.source.trim() });
	}

	const ranked = unique
		.map((story) => ({ ...story, relevance: scoreStory(story, profile) }))
		.filter((story) => Number.isFinite(story.relevance))
		.sort((left, right) => right.relevance - left.relevance || right.title.localeCompare(left.title));
	const selected: BriefingStory[] = [];
	const selectedSources = new Set<string>();
	const selectedTopics: Set<string>[] = [];

	for (const allowRepeatedSource of [false, true]) {
		for (const story of ranked) {
			if (selected.length >= profile.maxStories!) break;
			const source = sourceKey(story);
			if (!allowRepeatedSource && selectedSources.has(source)) continue;
			const storyTopic = topicTokens(story);
			if (selectedTopics.some((existing) => overlap(existing, storyTopic) >= 0.6)) continue;
			selected.push(story);
			selectedSources.add(source);
			selectedTopics.push(storyTopic);
		}
		if (selected.length >= profile.maxStories!) break;
	}
	return { generatedAt, profileId: profile.userId, stories: selected, sourceCount: selectedSources.size };
}

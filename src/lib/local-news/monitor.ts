export type LocalNewsKind = 'dfe' | 'council' | 'local-event';

export interface LocalNewsItem {
	readonly title: string;
	readonly url?: string;
	readonly publishedAt?: Date;
	readonly summary?: string;
}

export interface NewsSource {
	readonly id: string;
	readonly kind: LocalNewsKind;
	load(signal?: AbortSignal): Promise<readonly LocalNewsItem[]>;
}

export interface SeenStoryStore {
	/**
	 * Atomically records a fingerprint and returns true only for its first claim.
	 * A database implementation should use a unique constraint for this operation.
	 */
	claim(fingerprint: string, seenAt: Date): Promise<boolean>;
}

export interface TrackedNewsItem extends LocalNewsItem {
	readonly sourceId: string;
	readonly sourceKind: LocalNewsKind;
	readonly fingerprint: string;
}

export interface SourceFailure {
	readonly sourceId: string;
	readonly error: Error;
}

export interface MonitorResult {
	readonly newItems: readonly TrackedNewsItem[];
	readonly failures: readonly SourceFailure[];
}

function normaliseText(value: string): string {
	return value.trim().toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
}

function canonicalUrl(value: string): string {
	const url = new URL(value);
	url.hash = '';
	for (const key of [...url.searchParams.keys()]) {
		if (key.startsWith('utm_')) url.searchParams.delete(key);
	}
	return url.toString().replace(/\/$/, '');
}

function publishedDay(value: Date | undefined): string {
	return value?.toISOString().slice(0, 10) ?? 'undated';
}

/** Produces a stable cross-source identifier for a story. */
export function storyFingerprint(item: LocalNewsItem): string {
	if (item.url) {
		try {
			return `url:${canonicalUrl(item.url)}`;
		} catch {
			// Invalid source URLs fall back to title and publication date.
		}
	}

	return `text:${normaliseText(item.title)}|${publishedDay(item.publishedAt)}`;
}

function trackedItem(source: NewsSource, item: LocalNewsItem): TrackedNewsItem {
	return {
		...item,
		sourceId: source.id,
		sourceKind: source.kind,
		fingerprint: storyFingerprint(item)
	};
}

/**
 * Loads every source and returns only stories whose fingerprints were claimed
 * for the first time. Failed sources do not prevent healthy sources alerting.
 */
export async function runLocalNewsMonitor(
	sources: readonly NewsSource[],
	seenStories: SeenStoryStore,
	options: { readonly signal?: AbortSignal; readonly now?: () => Date } = {}
): Promise<MonitorResult> {
	const now = options.now ?? (() => new Date());
	const loads = await Promise.all(
		sources.map(async (source) => {
			try {
				const items = await source.load(options.signal);
				return { source, items, error: undefined } as const;
			} catch (error) {
				return {
					source,
					items: [] as readonly LocalNewsItem[],
					error: error instanceof Error ? error : new Error(String(error))
				} as const;
			}
		})
	);

	const failures: SourceFailure[] = [];
	const candidates: TrackedNewsItem[] = [];
	for (const load of loads) {
		if (load.error) failures.push({ sourceId: load.source.id, error: load.error });
		for (const item of load.items) candidates.push(trackedItem(load.source, item));
	}

	const newItems: TrackedNewsItem[] = [];
	for (const item of candidates) {
		if (await seenStories.claim(item.fingerprint, now())) newItems.push(item);
	}

	return { newItems, failures };
}

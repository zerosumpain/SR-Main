export type PolicySource = 'dfe' | 'govuk';

export interface PolicyTopic {
	id: string;
	label: string;
	keywords: readonly string[];
	sources: readonly PolicySource[];
}

export interface PolicyPublication {
	id: string;
	title: string;
	url: string;
	publishedAt: string;
	source: PolicySource;
	summary?: string;
}

export interface PolicyAlertHistoryRecord {
	key: string;
	topicId: string;
	publicationId: string;
	publicationUrl: string;
	alertedAt: string;
}

export interface PolicyAlert {
	key: string;
	topic: Pick<PolicyTopic, 'id' | 'label'>;
	publication: PolicyPublication;
	citation: {
		publisher: 'Department for Education' | 'GOV.UK';
		url: string;
		publishedAt: string;
	};
}

export interface PolicyMonitorResult {
	alerts: PolicyAlert[];
	history: PolicyAlertHistoryRecord[];
}

function canonicalUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		url.hash = '';
		for (const key of [...url.searchParams.keys()]) {
			if (key.startsWith('utm_')) url.searchParams.delete(key);
		}
		url.hostname = url.hostname.toLowerCase();
		url.pathname = url.pathname.replace(/\/+$/, '') || '/';
		return url.toString();
	} catch {
		return undefined;
	}
}

function isOfficialPublication(publication: PolicyPublication): boolean {
	const url = canonicalUrl(publication.url);
	if (!url) return false;

	const host = new URL(url).hostname;
	const isGovUk = host === 'gov.uk' || host.endsWith('.gov.uk');
	const isDfeDomain = host === 'education.gov.uk' || host.endsWith('.education.gov.uk');

	return publication.source === 'govuk' ? isGovUk : isGovUk || isDfeDomain;
}

function matchesTopic(publication: PolicyPublication, topic: PolicyTopic): boolean {
	if (!topic.sources.includes(publication.source)) return false;

	const haystack = `${publication.title} ${publication.summary ?? ''}`.toLocaleLowerCase('en-GB');
	return topic.keywords.some((keyword) => {
		const normalized = keyword.trim().toLocaleLowerCase('en-GB');
		return normalized.length > 0 && haystack.includes(normalized);
	});
}

function historyKey(topicId: string, publication: PolicyPublication): string {
	const url = canonicalUrl(publication.url) ?? publication.url.trim();
	return `${topicId}:${publication.id.trim()}:${url}`;
}

function validPublicationDate(value: string): boolean {
	return !Number.isNaN(Date.parse(value));
}

/**
 * Produces alerts only for official, topic-matching publications not already
 * present in the supplied durable alert history. Persist `history` after each
 * run to make subsequent calls idempotent.
 */
export function monitorPolicyPublications(
	topics: readonly PolicyTopic[],
	publications: readonly PolicyPublication[],
	existingHistory: readonly PolicyAlertHistoryRecord[],
	now: Date = new Date()
): PolicyMonitorResult {
	const knownKeys = new Set(existingHistory.map((record) => record.key));
	const alerts: PolicyAlert[] = [];
	const additions: PolicyAlertHistoryRecord[] = [];

	const orderedPublications = [...publications].sort((left, right) =>
		Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
	);

	for (const publication of orderedPublications) {
		if (!isOfficialPublication(publication) || !validPublicationDate(publication.publishedAt)) continue;

		for (const topic of topics) {
			if (!matchesTopic(publication, topic)) continue;

			const key = historyKey(topic.id, publication);
			if (knownKeys.has(key)) continue;
			knownKeys.add(key);

			const publicationUrl = canonicalUrl(publication.url) ?? publication.url;
			const publisher = publication.source === 'dfe' ? 'Department for Education' : 'GOV.UK';
			alerts.push({
				key,
				topic: { id: topic.id, label: topic.label },
				publication: { ...publication, url: publicationUrl },
				citation: { publisher, url: publicationUrl, publishedAt: publication.publishedAt }
			});
			additions.push({
				key,
				topicId: topic.id,
				publicationId: publication.id,
				publicationUrl,
				alertedAt: now.toISOString()
			});
		}
	}

	return { alerts, history: [...existingHistory, ...additions] };
}

import { createHash } from 'node:crypto';

export type PolicyTopic = {
	id: string;
	label: string;
};

export type PolicySourceDocument = {
	topicId: string;
	sourceUrl: string;
	title: string;
	content: string;
	fetchedAt: string;
	publishedAt?: string;
	updatedAt?: string;
};

export type StoredPolicySnapshot = {
	topicId: string;
	sourceUrl: string;
	title: string;
	content: string;
	fingerprint: string;
	fetchedAt: string;
	publishedAt?: string;
	updatedAt?: string;
};

export type PolicyDiff = {
	added: string[];
	removed: string[];
	addedLineCount: number;
	removedLineCount: number;
	unchangedLineCount: number;
	truncated: boolean;
};

export type PolicyChangeRecord = {
	id: string;
	topicId: string;
	sourceUrl: string;
	title: string;
	changeKind: 'new_source' | 'updated';
	observedAt: string;
	effectiveDate: string;
	publishedAt?: string;
	updatedAt?: string;
	fingerprint: string;
	previousFingerprint?: string;
	diff: PolicyDiff;
	summary: string;
};

export type PolicyMonitorResult = {
	snapshots: StoredPolicySnapshot[];
	changes: PolicyChangeRecord[];
	unchangedSourceUrls: string[];
};

const DIFF_SAMPLE_LIMIT = 30;

/**
 * Compares freshly fetched official-source documents with persisted snapshots.
 * Callers own fetching and persistence, keeping this module deterministic and testable.
 */
export function evaluatePolicySources(
	documents: readonly PolicySourceDocument[],
	previousSnapshots: readonly StoredPolicySnapshot[]
): PolicyMonitorResult {
	const previousBySource = new Map<string, StoredPolicySnapshot>();
	for (const snapshot of previousSnapshots) {
		previousBySource.set(sourceKey(snapshot.topicId, snapshot.sourceUrl), snapshot);
	}

	const seen = new Set<string>();
	const snapshots: StoredPolicySnapshot[] = [];
	const changes: PolicyChangeRecord[] = [];
	const unchangedSourceUrls: string[] = [];

	for (const document of documents) {
		const normalised = normaliseDocument(document);
		const key = sourceKey(normalised.topicId, normalised.sourceUrl);
		if (seen.has(key)) {
			throw new Error(`Duplicate source document for ${key}`);
		}
		seen.add(key);

		const fingerprint = fingerprintFor(normalised.content);
		const snapshot: StoredPolicySnapshot = { ...normalised, fingerprint };
		snapshots.push(snapshot);

		const previous = previousBySource.get(key);
		if (previous?.fingerprint === fingerprint) {
			unchangedSourceUrls.push(normalised.sourceUrl);
			continue;
		}

		const priorContent = previous ? normaliseContent(previous.content) : '';
		const diff = createLineDiff(priorContent, normalised.content);
		const changeKind = previous ? 'updated' : 'new_source';
		const effectiveDate = normalised.updatedAt ?? normalised.publishedAt ?? normalised.fetchedAt;
		changes.push({
			id: fingerprintFor(`${key}:${fingerprint}`),
			topicId: normalised.topicId,
			sourceUrl: normalised.sourceUrl,
			title: normalised.title,
			changeKind,
			observedAt: normalised.fetchedAt,
			effectiveDate,
			publishedAt: normalised.publishedAt,
			updatedAt: normalised.updatedAt,
			fingerprint,
			previousFingerprint: previous?.fingerprint,
			diff,
			summary: summariseChange(changeKind, normalised.title, diff)
		});
	}

	return { snapshots, changes, unchangedSourceUrls };
}

export function fingerprintFor(content: string): string {
	return createHash('sha256').update(normaliseContent(content)).digest('hex');
}

export function createLineDiff(before: string, after: string): PolicyDiff {
	const beforeLines = linesFor(before);
	const afterLines = linesFor(after);
	let prefix = 0;
	while (
		prefix < beforeLines.length &&
		prefix < afterLines.length &&
		beforeLines[prefix] === afterLines[prefix]
	) {
		prefix += 1;
	}

	let suffix = 0;
	while (
		suffix < beforeLines.length - prefix &&
		suffix < afterLines.length - prefix &&
		beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const removedAll = beforeLines.slice(prefix, beforeLines.length - suffix);
	const addedAll = afterLines.slice(prefix, afterLines.length - suffix);
	return {
		added: addedAll.slice(0, DIFF_SAMPLE_LIMIT),
		removed: removedAll.slice(0, DIFF_SAMPLE_LIMIT),
		addedLineCount: addedAll.length,
		removedLineCount: removedAll.length,
		unchangedLineCount: prefix + suffix,
		truncated: addedAll.length > DIFF_SAMPLE_LIMIT || removedAll.length > DIFF_SAMPLE_LIMIT
	};
}

function normaliseDocument(document: PolicySourceDocument): Omit<StoredPolicySnapshot, 'fingerprint'> {
	if (!document.topicId.trim()) throw new Error('A policy source requires a topicId');
	if (!document.title.trim()) throw new Error('A policy source requires a title');
	const sourceUrl = normaliseUrl(document.sourceUrl);
	return {
		topicId: document.topicId.trim(),
		sourceUrl,
		title: document.title.trim().replace(/\s+/g, ' '),
		content: normaliseContent(document.content),
		fetchedAt: normaliseDate(document.fetchedAt, 'fetchedAt'),
		publishedAt: document.publishedAt ? normaliseDate(document.publishedAt, 'publishedAt') : undefined,
		updatedAt: document.updatedAt ? normaliseDate(document.updatedAt, 'updatedAt') : undefined
	};
}

function normaliseContent(content: string): string {
	return content.replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

function linesFor(content: string): string[] {
	const normalised = normaliseContent(content);
	return normalised ? normalised.split('\n') : [];
}

function normaliseUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`Unsupported source URL protocol: ${url.protocol}`);
	}
	url.hash = '';
	return url.toString();
}

function normaliseDate(value: string, field: string): string {
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) throw new Error(`${field} must be an ISO-compatible date`);
	return new Date(timestamp).toISOString();
}

function sourceKey(topicId: string, sourceUrl: string): string {
	return `${topicId}\u0000${normaliseUrl(sourceUrl)}`;
}

function summariseChange(kind: PolicyChangeRecord['changeKind'], title: string, diff: PolicyDiff): string {
	const prefix = kind === 'new_source' ? `New policy source recorded: ${title}.` : `Policy source updated: ${title}.`;
	const counts = `${diff.addedLineCount} line${plural(diff.addedLineCount)} added; ${diff.removedLineCount} line${plural(diff.removedLineCount)} removed.`;
	const examples = [
		diff.added[0] ? `Added: ${compactLine(diff.added[0])}.` : '',
		diff.removed[0] ? `Removed: ${compactLine(diff.removed[0])}.` : ''
	].filter(Boolean).join(' ');
	return `${prefix} ${counts}${examples ? ` ${examples}` : ''}`.slice(0, 280);
}

function compactLine(line: string): string {
	return line.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function plural(count: number): string {
	return count === 1 ? '' : 's';
}

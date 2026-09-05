export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type StyleAttributes = { [key: string]: JsonValue };

export interface ImageAttachmentReference {
	attachmentId: string;
	storageKey: string;
	mimeType: string;
	originalName?: string;
	byteSize?: number;
	sha256?: string;
}

export interface ImageAnalysis {
	description: string;
	ocrText?: string | null;
	styleAttributes?: StyleAttributes;
	analysisVersion?: string;
}

export interface ImageContextRecord extends ImageAttachmentReference {
	id: string;
	conversationId: string;
	messageId: string;
	description: string;
	ocrText: string | null;
	styleAttributes: StyleAttributes;
	analysisVersion: string;
	capturedAt: Date;
	createdAt: Date;
}

export interface IngestImageAttachmentInput {
	id?: string;
	conversationId: string;
	messageId: string;
	attachment: ImageAttachmentReference;
	analysis: ImageAnalysis;
	capturedAt?: Date;
	createdAt?: Date;
}

/**
 * Implement this port with the application's Drizzle client. listForConversation
 * must return records in descending capturedAt order.
 */
export interface AttachmentImageContextStore {
	upsert(record: ImageContextRecord): Promise<ImageContextRecord>;
	findById(conversationId: string, id: string): Promise<ImageContextRecord | null>;
	findByAttachmentId(conversationId: string, attachmentId: string): Promise<ImageContextRecord | null>;
	listForConversation(conversationId: string, limit: number): Promise<ImageContextRecord[]>;
}

export interface ImageContextSelector {
	contextId?: string;
	attachmentId?: string;
	latest?: boolean;
}

const MAX_DESCRIPTION_LENGTH = 12_000;
const MAX_OCR_LENGTH = 24_000;
const MAX_STYLE_DEPTH = 8;

export async function ingestImageAttachment(
	input: IngestImageAttachmentInput,
	store: AttachmentImageContextStore
): Promise<ImageContextRecord> {
	const now = input.createdAt ?? new Date();
	const capturedAt = input.capturedAt ?? now;
	ensureValidDate(now, 'createdAt');
	ensureValidDate(capturedAt, 'capturedAt');

	const mimeType = required(input.attachment.mimeType, 'attachment.mimeType').toLowerCase();
	if (!mimeType.startsWith('image/')) {
		throw new TypeError('attachment.mimeType must identify an image');
	}

	const byteSize = input.attachment.byteSize;
	if (byteSize !== undefined && (!Number.isSafeInteger(byteSize) || byteSize < 0)) {
		throw new TypeError('attachment.byteSize must be a non-negative safe integer');
	}

	const record: ImageContextRecord = {
		id: input.id ? required(input.id, 'id') : crypto.randomUUID(),
		conversationId: required(input.conversationId, 'conversationId'),
		messageId: required(input.messageId, 'messageId'),
		attachmentId: required(input.attachment.attachmentId, 'attachment.attachmentId'),
		storageKey: required(input.attachment.storageKey, 'attachment.storageKey'),
		mimeType,
		originalName: optional(input.attachment.originalName, 'attachment.originalName'),
		byteSize,
		sha256: optional(input.attachment.sha256, 'attachment.sha256'),
		description: boundedRequired(input.analysis.description, 'analysis.description', MAX_DESCRIPTION_LENGTH),
		ocrText: optionalBounded(input.analysis.ocrText, 'analysis.ocrText', MAX_OCR_LENGTH),
		styleAttributes: normaliseStyleAttributes(input.analysis.styleAttributes ?? {}),
		analysisVersion: optional(input.analysis.analysisVersion, 'analysis.analysisVersion') ?? 'v1',
		capturedAt: new Date(capturedAt),
		createdAt: new Date(now)
	};

	return store.upsert(record);
}

export async function resolveImageContext(
	conversationId: string,
	selector: ImageContextSelector,
	store: AttachmentImageContextStore
): Promise<ImageContextRecord | null> {
	const safeConversationId = required(conversationId, 'conversationId');
	if (selector.contextId) {
		return store.findById(safeConversationId, required(selector.contextId, 'selector.contextId'));
	}
	if (selector.attachmentId) {
		return store.findByAttachmentId(
			safeConversationId,
			required(selector.attachmentId, 'selector.attachmentId')
		);
	}
	if (selector.latest) {
		return (await store.listForConversation(safeConversationId, 1))[0] ?? null;
	}
	return null;
}

/** Produces bounded, model-ready context without exposing storage URLs or keys. */
export function renderImageContextsForPrompt(records: readonly ImageContextRecord[]): string {
	if (records.length === 0) return '';

	return records
		.map((record, index) => {
			const parts = [
				`Image ${index + 1} (context ID: ${record.id}; attachment ID: ${record.attachmentId})`,
				`Description: ${record.description}`,
				`Style attributes: ${JSON.stringify(record.styleAttributes)}`
			];
			if (record.ocrText) parts.push(`OCR: ${record.ocrText}`);
			return parts.join('\n');
		})
		.join('\n\n');
}

function required(value: string, name: string): string {
	const normalised = value.trim();
	if (!normalised) throw new TypeError(`${name} is required`);
	return normalised;
}

function optional(value: string | undefined, name: string): string | undefined {
	if (value === undefined) return undefined;
	return required(value, name);
}

function boundedRequired(value: string, name: string, maximum: number): string {
	const normalised = required(value, name);
	if (normalised.length > maximum) throw new RangeError(`${name} exceeds ${maximum} characters`);
	return normalised;
}

function optionalBounded(value: string | null | undefined, name: string, maximum: number): string | null {
	if (value === null || value === undefined) return null;
	return boundedRequired(value, name, maximum);
}

function ensureValidDate(value: Date, name: string): void {
	if (Number.isNaN(value.getTime())) throw new TypeError(`${name} must be a valid date`);
}

function normaliseStyleAttributes(value: StyleAttributes): StyleAttributes {
	if (!isPlainObject(value)) throw new TypeError('analysis.styleAttributes must be a plain object');
	return copyJson(value, new WeakSet<object>(), 0) as StyleAttributes;
}

function copyJson(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
	if (depth > MAX_STYLE_DEPTH) throw new RangeError('analysis.styleAttributes is nested too deeply');
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('analysis.styleAttributes contains a non-finite number');
		return value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new TypeError('analysis.styleAttributes must not contain cycles');
		seen.add(value);
		return value.map((entry) => copyJson(entry, seen, depth + 1));
	}
	if (isPlainObject(value)) {
		if (seen.has(value)) throw new TypeError('analysis.styleAttributes must not contain cycles');
		seen.add(value);
		const result: { [key: string]: JsonValue } = {};
		for (const [key, entry] of Object.entries(value)) result[key] = copyJson(entry, seen, depth + 1);
		return result;
	}
	throw new TypeError('analysis.styleAttributes must contain JSON-compatible values');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

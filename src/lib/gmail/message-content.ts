export interface GmailMessagePartBody {
	attachmentId?: string;
	data?: string;
	size?: number;
}

export interface GmailMessagePartHeader {
	name?: string;
	value?: string;
}

export interface GmailMessagePart {
	body?: GmailMessagePartBody;
	filename?: string;
	headers?: GmailMessagePartHeader[];
	mimeType?: string;
	partId?: string;
	parts?: GmailMessagePart[];
}

export interface GmailAttachment {
	attachmentId?: string;
	contentId?: string;
	data?: Uint8Array;
	disposition?: string;
	filename: string;
	mimeType: string;
	partId?: string;
	size: number;
}

export interface ExtractedGmailMessageContent {
	attachments: GmailAttachment[];
	bodyHtml?: string;
	bodyText: string;
	headers: Record<string, string>;
	messageId: string;
	permalink: string;
	threadId?: string;
}

/**
 * Builds Gmail's first-party URL for a specific provider message ID. `accountSelector`
 * may be Gmail's numeric account slot (normally "0") or the connected email address.
 */
export function buildGmailMessageUrl(messageId: string, accountSelector: string | number = 0): string {
	if (!messageId.trim()) {
		throw new Error('A Gmail message ID is required to build a permalink.');
	}

	return `https://mail.google.com/mail/u/${encodeURIComponent(String(accountSelector))}/#all/${encodeURIComponent(messageId)}`;
}

/** Decodes Gmail API base64url data into its original bytes. */
export function decodeGmailBase64Url(data: string): Uint8Array {
	const base64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

/**
 * Traverses a Gmail API MIME payload. It preserves HTML, provides readable text, and
 * returns attachment references for attachment bodies Gmail omits from the payload.
 */
export function extractGmailMessageContent(input: {
	accountSelector?: string | number;
	messageId: string;
	payload?: GmailMessagePart;
	threadId?: string;
}): ExtractedGmailMessageContent {
	const headers = collectHeaders(input.payload?.headers ?? []);
	const plainBodies: string[] = [];
	const htmlBodies: string[] = [];
	const attachments: GmailAttachment[] = [];

	visitPart(input.payload, plainBodies, htmlBodies, attachments);

	const bodyHtml = htmlBodies.length > 0 ? htmlBodies.join('\n') : undefined;
	const bodyText = plainBodies.length > 0 ? plainBodies.join('\n') : bodyHtml ? htmlToText(bodyHtml) : '';

	return {
		attachments,
		bodyHtml,
		bodyText,
		headers,
		messageId: input.messageId,
		permalink: buildGmailMessageUrl(input.messageId, input.accountSelector),
		threadId: input.threadId
	};
}

function visitPart(
	part: GmailMessagePart | undefined,
	plainBodies: string[],
	htmlBodies: string[],
	attachments: GmailAttachment[]
): void {
	if (!part) return;

	const mimeType = part.mimeType?.toLowerCase() ?? '';
	const body = part.body;
	const disposition = findHeader(part.headers, 'content-disposition');
	const contentId = findHeader(part.headers, 'content-id')?.replace(/^<|>$/g, '');
	const isAttachment = Boolean(part.filename) || /\battachment\b/i.test(disposition ?? '');

	if (isAttachment && body && (body.attachmentId || body.data)) {
		attachments.push({
			attachmentId: body.attachmentId,
			contentId,
			data: body.data ? decodeGmailBase64Url(body.data) : undefined,
			disposition,
			filename: part.filename || 'attachment',
			mimeType: part.mimeType || 'application/octet-stream',
			partId: part.partId,
			size: body.size ?? (body.data ? decodeGmailBase64Url(body.data).byteLength : 0)
		});
	} else if (body?.data) {
		const decoded = decodeText(body.data);
		if (mimeType === 'text/plain') plainBodies.push(decoded);
		if (mimeType === 'text/html') htmlBodies.push(decoded);
	}

	for (const child of part.parts ?? []) {
		visitPart(child, plainBodies, htmlBodies, attachments);
	}
}

function decodeText(data: string): string {
	return new TextDecoder('utf-8', { fatal: false }).decode(decodeGmailBase64Url(data));
}

function collectHeaders(headers: GmailMessagePartHeader[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const header of headers) {
		if (header.name && header.value !== undefined) result[header.name.toLowerCase()] = header.value;
	}
	return result;
}

function findHeader(headers: GmailMessagePartHeader[] | undefined, name: string): string | undefined {
	return headers?.find((header) => header.name?.toLowerCase() === name)?.value;
}

function htmlToText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
			.replace(/<\s*br\s*\/?>/gi, '\n')
			.replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\r/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function decodeHtmlEntities(value: string): string {
	return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
		const normalized = String(code).toLowerCase();
		if (normalized === 'amp') return '&';
		if (normalized === 'lt') return '<';
		if (normalized === 'gt') return '>';
		if (normalized === 'quot') return '"';
		if (normalized === 'apos') return "'";
		if (normalized === 'nbsp') return ' ';
		const point = normalized.startsWith('#x') ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10);
		return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
	});
}

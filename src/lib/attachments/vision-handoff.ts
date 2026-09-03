export type AttachmentRole = 'analysis' | 'style' | 'subject';

export interface AttachmentCandidate {
	id: string;
	name: string;
	mimeType: string;
	url: string;
	byteSize?: number;
	role?: AttachmentRole;
}

export interface VisionImageInput {
	type: 'input_image';
	image_url: string;
	detail: 'low' | 'high' | 'auto';
}

export interface RejectedAttachment {
	id: string;
	name: string;
	reason: string;
}

export interface NormalizedImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	url: string;
	role: AttachmentRole;
}

export interface AttachmentVisionHandoff {
	accepted: NormalizedImageAttachment[];
	rejected: RejectedAttachment[];
	visionInputs: VisionImageInput[];
	styleReferenceInputs: VisionImageInput[];
}

export interface AttachmentVisionHandoffOptions {
	maxBytes?: number;
	maxStyleReferences?: number;
	visionDetail?: VisionImageInput['detail'];
	styleDetail?: VisionImageInput['detail'];
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_STYLE_REFERENCES = 4;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function isSafeImageUrl(url: string, expectedMimeType: string): boolean {
	if (url.startsWith('data:')) {
		const match = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(url);
		return match !== null && match[1].toLowerCase() === expectedMimeType;
	}

	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

function inputFor(attachment: NormalizedImageAttachment, detail: VisionImageInput['detail']): VisionImageInput {
	return { type: 'input_image', image_url: attachment.url, detail };
}

/**
 * Produces safe, provider-neutral image inputs. Invalid attachments are reported
 * independently so a single bad upload never prevents valid images being used.
 */
export function prepareAttachmentVisionHandoff(
	attachments: readonly AttachmentCandidate[],
	options: AttachmentVisionHandoffOptions = {}
): AttachmentVisionHandoff {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxStyleReferences = options.maxStyleReferences ?? DEFAULT_MAX_STYLE_REFERENCES;
	const visionDetail = options.visionDetail ?? 'high';
	const styleDetail = options.styleDetail ?? 'high';
	const accepted: NormalizedImageAttachment[] = [];
	const rejected: RejectedAttachment[] = [];
	const seenUrls = new Set<string>();

	for (const attachment of attachments) {
		const mimeType = attachment.mimeType.trim().toLowerCase();
		const name = attachment.name.trim() || attachment.id;

		if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
			rejected.push({ id: attachment.id, name, reason: 'Only JPEG, PNG, WebP, and GIF image attachments are supported.' });
			continue;
		}
		if (attachment.byteSize !== undefined && (!Number.isSafeInteger(attachment.byteSize) || attachment.byteSize < 0 || attachment.byteSize > maxBytes)) {
			rejected.push({ id: attachment.id, name, reason: `Image exceeds the ${maxBytes}-byte size limit.` });
			continue;
		}
		if (!isSafeImageUrl(attachment.url, mimeType)) {
			rejected.push({ id: attachment.id, name, reason: 'Image must have an HTTPS URL or a matching image data URL.' });
			continue;
		}
		if (seenUrls.has(attachment.url)) {
			rejected.push({ id: attachment.id, name, reason: 'This image is already attached.' });
			continue;
		}

		seenUrls.add(attachment.url);
		accepted.push({
			id: attachment.id,
			name,
			mimeType,
			url: attachment.url,
			role: attachment.role ?? 'analysis'
		});
	}

	const styleAttachments = accepted
		.filter((attachment) => attachment.role !== 'analysis')
		.concat(accepted.filter((attachment) => attachment.role === 'analysis'))
		.slice(0, Math.max(0, maxStyleReferences));

	return {
		accepted,
		rejected,
		visionInputs: accepted.map((attachment) => inputFor(attachment, visionDetail)),
		styleReferenceInputs: styleAttachments.map((attachment) => inputFor(attachment, styleDetail))
	};
}

export interface DeckAttachment {
	id: string;
	filename: string;
	mimeType: string;
	/** A stable application download URL or provider URL for this attachment. */
	sourceUrl: string;
	/** Extracted text, such as OCR or document parsing output. */
	extractedText?: string;
}

export interface AttachmentCitation {
	attachmentId: string;
	citation: string;
	filename: string;
	mimeType: string;
	url: string;
}

export interface ImageUnderstandingInput {
	attachmentId: string;
	mimeType: string;
	imageUrl: string;
	citation: string;
}

export interface AttachmentSourceBrief {
	attachmentId: string;
	citation: string;
	filename: string;
	text: string;
}

export interface AttachmentDeckContext {
	sources: AttachmentCitation[];
	imageInputs: ImageUnderstandingInput[];
	sourceBriefs: AttachmentSourceBrief[];
	presentationInstructions: string;
}

export interface BuildAttachmentDeckContextOptions {
	maxCharactersPerAttachment?: number;
	maxTotalCharacters?: number;
}

const DEFAULT_MAX_CHARACTERS_PER_ATTACHMENT = 12_000;
const DEFAULT_MAX_TOTAL_CHARACTERS = 48_000;

/**
 * Creates provider-neutral context for a deck request. Attachment identifiers and
 * citations remain stable, so generated slide claims can be traced to uploads.
 */
export function buildAttachmentDeckContext(
	attachments: readonly DeckAttachment[],
	options: BuildAttachmentDeckContextOptions = {}
): AttachmentDeckContext {
	const maxCharactersPerAttachment = options.maxCharactersPerAttachment ?? DEFAULT_MAX_CHARACTERS_PER_ATTACHMENT;
	const maxTotalCharacters = options.maxTotalCharacters ?? DEFAULT_MAX_TOTAL_CHARACTERS;

	if (!Number.isSafeInteger(maxCharactersPerAttachment) || maxCharactersPerAttachment < 1) {
		throw new Error('maxCharactersPerAttachment must be a positive integer');
	}
	if (!Number.isSafeInteger(maxTotalCharacters) || maxTotalCharacters < 1) {
		throw new Error('maxTotalCharacters must be a positive integer');
	}

	const ids = new Set<string>();
	let remainingCharacters = maxTotalCharacters;
	const sources: AttachmentCitation[] = [];
	const imageInputs: ImageUnderstandingInput[] = [];
	const sourceBriefs: AttachmentSourceBrief[] = [];

	for (const [index, attachment] of attachments.entries()) {
		validateAttachment(attachment, ids);
		const citation = `[A${index + 1}]`;
		const source: AttachmentCitation = {
			attachmentId: attachment.id,
			citation,
			filename: attachment.filename,
			mimeType: attachment.mimeType,
			url: attachment.sourceUrl
		};
		sources.push(source);

		if (attachment.mimeType.toLowerCase().startsWith('image/')) {
			imageInputs.push({
				attachmentId: attachment.id,
				mimeType: attachment.mimeType,
				imageUrl: attachment.sourceUrl,
				citation
			});
		}

		const text = attachment.extractedText?.trim();
		if (text && remainingCharacters > 0) {
			const limit = Math.min(maxCharactersPerAttachment, remainingCharacters);
			const boundedText = text.slice(0, limit);
			sourceBriefs.push({
				attachmentId: attachment.id,
				citation,
				filename: attachment.filename,
				text: boundedText
			});
			remainingCharacters -= boundedText.length;
		}
	}

	return {
		sources,
		imageInputs,
		sourceBriefs,
		presentationInstructions: createPresentationInstructions(sources, sourceBriefs, imageInputs)
	};
}

function validateAttachment(attachment: DeckAttachment, ids: Set<string>): void {
	if (!attachment.id.trim()) throw new Error('Attachment id is required');
	if (ids.has(attachment.id)) throw new Error(`Duplicate attachment id: ${attachment.id}`);
	ids.add(attachment.id);
	if (!attachment.filename.trim()) throw new Error(`Attachment ${attachment.id} has no filename`);
	if (!attachment.mimeType.trim()) throw new Error(`Attachment ${attachment.id} has no mimeType`);
	if (!isAllowedSourceUrl(attachment.sourceUrl)) {
		throw new Error(`Attachment ${attachment.id} has an invalid sourceUrl`);
	}
}

function isAllowedSourceUrl(value: string): boolean {
	return value.startsWith('/') || value.startsWith('https://') || value.startsWith('http://') || value.startsWith('data:');
}

function createPresentationInstructions(
	sources: readonly AttachmentCitation[],
	briefs: readonly AttachmentSourceBrief[],
	images: readonly ImageUnderstandingInput[]
): string {
	const sourceList = sources.map((source) => `${source.citation} ${source.filename}`).join(', ') || 'none';
	const textList = briefs.map((brief) => `${brief.citation} ${brief.filename}`).join(', ') || 'none';
	const imageList = images.map((image) => `${image.citation} ${image.attachmentId}`).join(', ') || 'none';

	return [
		'Use the supplied attachment material as source evidence.',
		`Available citations: ${sourceList}.`,
		`Text evidence: ${textList}. Image evidence: ${imageList}.`,
		'Add one or more bracketed attachment citations (for example [A1]) to every factual claim derived from an attachment.',
		'Do not imply that an attachment supports a claim when it does not. Treat images as evidence only after image understanding has described them.'
	].join(' ');
}

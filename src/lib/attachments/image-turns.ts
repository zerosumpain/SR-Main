export type AttachmentImageOrigin = 'newly_attached' | 'shared';
export type ImageTurnKind = 'vision' | 'image_edit';

export interface AttachmentImageInput {
	id: string;
	url: string;
	mimeType: string;
	filename?: string;
	origin: AttachmentImageOrigin;
}

export interface SelectedImageAttachment {
	id: string;
	url: string;
	mimeType: string;
	filename?: string;
	origin: AttachmentImageOrigin;
	selection: 'explicit' | 'automatic';
	role: 'primary' | 'reference';
}

export interface ProviderImageContent {
	type: 'input_image';
	image_url: string;
}

export interface PrepareImageTurnOptions {
	kind: ImageTurnKind;
	attachments: readonly AttachmentImageInput[];
	selectedAttachmentIds?: readonly string[];
}

export interface PreparedImageTurnAttachments {
	selectedAttachments: SelectedImageAttachment[];
	providerContent: ProviderImageContent[];
}

const IMAGE_MIME_TYPE = /^image\/[a-z0-9.+-]+$/i;

function isUsableImage(attachment: AttachmentImageInput): boolean {
	return (
		attachment.id.trim().length > 0 &&
		attachment.url.trim().length > 0 &&
		IMAGE_MIME_TYPE.test(attachment.mimeType)
	);
}

function uniqueUsableImages(attachments: readonly AttachmentImageInput[]): AttachmentImageInput[] {
	const seen = new Set<string>();
	const result: AttachmentImageInput[] = [];

	for (const attachment of attachments) {
		if (!isUsableImage(attachment) || seen.has(attachment.id)) continue;
		seen.add(attachment.id);
		result.push(attachment);
	}

	return result;
}

/**
 * Selects images for a model turn without reading files or mutating attachment state.
 * Explicit image-edit selections are authoritative. Automatic image-edit selection
 * prefers newly attached images, while vision turns include every eligible image.
 */
export function prepareImageTurnAttachments(
	options: PrepareImageTurnOptions
): PreparedImageTurnAttachments {
	const images = uniqueUsableImages(options.attachments);
	const explicitIds = new Set(options.selectedAttachmentIds ?? []);
	const explicitlySelected = images.filter((attachment) => explicitIds.has(attachment.id));

	let selected: AttachmentImageInput[];
	let selection: SelectedImageAttachment['selection'];

	if (options.kind === 'image_edit' && explicitlySelected.length > 0) {
		selected = explicitlySelected;
		selection = 'explicit';
	} else if (options.kind === 'image_edit') {
		const newlyAttached = images.filter((attachment) => attachment.origin === 'newly_attached');
		const shared = images.filter((attachment) => attachment.origin === 'shared');
		selected = [...newlyAttached, ...shared];
		selection = 'automatic';
	} else {
		selected = images;
		selection = 'automatic';
	}

	const selectedAttachments = selected.map((attachment, index) => ({
		...attachment,
		selection,
		role: index === 0 ? ('primary' as const) : ('reference' as const)
	}));

	return {
		selectedAttachments,
		providerContent: selectedAttachments.map((attachment) => ({
			type: 'input_image' as const,
			image_url: attachment.url
		}))
	};
}

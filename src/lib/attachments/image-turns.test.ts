import { describe, expect, it } from 'vitest';
import { prepareImageTurnAttachments, type AttachmentImageInput } from '$lib/attachments/image-turns';

const images: AttachmentImageInput[] = [
	{
		id: 'shared-image',
		url: 'https://files.example.test/shared.png',
		mimeType: 'image/png',
		origin: 'shared'
	},
	{
		id: 'new-image',
		url: 'https://files.example.test/new.jpg',
		mimeType: 'image/jpeg',
		origin: 'newly_attached'
	},
	{
		id: 'document',
		url: 'https://files.example.test/notes.pdf',
		mimeType: 'application/pdf',
		origin: 'newly_attached'
	}
];

describe('prepareImageTurnAttachments', () => {
	it('includes every valid image in a vision turn and preserves provenance', () => {
		const result = prepareImageTurnAttachments({ kind: 'vision', attachments: images });

		expect(result.selectedAttachments).toMatchObject([
			{ id: 'shared-image', origin: 'shared', role: 'primary', selection: 'automatic' },
			{ id: 'new-image', origin: 'newly_attached', role: 'reference', selection: 'automatic' }
		]);
		expect(result.providerContent).toEqual([
			{ type: 'input_image', image_url: 'https://files.example.test/shared.png' },
			{ type: 'input_image', image_url: 'https://files.example.test/new.jpg' }
		]);
	});

	it('uses explicit image-edit selections as the authoritative source set', () => {
		const result = prepareImageTurnAttachments({
			kind: 'image_edit',
			attachments: images,
			selectedAttachmentIds: ['shared-image']
		});

		expect(result.selectedAttachments).toMatchObject([
			{ id: 'shared-image', role: 'primary', selection: 'explicit', origin: 'shared' }
		]);
	});

	it('automatically prioritizes newly attached images for image editing', () => {
		const result = prepareImageTurnAttachments({ kind: 'image_edit', attachments: images });

		expect(result.selectedAttachments.map((attachment) => attachment.id)).toEqual([
			'new-image',
			'shared-image'
		]);
	});

	it('ignores duplicate ids and invalid image inputs', () => {
		const result = prepareImageTurnAttachments({
			kind: 'vision',
			attachments: [
				...images,
				{ ...images[0], url: 'https://files.example.test/replacement.png' },
				{ id: '', url: 'https://files.example.test/no-id.png', mimeType: 'image/png', origin: 'shared' }
			]
		});

		expect(result.providerContent).toHaveLength(2);
		expect(result.providerContent[0]?.image_url).toBe('https://files.example.test/shared.png');
	});
});

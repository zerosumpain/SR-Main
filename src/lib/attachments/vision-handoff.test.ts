import { describe, expect, it } from 'vitest';
import { prepareAttachmentVisionHandoff } from '$lib/attachments/vision-handoff';

describe('prepareAttachmentVisionHandoff', () => {
	it('creates vision and style inputs while prioritising explicit style references', () => {
		const result = prepareAttachmentVisionHandoff([
			{ id: 'subject', name: 'Product.png', mimeType: 'image/png', url: 'https://cdn.example.test/product.png', role: 'subject' },
			{ id: 'style', name: 'Look.webp', mimeType: 'image/webp', url: 'https://cdn.example.test/look.webp', role: 'style' },
			{ id: 'context', name: 'Room.jpg', mimeType: 'image/jpeg', url: 'https://cdn.example.test/room.jpg' }
		], { maxStyleReferences: 2, visionDetail: 'auto' });

		expect(result.rejected).toEqual([]);
		expect(result.visionInputs).toEqual([
			{ type: 'input_image', image_url: 'https://cdn.example.test/product.png', detail: 'auto' },
			{ type: 'input_image', image_url: 'https://cdn.example.test/look.webp', detail: 'auto' },
			{ type: 'input_image', image_url: 'https://cdn.example.test/room.jpg', detail: 'auto' }
		]);
		expect(result.styleReferenceInputs.map((input) => input.image_url)).toEqual([
			'https://cdn.example.test/product.png',
			'https://cdn.example.test/look.webp'
		]);
	});

	it('keeps valid attachments when others are invalid or duplicated', () => {
		const result = prepareAttachmentVisionHandoff([
			{ id: 'good', name: 'good', mimeType: 'image/png', url: 'data:image/png;base64,AAAA', byteSize: 4 },
			{ id: 'bad-type', name: 'document', mimeType: 'application/pdf', url: 'https://cdn.example.test/document.pdf' },
			{ id: 'duplicate', name: 'again', mimeType: 'image/png', url: 'data:image/png;base64,AAAA' },
			{ id: 'bad-scheme', name: 'local', mimeType: 'image/jpeg', url: 'http://cdn.example.test/local.jpg' }
		]);

		expect(result.accepted.map((attachment) => attachment.id)).toEqual(['good']);
		expect(result.rejected.map((attachment) => attachment.id)).toEqual(['bad-type', 'duplicate', 'bad-scheme']);
	});

	it('rejects mismatched data URLs and oversized images', () => {
		const result = prepareAttachmentVisionHandoff([
			{ id: 'mismatch', name: 'mismatch', mimeType: 'image/png', url: 'data:image/jpeg;base64,AAAA' },
			{ id: 'large', name: 'large', mimeType: 'image/jpeg', url: 'https://cdn.example.test/large.jpg', byteSize: 101 }
		], { maxBytes: 100 });

		expect(result.accepted).toEqual([]);
		expect(result.rejected.map((attachment) => attachment.reason)).toEqual([
			'Image must have an HTTPS URL or a matching image data URL.',
			'Image exceeds the 100-byte size limit.'
		]);
	});
});

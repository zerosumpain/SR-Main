import { describe, expect, it } from 'vitest';
import { buildAttachmentDeckContext } from '$lib/decks/attachment-context';

describe('buildAttachmentDeckContext', () => {
	it('creates traceable citations and image inputs from uploads', () => {
		const context = buildAttachmentDeckContext([
			{
				id: 'report-1',
				filename: 'research.pdf',
				mimeType: 'application/pdf',
				sourceUrl: '/api/uploads/report-1',
				extractedText: 'The programme reached 82% of its target.'
			},
			{
				id: 'photo-1',
				filename: 'site.jpg',
				mimeType: 'image/jpeg',
				sourceUrl: 'https://storage.example.test/site.jpg'
			}
		]);

		expect(context.sources).toEqual([
			{ attachmentId: 'report-1', citation: '[A1]', filename: 'research.pdf', mimeType: 'application/pdf', url: '/api/uploads/report-1' },
			{ attachmentId: 'photo-1', citation: '[A2]', filename: 'site.jpg', mimeType: 'image/jpeg', url: 'https://storage.example.test/site.jpg' }
		]);
		expect(context.imageInputs).toEqual([
			{ attachmentId: 'photo-1', mimeType: 'image/jpeg', imageUrl: 'https://storage.example.test/site.jpg', citation: '[A2]' }
		]);
		expect(context.sourceBriefs).toEqual([
			{ attachmentId: 'report-1', citation: '[A1]', filename: 'research.pdf', text: 'The programme reached 82% of its target.' }
		]);
		expect(context.presentationInstructions).toContain('[A1]');
		expect(context.presentationInstructions).toContain('[A2]');
	});

	it('bounds extracted text across the request', () => {
		const context = buildAttachmentDeckContext(
			[
				{ id: 'one', filename: 'one.txt', mimeType: 'text/plain', sourceUrl: '/files/one', extractedText: 'abcdef' },
				{ id: 'two', filename: 'two.txt', mimeType: 'text/plain', sourceUrl: '/files/two', extractedText: 'ghijkl' }
			],
			{ maxCharactersPerAttachment: 4, maxTotalCharacters: 6 }
		);

		expect(context.sourceBriefs.map((brief) => brief.text)).toEqual(['abcd', 'gh']);
	});

	it('rejects duplicate ids and non-routable source URLs', () => {
		expect(() => buildAttachmentDeckContext([
			{ id: 'same', filename: 'a.txt', mimeType: 'text/plain', sourceUrl: '/a' },
			{ id: 'same', filename: 'b.txt', mimeType: 'text/plain', sourceUrl: '/b' }
		])).toThrow('Duplicate attachment id: same');

		expect(() => buildAttachmentDeckContext([
			{ id: 'bad', filename: 'a.txt', mimeType: 'text/plain', sourceUrl: 'file:///tmp/a.txt' }
		])).toThrow('invalid sourceUrl');
	});
});

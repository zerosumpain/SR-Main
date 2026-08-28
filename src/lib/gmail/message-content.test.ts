import { describe, expect, it } from 'vitest';
import {
	buildGmailMessageUrl,
	decodeGmailBase64Url,
	extractGmailMessageContent,
	type GmailMessagePart
} from '$lib/gmail/message-content';

const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

describe('buildGmailMessageUrl', () => {
	it('uses Gmail’s direct message route and safely encodes the account selector', () => {
		expect(buildGmailMessageUrl('18f-message', 'person@example.com')).toBe(
			'https://mail.google.com/mail/u/person%40example.com/#all/18f-message'
		);
	});
});

describe('extractGmailMessageContent', () => {
	it('extracts nested plain text, HTML, headers and attachment fetch metadata', () => {
		const payload: GmailMessagePart = {
			headers: [{ name: 'Subject', value: 'Order confirmation' }],
			mimeType: 'multipart/mixed',
			parts: [
				{
					mimeType: 'multipart/alternative',
					parts: [
						{ mimeType: 'text/plain', body: { data: encode('Thanks for your order.') } },
						{ mimeType: 'text/html', body: { data: encode('<p>Thanks <b>for your order</b>.</p>') } }
					]
				},
				{
					partId: '2',
					filename: 'receipt.pdf',
					mimeType: 'application/pdf',
					headers: [{ name: 'Content-ID', value: '<receipt>' }],
					body: { attachmentId: 'attachment-1', size: 1234 }
				}
			]
		};

		const result = extractGmailMessageContent({
			accountSelector: 0,
			messageId: 'message-1',
			payload,
			threadId: 'thread-1'
		});

		expect(result.bodyText).toBe('Thanks for your order.');
		expect(result.bodyHtml).toBe('<p>Thanks <b>for your order</b>.</p>');
		expect(result.headers.subject).toBe('Order confirmation');
		expect(result.permalink).toBe('https://mail.google.com/mail/u/0/#all/message-1');
		expect(result.attachments).toEqual([
			{
				attachmentId: 'attachment-1',
				contentId: 'receipt',
				data: undefined,
				disposition: undefined,
				filename: 'receipt.pdf',
				mimeType: 'application/pdf',
				partId: '2',
				size: 1234
			}
		]);
	});

	it('decodes inline attachment data and uses HTML text when no plain body exists', () => {
		const result = extractGmailMessageContent({
			messageId: 'message-2',
			payload: {
				mimeType: 'multipart/mixed',
				parts: [
					{ mimeType: 'text/html', body: { data: encode('<div>Paid &amp; dispatched</div>') } },
					{ filename: 'note.txt', mimeType: 'text/plain', body: { data: encode('é') } }
				]
			}
		});

		expect(result.bodyText).toBe('Paid & dispatched');
		expect(new TextDecoder().decode(result.attachments[0].data)).toBe('é');
		expect(new TextDecoder().decode(decodeGmailBase64Url(encode('✓')))).toBe('✓');
	});
});

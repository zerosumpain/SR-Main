import { describe, expect, it } from 'vitest';
import {
	ingestImageAttachment,
trenderImageContextsForPrompt,
	resolveImageContext,
	type AttachmentImageContextStore,
	type ImageContextRecord
} from '$lib/attachments/image-context';

class MemoryStore implements AttachmentImageContextStore {
	readonly records = new Map<string, ImageContextRecord>();

	async upsert(record: ImageContextRecord): Promise<ImageContextRecord> {
		this.records.set(`${record.conversationId}:${record.attachmentId}`, record);
		return record;
	}

	async findById(conversationId: string, id: string): Promise<ImageContextRecord | null> {
		return [...this.records.values()].find((record) => record.conversationId === conversationId && record.id === id) ?? null;
	}

	async findByAttachmentId(conversationId: string, attachmentId: string): Promise<ImageContextRecord | null> {
		return this.records.get(`${conversationId}:${attachmentId}`) ?? null;
	}

	async listForConversation(conversationId: string, limit: number): Promise<ImageContextRecord[]> {
		return [...this.records.values()]
			.filter((record) => record.conversationId === conversationId)
			.sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
			.slice(0, limit);
	}
}

describe('image attachment context ingestion', () => {
	it('normalises and persists analysis with its stable attachment reference', async () => {
		const store = new MemoryStore();
		const record = await ingestImageAttachment(
			{
				id: 'context-1',
				conversationId: ' conversation-1 ',
				messageId: ' message-1 ',
				attachment: {
					attachmentId: ' upload-1 ',
					storageKey: ' uploads/photo.png ',
					mimeType: ' IMAGE/PNG ',
					byteSize: 1234
				},
				analysis: {
					description: ' A red bicycle beside a brick wall. ',
					ocrText: 'BIKE SHOP',
					styleAttributes: { palette: ['red', 'brown'], lighting: 'daylight' }
				},
				createdAt: new Date('2025-01-02T03:04:05.000Z')
			},
			store
		);

		expect(record).toMatchObject({
			conversationId: 'conversation-1',
			attachmentId: 'upload-1',
			mimeType: 'image/png',
			description: 'A red bicycle beside a brick wall.',
			styleAttributes: { palette: ['red', 'brown'], lighting: 'daylight' }
		});
		expect(await store.findByAttachmentId('conversation-1', 'upload-1')).toEqual(record);
	});

	it('resolves a prior image and renders safe follow-up context', async () => {
		const store = new MemoryStore();
		const record = await ingestImageAttachment(
			{
				id: 'context-2',
				conversationId: 'conversation-2',
				messageId: 'message-2',
				attachment: { attachmentId: 'upload-2', storageKey: 'private/object', mimeType: 'image/jpeg' },
				analysis: { description: 'A handwritten recipe card.', ocrText: 'Add two eggs.' },
				createdAt: new Date('2025-02-01T00:00:00.000Z')
			},
			store
		);

		const resolved = await resolveImageContext('conversation-2', { attachmentId: 'upload-2' }, store);
		expect(resolved).toEqual(record);
		const prompt = renderImageContextsForPrompt([resolved!]);
		expect(prompt).toContain('A handwritten recipe card.');
		expect(prompt).toContain('Add two eggs.');
		expect(prompt).not.toContain('private/object');
	});

	it('rejects non-image attachments and non-JSON style data', async () => {
		const store = new MemoryStore();
		await expect(
			ingestImageAttachment(
				{
					conversationId: 'c',
					messageId: 'm',
					attachment: { attachmentId: 'a', storageKey: 'k', mimeType: 'application/pdf' },
					analysis: { description: 'A document.' }
				},
				store
			)
		).rejects.toThrow('must identify an image');
	});
});

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Durable analysis metadata for an image attachment. The unique key makes
 * retries idempotent once an upload has received its stable attachment ID.
 */
export const attachmentImageContexts = pgTable(
	'attachment_image_contexts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		conversationId: text('conversation_id').notNull(),
		messageId: text('message_id').notNull(),
		attachmentId: text('attachment_id').notNull(),
		storageKey: text('storage_key').notNull(),
		mimeType: text('mime_type').notNull(),
		originalName: text('original_name'),
		byteSize: text('byte_size'),
		sha256: text('sha256'),
		description: text('description').notNull(),
		ocrText: text('ocr_text'),
		styleAttributes: jsonb('style_attributes').$type<Record<string, unknown>>().notNull().default({}),
		analysisVersion: text('analysis_version').notNull(),
		capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
	},
	(table) => [
		uniqueIndex('attachment_image_contexts_conversation_attachment_unique').on(
			table.conversationId,
			table.attachmentId
		),
		index('attachment_image_contexts_conversation_captured_idx').on(
			table.conversationId,
			table.capturedAt)
	]
);

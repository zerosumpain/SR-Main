import { db } from '$lib/db';
import { orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import type { JkaiAttachment } from '$lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { HistoryMessage } from '$lib/workflows/chat/conversation-history';
import { saveBuffer } from '$lib/jkai/media/storage';
import { extensionForMime } from '$lib/jkai/media/mime';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;
type SendAttachmentFn = (to: string, att: JkaiAttachment, caption?: string) => Promise<WhatsAppSendResult>;
type TypingFn = (to: string) => Promise<void>;

/**
 * WhatsApp orchestrator bridge — now reads/writes via the unified
 * jkai_conversations + orchestrator_chats tables (source='whatsapp').
 * Task 13 will rewrite this file more thoroughly.
 */
export class OrchestratorBridge {
	private sendFn: SendFn;
	private sendAttachmentFn: SendAttachmentFn | null;
	private typingFn: TypingFn | null;
	private typingDoneFn: TypingFn | null;

	constructor(sendFn: SendFn, opts?: {
		sendAttachmentFn?: SendAttachmentFn;
		typingFn?: TypingFn;
		typingDoneFn?: TypingFn;
	}) {
		this.sendFn = sendFn;
		this.sendAttachmentFn = opts?.sendAttachmentFn || null;
		this.typingFn = opts?.typingFn || null;
		this.typingDoneFn = opts?.typingDoneFn || null;
	}

	isResetCommand(text: string): boolean {
		const cmd = text.trim().toLowerCase();
		return cmd === '/clear' || cmd === '/new';
	}

	/** Get or create a jkai_conversations row for this phone number. */
	private async ensureConversation(phoneNumber: string): Promise<string> {
		const [existing] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.whatsappPhoneNumber, phoneNumber))
			.limit(1);

		if (existing) return existing.id;

		// A WhatsApp thread is a jkai conversation like any other, so it opens on
		// the `chat` workload rather than the raw site default.
		const modelContext = await resolveChatTurnModel();
		const [created] = await db
			.insert(conversations)
			.values({
				source: 'whatsapp',
				whatsappPhoneNumber: phoneNumber,
				modelProvider: modelContext.provider,
				modelId: modelContext.modelId,
			})
			.returning({ id: conversations.id });

		return created.id;
	}

	async handleMessage(msg: WhatsAppInboundMessage): Promise<void> {
		const { from, text, replyJid } = msg;
		const replyTo = replyJid || from;

		if (this.isResetCommand(text)) {
			await this.clearConversation(from);
			await this.sendFn(replyTo, 'Conversation cleared. What can I help with?');
			return;
		}

		// D2/D3 — owner-inbound intercept: an "APPROVE <code>" / "DENY <code>"
		// (yes/no) approval reply, then a whatsapp-trigger keyword dispatch, BEFORE
		// falling through to general chat. Shared with the delegated-mode HTTP entry
		// point (/api/whatsapp/inbound) so both topologies run identical logic.
		// Imported lazily: the intercept pulls engine-resume → the eager node-
		// registry barrel, which must not widen the bridge's static import graph.
		const { interceptOwnerInbound } = await import('./inbound-intercept');
		const intercept = await interceptOwnerInbound(from, text ?? '');
		if (intercept.handled) {
			if (intercept.reply) await this.sendFn(replyTo, intercept.reply);
			return;
		}

		try {
			// Show typing indicator
			await this.typingFn?.(replyTo);

			const convId = await this.ensureConversation(from);

			// Build display text — use placeholder for media-only messages
			const displayText = !msg.text && msg.mediaKind
				? msg.mediaKind === 'audio' ? '[voice note]'
					: msg.mediaKind === 'image' ? '[image]'
					: msg.mediaKind === 'video' ? '[video]'
					: `[document: ${msg.mediaFilename ?? 'file'}]`
				: msg.text;

			// Save user message
			const [userMsg] = await db.insert(orchestratorChats).values({
				conversationId: convId,
				role: 'user',
				content: displayText,
			}).returning({ id: orchestratorChats.id });

			// Save media attachment if present
			let attachment: JkaiAttachment | null = null;
			if (msg.mediaKind && msg.mediaBuffer && msg.mediaMimeType) {
				const ext = extensionForMime(msg.mediaMimeType);
				const { diskPath, sizeBytes } = await saveBuffer(msg.mediaBuffer, ext);
				const [row] = await db.insert(jkaiAttachments).values({
					conversationId: convId,
					messageId: userMsg.id,
					source: 'whatsapp',
					kind: msg.mediaKind === 'document' ? 'document' : msg.mediaKind,
					mimeType: msg.mediaMimeType,
					originalName: msg.mediaFilename ?? null,
					sizeBytes,
					diskPath,
					duration: msg.mediaDuration ?? null,
					metadata: { whatsappMessageId: msg.messageId },
				}).returning();
				attachment = row;
			}

			// Load conversation history
			const history = await this.getConversationHistory(convId);
			const priorHistory = history.slice(0, -1);

			// The WhatsApp flow has no pinned conversation, so the turn runs on the
			// `chat` workload — the same row on /admin/ops/costs that new web threads
			// open on, rather than the raw site default every background role shares.
			const modelContext = await resolveChatTurnModel();
			const { response: responseText } = await generalChat(
				{ text: displayText, attachments: attachment ? [attachment] : [] },
				priorHistory,
				{ modelContext, priceSnapshot: null, conversationId: convId },
			);

			// Stop typing, save and send
			await this.typingDoneFn?.(replyTo);

			const [assistantMsg] = await db.insert(orchestratorChats).values({
				conversationId: convId,
				role: 'assistant',
				content: responseText,
			}).returning({ id: orchestratorChats.id });

			// Fetch attachments generated by tools during the assistant turn
			const assistantMsgId = assistantMsg?.id;
			const generatedAtts = assistantMsgId
				? await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.messageId, assistantMsgId))
				: [];

			if (generatedAtts.length === 0) {
				await this.sendFn(replyTo, responseText);
			} else if (this.sendAttachmentFn) {
				let captionSent = false;
				for (const att of generatedAtts) {
					if (!captionSent && (att.kind === 'image' || att.kind === 'document')) {
						await this.sendAttachmentFn(replyTo, att, responseText);
						captionSent = true;
					} else {
						await this.sendAttachmentFn(replyTo, att);
					}
				}
				if (!captionSent) await this.sendFn(replyTo, responseText);
			} else {
				await this.sendFn(replyTo, responseText);
			}
		} catch (err: unknown) {
			await this.typingDoneFn?.(replyTo);
			const errMsg = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[whatsapp-bridge] Error handling message from ${from}:`, errMsg);
			await this.sendFn(replyTo, 'Something went wrong. Try again in a moment.');
		}
	}

	private async getConversationHistory(
		conversationId: string,
	): Promise<HistoryMessage[]> {
		const rows = await db
			.select()
			.from(orchestratorChats)
			.where(eq(orchestratorChats.conversationId, conversationId))
			.orderBy(asc(orchestratorChats.createdAt));

		return rows.map((r) => ({
			role: r.role,
			content: r.content,
			attachments: [],
			createdAt: r.createdAt,
		}));
	}

	private async clearConversation(phoneNumber: string): Promise<void> {
		// Find the conversation for this phone number
		const [conv] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.whatsappPhoneNumber, phoneNumber))
			.limit(1);

		if (conv) {
			await db
				.delete(orchestratorChats)
				.where(eq(orchestratorChats.conversationId, conv.id));
		}
	}
}

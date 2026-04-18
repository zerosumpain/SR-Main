import { db } from '$lib/db';
import { orchestratorChats, conversations } from '$lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { HistoryMessage } from '$lib/workflows/chat/conversation-history';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;
type TypingFn = (to: string) => Promise<void>;

/**
 * WhatsApp orchestrator bridge — now reads/writes via the unified
 * jkai_conversations + orchestrator_chats tables (source='whatsapp').
 * Task 13 will rewrite this file more thoroughly.
 */
export class OrchestratorBridge {
	private sendFn: SendFn;
	private typingFn: TypingFn | null;
	private typingDoneFn: TypingFn | null;

	constructor(sendFn: SendFn, typingFn?: TypingFn, typingDoneFn?: TypingFn) {
		this.sendFn = sendFn;
		this.typingFn = typingFn || null;
		this.typingDoneFn = typingDoneFn || null;
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

		const modelContext = await resolveDefaultModel('chat');
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

		try {
			// Show typing indicator
			await this.typingFn?.(replyTo);

			const convId = await this.ensureConversation(from);

			// Save user message
			await db.insert(orchestratorChats).values({
				conversationId: convId,
				role: 'user',
				content: text,
			});

			// Load conversation history
			const history = await this.getConversationHistory(convId);
			const priorHistory = history.slice(0, -1);

			// Call general chat with admin default model (WhatsApp flow has no pinned conversation).
			const modelContext = await resolveDefaultModel('chat');
			const { response: responseText } = await generalChat({ text }, priorHistory, {
				modelContext,
				priceSnapshot: null,
			});

			// Stop typing, save and send
			await this.typingDoneFn?.(replyTo);

			await db.insert(orchestratorChats).values({
				conversationId: convId,
				role: 'assistant',
				content: responseText,
			});

			await this.sendFn(replyTo, responseText);
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

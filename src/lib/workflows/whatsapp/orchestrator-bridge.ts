import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { generalChat } from '$lib/workflows/chat/general-chat';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;
type TypingFn = (to: string) => Promise<void>;

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

			// Save user message
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'user',
				content: text,
			});

			// Load conversation history
			const history = await this.getConversationHistory(from);
			const priorHistory = history.slice(0, -1);

			// Call general chat with admin default model (WhatsApp flow has no pinned conversation).
			const modelContext = await resolveDefaultModel('chat');
			const { response: responseText } = await generalChat(text, priorHistory, {
				modelContext,
				priceSnapshot: null,
			});

			// Stop typing, save and send
			await this.typingDoneFn?.(replyTo);

			await db.insert(whatsappConversations).values({
				phoneNumber: from,
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
		phoneNumber: string,
	): Promise<Array<{ role: string; content: string }>> {
		const rows = await db
			.select()
			.from(whatsappConversations)
			.where(eq(whatsappConversations.phoneNumber, phoneNumber))
			.orderBy(asc(whatsappConversations.createdAt));

		return rows.map((r) => ({
			role: r.role,
			content: r.content,
		}));
	}

	private async clearConversation(phoneNumber: string): Promise<void> {
		await db
			.delete(whatsappConversations)
			.where(eq(whatsappConversations.phoneNumber, phoneNumber));
	}
}

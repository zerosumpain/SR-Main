import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

export class OrchestratorBridge {
	private sendFn: SendFn;

	constructor(sendFn: SendFn) {
		this.sendFn = sendFn;
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
			// Save user message
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'user',
				content: text,
			});

			// Load conversation history
			const history = await this.getConversationHistory(from);
			// Exclude the message we just saved
			const priorHistory = history.slice(0, -1);

			// Call general chat
			const { response: responseText } = await generalChat(text, priorHistory);

			// Save assistant response
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'assistant',
				content: responseText,
			});

			await this.sendFn(replyTo, responseText);
		} catch (err: unknown) {
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

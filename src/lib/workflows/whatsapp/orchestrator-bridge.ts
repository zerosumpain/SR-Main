import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { generateWorkflow } from '$lib/workflows/orchestrator';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

export class OrchestratorBridge {
	private sendFn: SendFn;
	private soulMd: string;

	constructor(sendFn: SendFn, soulMd: string) {
		this.sendFn = sendFn;
		this.soulMd = soulMd;
	}

	setSoulMd(soulMd: string): void {
		this.soulMd = soulMd;
	}

	isResetCommand(text: string): boolean {
		const cmd = text.trim().toLowerCase();
		return cmd === '/clear' || cmd === '/new';
	}

	async handleMessage(msg: WhatsAppInboundMessage): Promise<void> {
		const { from, text } = msg;

		if (this.isResetCommand(text)) {
			await this.clearConversation(from);
			await this.sendFn(from, 'Conversation cleared. What can I help with?');
			return;
		}

		try {
			// Save user message
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'user',
				content: text
			});

			// Load conversation history
			const history = await this.getConversationHistory(from);

			// Build orchestrator message with soul.md context
			const contextPrefix = this.soulMd
				? `[System context — personality and style guide]\n${this.soulMd}\n\n[User conversation history]\n`
				: '';

			const conversationContext = history
				.slice(0, -1) // Exclude the message we just saved
				.map((m) => `${m.role}: ${m.content}`)
				.join('\n');

			const fullMessage =
				contextPrefix + (conversationContext ? conversationContext + '\n\n' : '') + text;

			// Call orchestrator
			const result = await generateWorkflow(fullMessage, null);

			let responseText: string;

			if (result.followUp) {
				responseText = result.followUp;
			} else if (result.workflow) {
				responseText = result.workflow.explanation || 'Workflow created successfully.';
			} else {
				responseText =
					"I couldn't generate a workflow from that. Could you be more specific about what you'd like to automate?";
			}

			// Save assistant response
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'assistant',
				content: responseText
			});

			await this.sendFn(from, responseText);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[whatsapp-bridge] Error handling message from ${from}:`, errMsg);
			await this.sendFn(from, 'Something went wrong. Try again in a moment.');
		}
	}

	private async getConversationHistory(
		phoneNumber: string
	): Promise<Array<{ role: string; content: string }>> {
		const rows = await db
			.select()
			.from(whatsappConversations)
			.where(eq(whatsappConversations.phoneNumber, phoneNumber))
			.orderBy(asc(whatsappConversations.createdAt));

		return rows.map((r) => ({
			role: r.role,
			content: r.content
		}));
	}

	private async clearConversation(phoneNumber: string): Promise<void> {
		await db
			.delete(whatsappConversations)
			.where(eq(whatsappConversations.phoneNumber, phoneNumber));
	}
}

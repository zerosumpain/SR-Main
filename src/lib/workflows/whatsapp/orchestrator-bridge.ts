import { db } from '$lib/db';
import { whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { generateWorkflow } from '$lib/workflows/orchestrator';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

const SYSTEM_PROMPT = `You are a personal AI assistant available via WhatsApp. You are deeply integrated with your user's personal platform (strangeramblings.com) which includes:

- A workflow automation engine that can create and run automations (data pipelines, scheduled tasks, API integrations, notifications)
- Health data from Strava (activities, stats) and Apple Watch (heart rate, recovery)
- A blog/CMS system
- Weather and location-aware features

You can help with anything: answer questions, do research, have a conversation, give advice, brainstorm ideas, help with tasks, or create automations.

When the user asks you to SET UP, CREATE, BUILD, or AUTOMATE something that sounds like a recurring task or data pipeline, respond with your plan and add the marker [WORKFLOW_NEEDED] at the very end of your message. This tells the system to route the next step to the workflow builder. Only use this marker when the user is explicitly asking for automation — not for one-off questions or conversations.

Keep responses concise — this is WhatsApp, not an essay. Be direct, useful, and natural.`;

const MAX_HISTORY = 30; // messages to include as context

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

			// Build messages for the LLM
			const systemContent = this.soulMd
				? `${SYSTEM_PROMPT}\n\n--- Personality & Style ---\n${this.soulMd}`
				: SYSTEM_PROMPT;

			const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
				{ role: 'system', content: systemContent },
			];

			// Add conversation history (last N messages, excluding the one we just saved)
			const recentHistory = history.slice(-MAX_HISTORY - 1, -1);
			for (const h of recentHistory) {
				messages.push({
					role: h.role as 'user' | 'assistant',
					content: h.content,
				});
			}

			// Add current message
			messages.push({ role: 'user', content: text });

			// Call LLM
			const client = getOpenAIClient();
			const model = getModel();

			let response;
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					response = await client.chat.completions.create({
						model,
						messages,
						temperature: 0.7,
						max_tokens: 1024,
					});
					break;
				} catch (err: any) {
					if (err?.status === 429 && attempt < 2) {
						await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
						continue;
					}
					throw err;
				}
			}

			let responseText = response?.choices[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response.";

			// Check if the LLM flagged this as needing a workflow
			const needsWorkflow = responseText.includes('[WORKFLOW_NEEDED]');
			responseText = responseText.replace(/\[WORKFLOW_NEEDED\]/g, '').trim();

			// Save assistant response
			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'assistant',
				content: responseText,
			});

			await this.sendFn(replyTo, responseText);

			// If workflow was flagged, kick off the workflow orchestrator in the background
			if (needsWorkflow) {
				this.buildWorkflow(from, replyTo, text).catch((err) => {
					console.error('[whatsapp-bridge] Workflow generation failed:', err);
				});
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[whatsapp-bridge] Error handling message from ${from}:`, errMsg);
			await this.sendFn(replyTo, 'Something went wrong. Try again in a moment.');
		}
	}

	private async buildWorkflow(from: string, replyTo: string, userMessage: string): Promise<void> {
		try {
			const result = await generateWorkflow(userMessage, null);

			let followUp: string;
			if (result.workflow) {
				followUp = `Workflow "${result.workflow.name}" created. ${result.workflow.explanation || ''}`.trim();
			} else if (result.followUp) {
				followUp = result.followUp;
			} else {
				return; // Nothing to report
			}

			await db.insert(whatsappConversations).values({
				phoneNumber: from,
				role: 'assistant',
				content: followUp,
			});

			await this.sendFn(replyTo, followUp);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[whatsapp-bridge] Workflow build failed:`, errMsg);
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

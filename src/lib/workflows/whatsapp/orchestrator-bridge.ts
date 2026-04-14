import { db } from '$lib/db';
import { whatsappConversations, homeAssistantConfig } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
import { SITE_TOOL_DEFINITIONS, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

const SYSTEM_PROMPT = `You are a personal AI assistant available via WhatsApp. You are deeply integrated with your user's personal platform (strangeramblings.com) which includes:

- A workflow automation engine that can create and run automations (data pipelines, scheduled tasks, API integrations, notifications)
- Health data from Strava (activities, stats) and Apple Watch (heart rate, recovery)
- A blog/CMS system
- Weather and location-aware features
- Smart home control via Home Assistant (if configured)

You can help with anything: answer questions, do research, have a conversation, give advice, brainstorm ideas, help with tasks, or control smart home devices.

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

			// Load HA entity context if available
			let haEntities: any[] = [];
			try {
				const [haConfig] = await db
					.select()
					.from(homeAssistantConfig)
					.where(eq(homeAssistantConfig.id, 'default'))
					.limit(1);
				if (haConfig?.token && Array.isArray(haConfig.entityRegistry)) {
					haEntities = haConfig.entityRegistry as any[];
				}
			} catch {}

			// Build messages for the LLM
			const haSection = buildHASystemPromptSection(haEntities);
			const siteSection = buildSiteSystemPromptSection();
			const systemContent = this.soulMd
				? `${SYSTEM_PROMPT}${haSection}${siteSection}\n\n--- Personality & Style ---\n${this.soulMd}`
				: `${SYSTEM_PROMPT}${haSection}${siteSection}`;

			const messages: Array<any> = [
				{ role: 'system', content: systemContent },
			];

			const recentHistory = history.slice(-MAX_HISTORY - 1, -1);
			for (const h of recentHistory) {
				messages.push({ role: h.role, content: h.content });
			}
			messages.push({ role: 'user', content: text });

			// Call LLM with HA tools
			const client = getOpenAIClient();
			const model = getModel();
			const allTools = [...(haEntities.length > 0 ? HA_TOOL_DEFINITIONS : []), ...SITE_TOOL_DEFINITIONS];
			const tools = allTools.length > 0 ? allTools : undefined;

			let responseText = '';
			const MAX_TOOL_ROUNDS = 5;

			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				let response;
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						response = await client.chat.completions.create({
							model,
							messages,
							temperature: 0.7,
							max_tokens: 1024,
							...(tools ? { tools } : {}),
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

				const choice = response?.choices[0];
				if (!choice) break;

				const msg = choice.message;

				if (!msg.tool_calls || msg.tool_calls.length === 0) {
					responseText = msg.content?.trim() || "Sorry, I couldn't generate a response.";
					break;
				}

				// Process tool calls
				messages.push(msg);

				for (const toolCall of msg.tool_calls) {
					const fnName = toolCall.function.name;
					let fnArgs: Record<string, unknown>;
					try {
						fnArgs = JSON.parse(toolCall.function.arguments);
					} catch {
						messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
						continue;
					}

					let toolResult: any;
					const haService = getHomeAssistantService();

					switch (fnName) {
						case 'ha_query_state':
							toolResult = await haService.queryState(fnArgs.entity_id as string);
							break;
						case 'ha_call_service':
							toolResult = await haService.callService(
								fnArgs.domain as string,
								fnArgs.service as string,
								fnArgs.entity_id as string | undefined,
								fnArgs.data as Record<string, unknown> | undefined,
							);
							break;
						case 'ha_fire_event':
							toolResult = await haService.fireEvent(
								fnArgs.event_type as string,
								fnArgs.data as Record<string, unknown> | undefined,
							);
							break;
						case 'ha_get_history':
							toolResult = await haService.getHistory(
								fnArgs.entity_id as string,
								fnArgs.start as string | undefined,
								fnArgs.end as string | undefined,
							);
							break;
						case 'ha_render_template':
							toolResult = await haService.renderTemplate(fnArgs.template as string);
							break;
						default:
							if (fnName.startsWith('site_') || fnName.startsWith('jkai_') || fnName.startsWith('research_')) {
								toolResult = await executeSiteTool(fnName, fnArgs);
							} else {
								toolResult = { error: `Unknown function: ${fnName}` };
							}
					}

					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						content: JSON.stringify(toolResult),
					});
				}
			}

			if (!responseText) {
				responseText = "Sorry, I couldn't generate a response.";
			}

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

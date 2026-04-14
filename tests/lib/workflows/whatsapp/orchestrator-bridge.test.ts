import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('$lib/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () => mockDbSelect(),
					limit: () => Promise.resolve([]),
				}),
			}),
		}),
		insert: () => ({
			values: (v: unknown) => {
				mockDbInsert(v);
				return { returning: vi.fn().mockResolvedValue([]) };
			},
		}),
		delete: () => ({
			where: () => mockDbDelete(),
		}),
	},
}));

vi.mock('$lib/db/schema', () => ({
	whatsappConversations: {},
	whatsappConfig: {},
	homeAssistantConfig: {},
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	asc: vi.fn(),
	and: vi.fn(),
}));

// Mock LLM client
const mockCreate = vi.fn();
vi.mock('$lib/deepdive/keys', () => ({
	getOpenAIClient: () => ({
		chat: {
			completions: {
				create: mockCreate,
			},
		},
	}),
	getModel: () => 'test-model',
}));

// Mock HA service and tools
vi.mock('$lib/workflows/homeassistant/service', () => ({
	getHomeAssistantService: () => ({}),
}));
vi.mock('$lib/workflows/homeassistant/llm-tools', () => ({
	HA_TOOL_DEFINITIONS: [],
	buildHASystemPromptSection: () => '',
}));
vi.mock('$lib/workflows/site-tools/llm-tools', () => ({
	SITE_TOOL_DEFINITIONS: [],
	buildSiteSystemPromptSection: () => '',
}));
vi.mock('$lib/workflows/site-tools/executor', () => ({
	executeSiteTool: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock('$lib/workflows/prompts/loader', () => ({
	getCompiledPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
}));

import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import type { WhatsAppInboundMessage } from '$lib/workflows/whatsapp/types';

describe('OrchestratorBridge', () => {
	let bridge: OrchestratorBridge;
	let sendFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		sendFn = vi.fn().mockResolvedValue({ sent: true });
		bridge = new OrchestratorBridge(sendFn);
		mockDbSelect.mockResolvedValue([]);
	});

	it('detects /clear command', () => {
		expect(bridge.isResetCommand('/clear')).toBe(true);
		expect(bridge.isResetCommand('/new')).toBe(true);
		expect(bridge.isResetCommand('/CLEAR')).toBe(true);
		expect(bridge.isResetCommand('hello')).toBe(false);
	});

	it('detects /clear as a reset and does not forward to LLM', async () => {
		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: '/clear',
			timestamp: Date.now(),
			messageId: 'msg-1',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith('447359228511', expect.stringContaining('cleared'));
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('sends regular messages to LLM and replies', async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: 'The weather looks great today!' } }],
		});

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: "What's the weather like?",
			timestamp: Date.now(),
			messageId: 'msg-2',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'test-model',
				messages: expect.arrayContaining([
					expect.objectContaining({ role: 'system' }),
					expect.objectContaining({ role: 'user', content: "What's the weather like?" }),
				]),
			}),
		);
		expect(sendFn).toHaveBeenCalledWith('447359228511', 'The weather looks great today!');
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it('returns fallback when LLM gives empty response', async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: '' } }],
		});

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'Set up a daily weather notification',
			timestamp: Date.now(),
			messageId: 'msg-3',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith(
			'447359228511',
			"Sorry, I couldn't generate a response.",
		);
	});

	it('uses replyJid for LID messages', async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: 'Hello!' } }],
		});

		const msg: WhatsAppInboundMessage = {
			from: '179598537011308',
			replyJid: '179598537011308@lid',
			text: 'Hi there',
			timestamp: Date.now(),
			messageId: 'msg-4',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith('179598537011308@lid', 'Hello!');
	});
});

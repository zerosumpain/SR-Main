import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB — the bridge now does:
//   db.select().from(conversations).where(...).limit(1)  → ensureConversation lookup
//   db.insert(conversations).values(...).returning(...)   → ensureConversation create
//   db.insert(orchestratorChats).values(...)              → save message
//   db.select().from(orchestratorChats).where(...).orderBy(...) → getConversationHistory
//   db.select().from(conversations).where(...).limit(1)   → clearConversation lookup
//   db.delete(orchestratorChats).where(...)               → clearConversation delete

const mockConvId = 'conv-test-123';

const mockDbChain = {
	from: vi.fn().mockReturnThis(),
	where: vi.fn().mockReturnThis(),
	orderBy: vi.fn().mockResolvedValue([]),
	limit: vi.fn().mockResolvedValue([{ id: mockConvId }]),
};

vi.mock('$lib/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () => mockDbChain.orderBy(),
					limit: () => mockDbChain.limit(),
				}),
			}),
		}),
		insert: () => ({
			values: () => ({
				returning: () => Promise.resolve([{ id: mockConvId }]),
			}),
		}),
		delete: () => ({
			where: () => Promise.resolve(),
		}),
	},
}));

vi.mock('$lib/db/schema', () => ({
	conversations: {},
	orchestratorChats: {},
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	asc: vi.fn(),
	desc: vi.fn(),
}));

// Mock resolveDefaultModel
vi.mock('$lib/server/models/settings', () => ({
	resolveDefaultModel: vi.fn().mockResolvedValue({
		provider: 'zai',
		modelId: 'glm-5',
		displayName: 'GLM 5',
	}),
}));

// Mock general chat
const mockGeneralChat = vi.fn();
vi.mock('$lib/workflows/chat/general-chat', () => ({
	generalChat: (...args: unknown[]) => mockGeneralChat(...args),
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
		mockDbChain.orderBy.mockResolvedValue([]);
		mockDbChain.limit.mockResolvedValue([{ id: mockConvId }]);
	});

	it('detects /clear command', () => {
		expect(bridge.isResetCommand('/clear')).toBe(true);
		expect(bridge.isResetCommand('/new')).toBe(true);
		expect(bridge.isResetCommand('/CLEAR')).toBe(true);
		expect(bridge.isResetCommand('hello')).toBe(false);
	});

	it('detects /clear as a reset and does not forward to chat', async () => {
		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: '/clear',
			timestamp: Date.now(),
			messageId: 'msg-1',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith('447359228511', expect.stringContaining('cleared'));
		expect(mockGeneralChat).not.toHaveBeenCalled();
	});

	it('sends regular messages to generalChat and replies', async () => {
		mockGeneralChat.mockResolvedValue({ response: 'The weather looks great today!' });

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: "What's the weather like?",
			timestamp: Date.now(),
			messageId: 'msg-2',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(mockGeneralChat).toHaveBeenCalledWith(
			{ text: "What's the weather like?" },
			expect.any(Array),
			expect.any(Object),
		);
		expect(sendFn).toHaveBeenCalledWith('447359228511', 'The weather looks great today!');
	});

	it('handles generalChat errors gracefully', async () => {
		mockGeneralChat.mockRejectedValue(new Error('LLM failed'));

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'test',
			timestamp: Date.now(),
			messageId: 'msg-3',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith(
			'447359228511',
			'Something went wrong. Try again in a moment.',
		);
	});

	it('uses replyJid for LID messages', async () => {
		mockGeneralChat.mockResolvedValue({ response: 'Hello!' });

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

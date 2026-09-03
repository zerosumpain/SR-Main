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
	orchestratorChats: { id: 'id' },
	jkaiAttachments: {},
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
	// The workload registry reads `getSetting` before falling through to the
	// site default, so a settings mock without it throws rather than resolving.
	getSetting: vi.fn().mockResolvedValue(null),
}));

// Mock media utilities
vi.mock('$lib/jkai/media/storage', () => ({
	saveBuffer: vi.fn().mockResolvedValue({ diskPath: '2026/04/test.jpg', sizeBytes: 1024 }),
}));

vi.mock('$lib/jkai/media/mime', () => ({
	extensionForMime: vi.fn().mockReturnValue('jpg'),
}));

// Mock general chat
const mockGeneralChat = vi.fn();
vi.mock('$lib/workflows/chat/general-chat', () => ({
	generalChat: (...args: unknown[]) => mockGeneralChat(...args),
}));

// Mock the D2 approval-reply interceptor. The real module (via engine-resume)
// eagerly imports the whole node-registry barrel, which this test deliberately
// does not stub; the bridge only needs its {handled} contract here.
const mockHandleApprovalReply = vi.fn();
vi.mock('$lib/workflows/whatsapp/approval-inbound', () => ({
	handleApprovalReply: (...args: unknown[]) => mockHandleApprovalReply(...args),
}));

// Mock the D3 whatsapp-trigger dispatcher. The real module pulls in the engine
// barrel; the bridge only needs its { dispatched } contract here.
const mockDispatchWhatsAppWorkflow = vi.fn();
vi.mock('$lib/workflows/whatsapp/workflow-dispatch', () => ({
	dispatchWhatsAppWorkflow: (...args: unknown[]) => mockDispatchWhatsAppWorkflow(...args),
}));

import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from '$lib/workflows/whatsapp/types';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;

describe('OrchestratorBridge', () => {
	let bridge: OrchestratorBridge;
	let sendFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		sendFn = vi.fn().mockResolvedValue({ sent: true });
		bridge = new OrchestratorBridge(sendFn as unknown as SendFn);
		mockDbChain.orderBy.mockResolvedValue([]);
		mockDbChain.limit.mockResolvedValue([{ id: mockConvId }]);
		mockHandleApprovalReply.mockResolvedValue({ handled: false });
		mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: false });
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
			{ text: "What's the weather like?", attachments: [] },
			expect.any(Array),
			expect.objectContaining({ conversationId: mockConvId }),
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

	it('intercepts a handled approval reply and does not forward to chat', async () => {
		mockHandleApprovalReply.mockResolvedValue({ handled: true, reply: 'Approved ABC123.' });

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'APPROVE ABC123',
			timestamp: Date.now(),
			messageId: 'msg-approve',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(mockHandleApprovalReply).toHaveBeenCalledWith('447359228511', 'APPROVE ABC123');
		expect(sendFn).toHaveBeenCalledWith('447359228511', 'Approved ABC123.');
		expect(mockGeneralChat).not.toHaveBeenCalled();
	});

	it('dispatches a matching whatsapp-trigger workflow and does not forward to chat', async () => {
		mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: true, workflowName: 'News Digest' });

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'news bitcoin',
			timestamp: Date.now(),
			messageId: 'msg-wf',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(mockDispatchWhatsAppWorkflow).toHaveBeenCalledWith('447359228511', 'news bitcoin');
		expect(sendFn).toHaveBeenCalledWith('447359228511', '▶ Started News Digest');
		expect(mockGeneralChat).not.toHaveBeenCalled();
	});

	it('runs the approval intercept BEFORE workflow dispatch (approval wins)', async () => {
		mockHandleApprovalReply.mockResolvedValue({ handled: true, reply: '✓ Approved.' });

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'approve ABC123',
			timestamp: Date.now(),
			messageId: 'msg-order',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		expect(mockHandleApprovalReply).toHaveBeenCalled();
		expect(mockDispatchWhatsAppWorkflow).not.toHaveBeenCalled();
		expect(mockGeneralChat).not.toHaveBeenCalled();
		expect(sendFn).toHaveBeenCalledWith('447359228511', '✓ Approved.');
	});

	it('orders interceptors approval → workflow dispatch → chat for an unmatched message', async () => {
		mockGeneralChat.mockResolvedValue({ response: 'Sure!' });

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'hello there',
			timestamp: Date.now(),
			messageId: 'msg-fallthrough',
			isGroup: false,
		};

		await bridge.handleMessage(msg);

		// All three ran, in order, and chat produced the reply.
		expect(mockHandleApprovalReply).toHaveBeenCalled();
		expect(mockDispatchWhatsAppWorkflow).toHaveBeenCalledWith('447359228511', 'hello there');
		expect(mockGeneralChat).toHaveBeenCalled();
		const approvalOrder = mockHandleApprovalReply.mock.invocationCallOrder[0];
		const dispatchOrder = mockDispatchWhatsAppWorkflow.mock.invocationCallOrder[0];
		const chatOrder = mockGeneralChat.mock.invocationCallOrder[0];
		expect(approvalOrder).toBeLessThan(dispatchOrder);
		expect(dispatchOrder).toBeLessThan(chatOrder);
		expect(sendFn).toHaveBeenCalledWith('447359228511', 'Sure!');
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

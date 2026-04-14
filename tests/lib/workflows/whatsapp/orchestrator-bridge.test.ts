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
					orderBy: () => mockDbSelect()
				})
			})
		}),
		insert: () => ({
			values: (v: unknown) => {
				mockDbInsert(v);
				return { returning: vi.fn().mockResolvedValue([]) };
			}
		}),
		delete: () => ({
			where: () => mockDbDelete()
		})
	}
}));

vi.mock('$lib/db/schema', () => ({
	whatsappConversations: {},
	whatsappConfig: {}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	asc: vi.fn(),
	and: vi.fn()
}));

// Mock orchestrator
const mockGenerateWorkflow = vi.fn();
vi.mock('$lib/workflows/orchestrator', () => ({
	generateWorkflow: (...args: unknown[]) => mockGenerateWorkflow(...args)
}));

import { OrchestratorBridge } from '$lib/workflows/whatsapp/orchestrator-bridge';
import type { WhatsAppInboundMessage } from '$lib/workflows/whatsapp/types';

describe('OrchestratorBridge', () => {
	let bridge: OrchestratorBridge;
	let sendFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		sendFn = vi.fn().mockResolvedValue({ sent: true });
		bridge = new OrchestratorBridge(sendFn, '');
		mockDbSelect.mockResolvedValue([]);
	});

	it('detects /clear command', () => {
		expect(bridge.isResetCommand('/clear')).toBe(true);
		expect(bridge.isResetCommand('/new')).toBe(true);
		expect(bridge.isResetCommand('/CLEAR')).toBe(true);
		expect(bridge.isResetCommand('hello')).toBe(false);
	});

	it('detects /clear as a reset and does not forward to orchestrator', async () => {
		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: '/clear',
			timestamp: Date.now(),
			messageId: 'msg-1',
			isGroup: false
		};

		await bridge.handleMessage(msg);

		expect(sendFn).toHaveBeenCalledWith('447359228511', expect.stringContaining('cleared'));
		expect(mockGenerateWorkflow).not.toHaveBeenCalled();
	});

	it('forwards regular messages to orchestrator', async () => {
		mockGenerateWorkflow.mockResolvedValue({
			workflow: null,
			followUp: 'Here is my response',
			messages: []
		});

		const msg: WhatsAppInboundMessage = {
			from: '447359228511',
			text: 'What workflows do I have?',
			timestamp: Date.now(),
			messageId: 'msg-2',
			isGroup: false
		};

		await bridge.handleMessage(msg);

		expect(mockGenerateWorkflow).toHaveBeenCalled();
		expect(sendFn).toHaveBeenCalledWith('447359228511', 'Here is my response');
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock baileys before importing service
vi.mock('@whiskeysockets/baileys', () => {
	const mockSock = {
		ev: {
			on: vi.fn(),
			off: vi.fn()
		},
		sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-123' } }),
		logout: vi.fn().mockResolvedValue(undefined),
		end: vi.fn(),
		user: { id: '447359228511:1@s.whatsapp.net' }
	};

	return {
		default: vi.fn(() => mockSock),
		makeWASocket: vi.fn(() => mockSock),
		useMultiFileAuthState: vi.fn().mockResolvedValue({
			state: { creds: {}, keys: {} },
			saveCreds: vi.fn()
		}),
		fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 0] }),
		makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
		DisconnectReason: {
			loggedOut: 401,
			connectionClosed: 428,
			connectionLost: 408,
			timedOut: 408
		}
	};
});


import { WhatsAppService } from '$lib/workflows/whatsapp/service';

describe('WhatsAppService', () => {
	let service: WhatsAppService;

	beforeEach(() => {
		service = new WhatsAppService();
	});

	it('starts in disconnected state', () => {
		const state = service.getState();
		expect(state.status).toBe('disconnected');
		expect(state.qrCode).toBeNull();
		expect(state.connectedNumber).toBeNull();
	});

	it('formats phone numbers to WhatsApp JID', () => {
		expect(service.toJid('+447359228511')).toBe('447359228511@s.whatsapp.net');
		expect(service.toJid('447359228511')).toBe('447359228511@s.whatsapp.net');
	});

	it('extracts phone number from JID', () => {
		expect(service.fromJid('447359228511@s.whatsapp.net')).toBe('447359228511');
		expect(service.fromJid('447359228511:1@s.whatsapp.net')).toBe('447359228511');
	});

	it('checks allowlist correctly', () => {
		service.setAllowedNumbers(['+447359228511', '+12025551234']);
		expect(service.isAllowed('447359228511')).toBe(true);
		expect(service.isAllowed('+447359228511')).toBe(true);
		expect(service.isAllowed('12025551234')).toBe(true);
		expect(service.isAllowed('9999999999')).toBe(false);
	});

	it('allows all numbers when allowlist is empty', () => {
		service.setAllowedNumbers([]);
		expect(service.isAllowed('447359228511')).toBe(true);
		expect(service.isAllowed('anything')).toBe(true);
	});
});

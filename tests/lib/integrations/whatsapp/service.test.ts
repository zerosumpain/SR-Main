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
		user: { id: '447700900123:1@s.whatsapp.net' }
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


import { WhatsAppService } from '$lib/integrations/whatsapp/service';

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
		expect(service.toJid('+447700900123')).toBe('447700900123@s.whatsapp.net');
		expect(service.toJid('447700900123')).toBe('447700900123@s.whatsapp.net');
	});

	it('extracts phone number from JID', () => {
		expect(service.fromJid('447700900123@s.whatsapp.net')).toBe('447700900123');
		expect(service.fromJid('447700900123:1@s.whatsapp.net')).toBe('447700900123');
	});

	it('checks allowlist correctly', () => {
		service.setAllowedNumbers(['+447700900123', '+12025551234']);
		expect(service.isAllowed('447700900123')).toBe(true);
		expect(service.isAllowed('+447700900123')).toBe(true);
		expect(service.isAllowed('12025551234')).toBe(true);
		expect(service.isAllowed('9999999999')).toBe(false);
	});

	// Fail closed since the 28 Oct lane fix: an empty list is nobody, not everybody.
	it('refuses every number when the allowlist is empty', () => {
		service.setAllowedNumbers([]);
		expect(service.isAllowed('447700900123')).toBe(false);
		expect(service.isAllowed('anything')).toBe(false);
	});
});

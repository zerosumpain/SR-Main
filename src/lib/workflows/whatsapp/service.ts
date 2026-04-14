import makeWASocket, {
	useMultiFileAuthState,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	DisconnectReason
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { mkdirSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';
import type {
	WhatsAppServiceStatus,
	WhatsAppServiceState,
	WhatsAppInboundMessage,
	WhatsAppSendResult
} from './types';

type MessageHandler = (msg: WhatsAppInboundMessage) => void;

export class WhatsAppService {
	private sock: ReturnType<typeof makeWASocket> | null = null;
	private status: WhatsAppServiceStatus = 'disconnected';
	private qrCode: string | null = null;
	private connectedNumber: string | null = null;
	private allowedNumbers: Set<string> = new Set();
	private messageHandler: MessageHandler | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private saveCreds: (() => Promise<void>) | null = null;
	private credsWriteQueue: Promise<void> = Promise.resolve();

	getState(): WhatsAppServiceState {
		return {
			status: this.status,
			qrCode: this.qrCode,
			connectedNumber: this.connectedNumber
		};
	}

	setAllowedNumbers(numbers: string[]): void {
		this.allowedNumbers = new Set(numbers.map((n) => n.replace(/^\+/, '')));
	}

	isAllowed(number: string): boolean {
		if (this.allowedNumbers.size === 0) return true;
		const normalized = number.replace(/^\+/, '');
		return this.allowedNumbers.has(normalized);
	}

	onMessage(handler: MessageHandler): void {
		this.messageHandler = handler;
	}

	toJid(phoneNumber: string): string {
		const cleaned = phoneNumber.replace(/^\+/, '');
		return `${cleaned}@s.whatsapp.net`;
	}

	fromJid(jid: string): string {
		return jid.split('@')[0].split(':')[0];
	}

	async connect(authDir: string): Promise<void> {
		if (this.status === 'connected' || this.status === 'connecting') return;
		this.status = 'connecting';
		this.qrCode = null;

		mkdirSync(authDir, { recursive: true });

		const { state, saveCreds } = await useMultiFileAuthState(authDir);
		this.saveCreds = saveCreds;

		const { version } = await fetchLatestBaileysVersion();

		this.sock = makeWASocket({
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, undefined as any)
			},
			version,
			printQRInTerminal: false,
			browser: ['strange-rambling', 'workflows', '1.0'],
			syncFullHistory: false,
			markOnlineOnConnect: false
		});

		this.sock.ev.on('creds.update', () => {
			this.credsWriteQueue = this.credsWriteQueue.then(async () => {
				try {
					await this.saveCreds?.();
					// Best-effort chmod 600 on auth files
					try {
						const files = readdirSync(authDir);
						for (const file of files) {
							chmodSync(join(authDir, file), 0o600);
						}
					} catch {}
				} catch (err) {
					console.error('[whatsapp] Failed to save credentials:', err);
				}
			});
		});

		this.sock.ev.on('connection.update', (update: any) => {
			const { connection, lastDisconnect, qr } = update;

			if (qr) {
				this.status = 'qr_pending';
				this.qrCode = qr;
			}

			if (connection === 'open') {
				this.status = 'connected';
				this.qrCode = null;
				this.reconnectAttempts = 0;
				const rawId = this.sock?.user?.id;
				this.connectedNumber = rawId ? this.fromJid(rawId) : null;
				console.log(`[whatsapp] Connected as ${this.connectedNumber}`);
			}

			if (connection === 'close') {
				const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
				const isLoggedOut = statusCode === DisconnectReason.loggedOut;

				// Always mark as disconnected so reconnect guard doesn't block
				this.status = 'disconnected';
				this.connectedNumber = null;
				this.sock = null;

				if (isLoggedOut) {
					console.log('[whatsapp] Logged out — clearing session');
				} else if (this.reconnectAttempts < this.maxReconnectAttempts) {
					this.reconnectAttempts++;
					const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
					console.log(
						`[whatsapp] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
					);
					setTimeout(() => this.connect(authDir), delay);
				} else {
					console.log('[whatsapp] Max reconnect attempts reached');
				}
			}
		});

		this.sock.ev.on('messages.upsert', (upsert: any) => {
			if (!this.messageHandler) return;
			const { messages } = upsert;

			for (const msg of messages) {
				if (!msg.message || msg.key.fromMe) continue;

				const text =
					msg.message.conversation || msg.message.extendedTextMessage?.text || '';

				if (!text) continue;

				const remoteJid = msg.key.remoteJid || '';
				const isGroup = remoteJid.endsWith('@g.us');
				const isLid = remoteJid.endsWith('@lid');

				if (isGroup) continue; // Skip group messages for now

				// For LID JIDs (newer WhatsApp format), try to get phone from participant or notify
				let from: string;
				if (isLid) {
					// LID JIDs don't contain the phone number directly.
					// Use participant if available, otherwise use pushName/notify for logging
					const participant = msg.key.participant;
					if (participant && participant.includes('@s.whatsapp.net')) {
						from = this.fromJid(participant);
					} else {
						// Accept LID messages — we can't resolve to phone but they're direct messages
						from = this.fromJid(remoteJid);
						console.log(`[whatsapp] LID message from ${from} (pushName: ${msg.pushName || 'unknown'})`);
					}
				} else {
					from = this.fromJid(remoteJid);
				}

				if (!isLid && !this.isAllowed(from)) {
					console.log(`[whatsapp] Blocked message from unapproved number: ${from}`);
					continue;
				}

				this.messageHandler({
					from,
					replyJid: isLid ? remoteJid : undefined,
					text,
					timestamp: msg.messageTimestamp as number,
					messageId: msg.key.id || '',
					isGroup,
					groupId: isGroup ? remoteJid : undefined,
				});
			}
		});
	}

	async disconnect(): Promise<void> {
		if (this.sock) {
			this.sock.end(undefined);
			this.sock = null;
		}
		this.status = 'disconnected';
		this.qrCode = null;
		this.connectedNumber = null;
		this.reconnectAttempts = 0;
	}

	async sendMessage(to: string, text: string): Promise<WhatsAppSendResult> {
		if (!this.sock || this.status !== 'connected') {
			return { sent: false, error: 'WhatsApp not connected' };
		}

		try {
			// If 'to' already contains @ it's a full JID (e.g. LID), use as-is
			const jid = to.includes('@') ? to : this.toJid(to);
			const result = await this.sock.sendMessage(jid, { text });
			return { sent: true, messageId: result?.key?.id || undefined };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error('[whatsapp] Send failed:', message);
			return { sent: false, error: message };
		}
	}
}

// Singleton instance
let _instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
	if (!_instance) {
		_instance = new WhatsAppService();
	}
	return _instance;
}

import type { WhatsAppSendResult } from './types';

/**
 * The bridge's `/send` wire format, in one place.
 *
 * Both `send.ts` (what everything else calls) and `WhatsAppService` (the session
 * owner, which is also a bridge client whenever it is not the owner) need to
 * POST this. Two copies of a wire format is the shape this estate keeps getting
 * bitten by, so there is one.
 *
 * Pure: no imports but a type, so it costs nothing to reach from either side.
 */
export function toJid(to: string): string {
	return to.includes('@') ? to : `${to.replace(/[^\d]/g, '')}@s.whatsapp.net`;
}

export async function postToBridge(
	bridgeUrl: string,
	to: string,
	text: string,
): Promise<WhatsAppSendResult> {
	try {
		const res = await fetch(`${bridgeUrl}/send`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chatId: toJid(to), message: text }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return { sent: false, error: `WhatsApp bridge /send returned ${res.status}: ${body.slice(0, 200)}` };
		}
		const json = (await res.json().catch(() => ({}))) as { messageId?: string; id?: string };
		return { sent: true, messageId: json.messageId ?? json.id };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : 'Unknown error';
		return { sent: false, error: `WhatsApp bridge unreachable: ${msg}` };
	}
}

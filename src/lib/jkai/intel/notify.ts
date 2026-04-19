import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

const WHATSAPP_NUMBER = '+447359228511';
const SITE_URL = 'https://strangeramblings.com';

/**
 * Send high-significance alerts to WhatsApp.
 * Called after recall generates alerts.
 */
export async function pushHighAlerts(noteId: string): Promise<number> {
	const alerts = await db
		.select()
		.from(intelAlerts)
		.where(
			and(
				eq(intelAlerts.noteId, noteId),
				eq(intelAlerts.significance, 'high'),
				eq(intelAlerts.delivered, false),
			),
		);

	if (alerts.length === 0) return 0;

	const wa = getWhatsAppService();
	const state = wa.getState();
	if (state.status !== 'connected') {
		console.warn('[intel] WhatsApp not connected, skipping alert push');
		return 0;
	}

	let delivered = 0;

	for (const alert of alerts) {
		const typeEmoji: Record<string, string> = {
			risk_change: '🔴',
			contradiction: '⚠️',
			connection: '🔗',
			pattern: '🔄',
		};

		const emoji = typeEmoji[alert.type] ?? '🔔';
		const message = `${emoji} Intel Alert: ${alert.title}\n\n${alert.content}\n\nView: ${SITE_URL}/jkai/intel/alerts`;

		try {
			const result = await wa.sendMessage(WHATSAPP_NUMBER, message);
			if (result.sent) {
				await db
					.update(intelAlerts)
					.set({ delivered: true })
					.where(eq(intelAlerts.id, alert.id));
				delivered++;
			} else {
				console.error(`[intel] WhatsApp send failed for alert ${alert.id}: ${result.error}`);
			}
		} catch (err) {
			console.error(`[intel] WhatsApp send error for alert ${alert.id}:`, err);
		}
	}

	return delivered;
}

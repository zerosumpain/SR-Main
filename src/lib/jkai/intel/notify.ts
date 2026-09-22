import { ownerPhone } from '$lib/config/owner';
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { sendWhatsAppMessage } from '$lib/workflows/whatsapp/send';

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

	// Nothing to send to means nothing to send. Bail before marking anything
	// delivered — `ownerPhone()` has already logged why.
	const to = ownerPhone();
	if (!to) return 0;

	// Through the send seam, not the session owner. This was the LAST static
	// import of `whatsapp/service` from a module chat reaches, and it is why
	// Baileys was on chat's graph at all — an alert sender needed one POST.
	//
	// No `state.status` gate — see `send.ts`. In delegated mode that value is a
	// boot-time probe that is never refreshed, so it latched this channel off
	// after any restart during an outage. Attempt the send; the result is truth.

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
			const result = await sendWhatsAppMessage(to, message);
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

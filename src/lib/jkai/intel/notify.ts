import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { notifyOwner } from '$lib/server/notify';
import { OWNER_INTEL_SCOPE, spaceIn } from './scope';

/**
 * Send high-significance alerts wherever intel is routed.
 *
 * This used to call WhatsApp directly, which meant the channel was a property
 * of the code rather than a preference: the only way to stop intel alerts
 * arriving on WhatsApp was to stop generating them. It now goes through
 * `notifyOwner`, so the `intel` category decides — WhatsApp, the phone, both or
 * neither — and the alert is written to the notification ledger either way.
 *
 * `delivered` still means what it meant: this row has been handed to the
 * notifier and must not be handed to it again. It no longer implies WhatsApp
 * specifically.
 *
 * `notifyOwner` reaches the owner's phone, so only alerts inside the owner's
 * scope are offered to it — fixed, not a parameter: a member's note must never
 * page the owner. The same predicate on the `delivered` update keeps the write
 * inside what was read. A member's own alert channel is PR B's.
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
				spaceIn(intelAlerts.spaceId, OWNER_INTEL_SCOPE),
			),
		);

	if (alerts.length === 0) return 0;

	let delivered = 0;

	for (const alert of alerts) {
		const typeEmoji: Record<string, string> = {
			risk_change: '🔴',
			contradiction: '⚠️',
			connection: '🔗',
			pattern: '🔄',
		};

		const emoji = typeEmoji[alert.type] ?? '🔔';

		const result = await notifyOwner({
			category: 'intel',
			title: `${emoji} Intel: ${alert.title}`,
			body: alert.content,
			url: '/jkai/intel/alerts',
			severity: 'warn',
			dedupeKey: `intel:${alert.id}`,
			data: { alertId: alert.id, type: alert.type },
		});

		// Marked delivered whenever the notifier ACCEPTED it, including when
		// every channel for this category is switched off. Leaving it unmarked
		// there would re-offer the same alert on every recall for ever, and the
		// notifier has already recorded the decision.
		if (result.raised || result.reason === 'throttled' || result.reason === 'duplicate') {
			await db
				.update(intelAlerts)
				.set({ delivered: true })
				.where(and(eq(intelAlerts.id, alert.id), spaceIn(intelAlerts.spaceId, OWNER_INTEL_SCOPE)));
			delivered++;
		}
	}

	return delivered;
}

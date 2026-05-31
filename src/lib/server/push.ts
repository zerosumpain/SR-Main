import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { pushSubscriptions } from '$lib/db/schema';

export interface PushPayload {
	title: string;
	body: string;
	url?: string;
	data?: Record<string, unknown>;
}

let configured = false;
function configure(): void {
	if (configured) return;
	const pub = process.env.VAPID_PUBLIC_KEY;
	const priv = process.env.VAPID_PRIVATE_KEY;
	const subject = process.env.VAPID_SUBJECT;
	if (!pub || !priv || !subject) {
		throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set');
	}
	webpush.setVapidDetails(subject, pub, priv);
	configured = true;
}

export async function notifyUser(userId: string, payload: PushPayload): Promise<void> {
	configure();
	const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
	const body = JSON.stringify(payload);

	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					body,
				);
			} catch (err) {
				const status = (err as { statusCode?: number }).statusCode;
				if (status === 404 || status === 410) {
					await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
				}
			}
		}),
	);
}

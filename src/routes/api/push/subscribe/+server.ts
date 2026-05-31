import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { pushSubscriptions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();
	const userId = session?.user?.email;
	if (!userId) throw error(401, 'unauthorised');

	const body = (await request.json()) as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	};
	if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
		throw error(400, 'missing subscription fields');
	}

	const userAgent = request.headers.get('user-agent') ?? null;
	const existing = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.endpoint, body.endpoint));

	if (existing.length) {
		await db
			.update(pushSubscriptions)
			.set({
				userId,
				p256dh: body.keys.p256dh,
				auth: body.keys.auth,
				userAgent,
				lastSeenAt: new Date(),
			})
			.where(eq(pushSubscriptions.endpoint, body.endpoint));
	} else {
		await db.insert(pushSubscriptions).values({
			userId,
			endpoint: body.endpoint,
			p256dh: body.keys.p256dh,
			auth: body.keys.auth,
			userAgent,
		});
	}
	return json({ ok: true });
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { pushSubscriptions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();
	const userId = session?.user?.email;
	if (!userId) throw error(401, 'unauthorised');

	const { endpoint } = (await request.json()) as { endpoint?: string };
	if (!endpoint) throw error(400, 'missing endpoint');

	await db
		.delete(pushSubscriptions)
		.where(
			and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)),
		);
	return json({ ok: true });
};

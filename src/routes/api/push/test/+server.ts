import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notifyUser } from '$lib/server/push';

export const POST: RequestHandler = async ({ url, locals }) => {
	const session = await locals.auth();
	const userId = session?.user?.email;
	if (!userId) throw error(401, 'unauthorised');
	const isProd = process.env.NODE_ENV === 'production';
	if (isProd && url.searchParams.get('devkey') !== process.env.PUSH_TEST_KEY) {
		throw error(403, 'forbidden');
	}
	await notifyUser(userId, {
		title: 'Test from jkai',
		body: 'Push pipeline OK.',
		url: '/jkai',
	});
	return json({ ok: true });
};

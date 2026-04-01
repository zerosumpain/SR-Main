import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { cdoPlans } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const [plan] = await db.select().from(cdoPlans).where(eq(cdoPlans.id, params.id));
	if (!plan) {
		return json({ error: 'Plan not found' }, { status: 404 });
	}
	return json(plan);
};

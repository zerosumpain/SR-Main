import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { channels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
  const [row] = await db.select().from(channels).where(eq(channels.id, params.id)).limit(1);
  if (!row || row.kind !== 'whatsapp') throw error(404, 'WhatsApp channel not found');
  return { channel: row };
};

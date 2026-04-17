import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { channels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const [row] = await db.select().from(channels).where(eq(channels.id, params.id)).limit(1);
  if (!row) throw error(404, 'Channel not found');

  if (row.kind === 'whatsapp') {
    const to = typeof body.to === 'string' ? body.to : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (!to || !message) {
      throw error(400, 'Both `to` and `message` are required for WhatsApp test send');
    }
    const result = await getWhatsAppService().sendMessage(to, message);
    return json(result);
  }

  if (row.kind === 'email') {
    return json({ sent: false, error: 'Email channel not yet implemented' });
  }

  throw error(400, `Unknown channel kind: ${row.kind}`);
};

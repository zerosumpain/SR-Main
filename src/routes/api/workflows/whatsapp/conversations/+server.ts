import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const threads = await db.execute(sql`
    SELECT DISTINCT ON (phone_number)
      phone_number,
      content as last_message,
      role as last_role,
      created_at as last_message_at
    FROM whatsapp_conversations
    ORDER BY phone_number, created_at DESC
  `);

  return json({ conversations: threads.rows });
};

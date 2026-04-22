import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { gmailService } from '$lib/workflows/gmail/service';

export const POST: RequestHandler = async ({ params, request }) => {
  const accountId = Number(params.id);
  const { query } = await request.json();
  const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
  if (!acct) return json({ error: 'not found' }, { status: 404 });
  const ids = await gmailService.listMessages(acct, query ?? 'newer_than:1d', 10);
  const sample = ids[0] ? await gmailService.fetchMessage(acct, ids[0]) : null;
  return json({ count: ids.length, sample });
};

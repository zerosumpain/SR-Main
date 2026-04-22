import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { scraperCredentials } from '$lib/db/schema';
import { saveCredential, deleteCredential } from '$lib/workflows/scraper/credentials';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: scraperCredentials.id,
    domain: scraperCredentials.domain,
    label: scraperCredentials.label,
    loginStrategy: scraperCredentials.loginStrategy,
    loginUrl: scraperCredentials.loginUrl,
    createdAt: scraperCredentials.createdAt,
  }).from(scraperCredentials);
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const row = await saveCredential(body);
  return json({ id: row.id, domain: row.domain, label: row.label });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await deleteCredential(id);
  return json({ ok: true });
};

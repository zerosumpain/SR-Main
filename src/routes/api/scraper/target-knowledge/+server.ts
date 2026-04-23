import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { scraperTargetKnowledge } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { upsertKnowledge, deleteKnowledge } from '$lib/workflows/scraper/target-knowledge';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(scraperTargetKnowledge).orderBy(desc(scraperTargetKnowledge.updatedAt));
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.domain || typeof body.domain !== 'string') {
    return json({ error: 'domain is required' }, { status: 400 });
  }

  try {
    const row = await upsertKnowledge({
      domain: body.domain,
      requiresInteractive: Boolean(body.requiresInteractive ?? false),
      interactiveHint: typeof body.interactiveHint === 'string' ? body.interactiveHint : undefined,
      knownSelectors: body.knownSelectors && typeof body.knownSelectors === 'object'
        ? body.knownSelectors as Record<string, unknown>
        : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      source: (['manual', 'auto-captcha-detected', 'auto-failure'] as const).includes(body.source as any)
        ? body.source as 'manual' | 'auto-captcha-detected' | 'auto-failure'
        : 'manual',
    });
    return json(row);
  } catch (err: any) {
    return json({ error: err?.message ?? 'Upsert failed' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'Valid id query param required' }, { status: 400 });
  }
  await deleteKnowledge(id);
  return json({ success: true });
};

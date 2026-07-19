import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importCanvas, type CanvasExport } from '$lib/canvas/adapter.server';

/** Create a new canvas from an export file (see /api/canvas/[slug]/export). */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as CanvasExport | null;
  if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });
  try {
    const created = await importCanvas(body);
    return json(created, { status: 201 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'import failed' }, { status: 400 });
  }
};

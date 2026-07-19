import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exportCanvas } from '$lib/canvas/adapter.server';

/** Download a canvas as portable JSON (nodes + edges + config). */
export const GET: RequestHandler = async ({ params }) => {
  const data = await exportCanvas(params.slug);
  if (!data) return json({ error: 'Canvas not found' }, { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="canvas-${params.slug}.json"`,
    },
  });
};

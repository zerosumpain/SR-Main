import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { updateCredential, deleteCredential } from '$lib/integrations/credentials';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) throw error(400, 'Missing credential id');

  let body: { label?: string; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (
    body.label !== undefined &&
    (typeof body.label !== 'string' || body.label.trim() === '')
  ) {
    throw error(400, 'label must be a non-empty string');
  }

  await updateCredential(id, {
    label: body.label,
    metadata: body.metadata,
  });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) throw error(400, 'Missing credential id');
  await deleteCredential(id);
  return json({ ok: true });
};

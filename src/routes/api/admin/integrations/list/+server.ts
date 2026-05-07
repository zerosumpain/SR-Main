import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listCredentials } from '$lib/integrations/credentials';

export const GET: RequestHandler = async ({ url }) => {
  const integrationType = url.searchParams.get('integrationType') ?? undefined;
  const credentials = await listCredentials(integrationType);
  return json({
    credentials: credentials.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  });
};

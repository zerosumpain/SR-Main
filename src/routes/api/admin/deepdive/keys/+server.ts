import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSession } from '$lib/auth';
import { loadKeys, saveKeys, getKeysStatus } from '$lib/deepdive/keys';

function authorize(request: Request, url: URL): boolean {
  const token = url.searchParams.get('token');
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .find((c) => c.trim().startsWith('admin_session='))
    ?.split('=')[1];
  return validateSession(cookie) || validateSession(token ?? undefined);
}

export const GET: RequestHandler = async ({ request, url }) => {
  if (!authorize(request, url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  return json(getKeysStatus());
};

export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorize(request, url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const current = loadKeys();

  if (body.zaiApiKey !== undefined) current.zaiApiKey = body.zaiApiKey;
  if (body.zaiBaseUrl !== undefined) current.zaiBaseUrl = body.zaiBaseUrl;
  if (body.zaiModel !== undefined) current.zaiModel = body.zaiModel;
  if (body.tavilyApiKey !== undefined) current.tavilyApiKey = body.tavilyApiKey;

  saveKeys(current);

  return json(getKeysStatus());
};

import { json, error } from '@sveltejs/kit';
import { verifyBridgeToken, invokeTool } from '$lib/jkai/tool-bridge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const buildId = verifyBridgeToken(token);
  if (!buildId) throw error(401, 'invalid token');
  const body = await request.json().catch(() => null) as { name?: unknown; args?: unknown } | null;
  if (!body || typeof body.name !== 'string') throw error(400, 'name required');
  try {
    const result = await invokeTool(body.name, body.args);
    return json({ ok: true, result });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
};

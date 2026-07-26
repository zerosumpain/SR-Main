import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  callIntegration,
  deleteIntegration,
  listIntegrationsForPicker,
  saveIntegration,
  IntegrationError,
  type IntegrationOutput,
  type IntegrationParam,
} from '$lib/apis/integrations';

// Owner-only by hooks.server.ts. Powers the register at /admin/ai/apis: list,
// save (owner-authored integrations), run-a-test, delete.

function errResponse(err: unknown) {
  if (err instanceof IntegrationError) return json({ error: err.message }, { status: 400 });
  return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
}

/** GET — the register, with resolved host/auth info for display. */
export const GET: RequestHandler = async () => {
  try {
    return json({ integrations: await listIntegrationsForPicker() });
  } catch (err) {
    return errResponse(err);
  }
};

/**
 * POST — two actions:
 *   { action: 'save',  ...SaveIntegrationInput }
 *   { action: 'test',  key, params?, confirmWrite? }
 * `test` runs the real call (that is the point) and records the evidence.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? 'save');

  try {
    if (action === 'test') {
      const key = String(body.key ?? '');
      if (!key) return json({ error: 'key is required' }, { status: 400 });
      const result = await callIntegration({
        key,
        params: (body.params as Record<string, unknown> | undefined) ?? {},
        confirmWrite: body.confirmWrite === true,
      });
      // `result` is already redacted by the shared call core.
      return json({ result });
    }

    if (action === 'save') {
      const saved = await saveIntegration(
        {
          key: body.key as string | undefined,
          name: String(body.name ?? ''),
          description: body.description as string | undefined,
          api: String(body.api ?? ''),
          method: body.method as string | undefined,
          path: body.path as string | undefined,
          params: (body.params as IntegrationParam[] | undefined) ?? [],
          outputs: (body.outputs as IntegrationOutput[] | undefined) ?? [],
          docsUrl: body.docsUrl as string | undefined,
        },
        'owner',
      );
      return json({ integration: saved });
    }

    return json({ error: `unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return errResponse(err);
  }
};

/** DELETE ?key=… — remove an integration from the register. */
export const DELETE: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get('key') ?? '';
  if (!key) return json({ error: 'key is required' }, { status: 400 });
  try {
    const deleted = await deleteIntegration(key, 'owner');
    if (!deleted) return json({ error: `no integration "${key}"` }, { status: 404 });
    return json({ deleted: true });
  } catch (err) {
    return errResponse(err);
  }
};

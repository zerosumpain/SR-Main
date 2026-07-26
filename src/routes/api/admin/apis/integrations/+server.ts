import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import {
  callIntegration,
  deleteIntegration,
  listIntegrationsForPicker,
  saveIntegration,
  IntegrationError,
  type IntegrationOutput,
  type IntegrationParam,
} from '$lib/apis/integrations';

// Powers the register at /admin/ai/apis: list, save, run-a-test, delete.
//
// Mutations re-check the owner session HERE rather than trusting
// hooks.server.ts — same reasoning as the sibling secrets route: AUTH_BYPASS=1
// short-circuits auth for any loopback client before the session check, and
// `action:'test'` fires a REAL credentialed request. GET stays bypass-friendly.
async function requireOwner(locals: App.Locals): Promise<Response | null> {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email || !isOwnerEmail(email)) {
    return json(
      { error: 'Editing or testing an integration requires a signed-in owner session (the LAN auth bypass does not grant it).' },
      { status: 403 },
    );
  }
  return null;
}

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
export const POST: RequestHandler = async ({ request, locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;

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
export const DELETE: RequestHandler = async ({ url, locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;

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

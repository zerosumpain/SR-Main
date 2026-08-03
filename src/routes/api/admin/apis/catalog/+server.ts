import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import { listCatalogApis, setCatalogAuth, type CatalogAuthChange } from '$lib/workflows/site-tools/tools/apis';

// Which credential a catalogued API uses was, until now, writable only by the
// LLM's `api_register` tool — so "pick the credential for this service" was a
// chat request, not an owner action. This route is the owner's half: one narrow
// write of `entry.auth`, nothing else.
//
// It never touches `api_secrets`. Creating, rotating and rebinding a credential
// stay on the sibling secrets route, so the two-row OAuth invariant and the
// delete-order guard keep their single writer.
//
// MUTATIONS RE-CHECK THE OWNER SESSION HERE, deliberately not relying on
// hooks.server.ts — same reasoning as the secrets and integrations routes: on
// homeserv `AUTH_BYPASS=1` short-circuits auth for any loopback client before
// the session check, and anything that can make a loopback request in the
// site's own environment could otherwise point a catalogued host at a
// credential the owner never chose. GET stays bypass-friendly: it returns
// catalogue metadata only, and a handle is a name, never a value.
async function requireOwner(locals: App.Locals): Promise<Response | null> {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email || !isOwnerEmail(email)) {
    return json(
      {
        error:
          'Changing which credential an API uses requires a signed-in owner session (the homeserv LAN auth bypass does not grant it).',
      },
      { status: 403 },
    );
  }
  return null;
}

/** GET — the catalogue as the register renders it (auth kind + handle, no values). */
export const GET: RequestHandler = async () => {
  try {
    return json({ apis: await listCatalogApis() });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
  }
};

/**
 * POST { key, handle } — bind the catalogued API `key` to registry credential
 * `handle`. An empty/absent handle unbinds it ({kind:'none'}).
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

  const key = String(body.key ?? '').trim();
  if (!key) return json({ error: 'key is required' }, { status: 400 });

  const handle = String(body.handle ?? '').trim();
  const auth: CatalogAuthChange = handle ? { kind: 'secret', handle } : { kind: 'none' };

  try {
    return json(await setCatalogAuth(key, auth));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 400 });
  }
};

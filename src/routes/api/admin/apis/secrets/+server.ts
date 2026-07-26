import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  deleteSecret,
  listRefSources,
  listSecrets,
  upsertSecret,
  SecretError,
  type SecretInjection,
  type SecretSource,
} from '$lib/secrets/registry';

// Owner-only by hooks.server.ts (every /api/admin/* path is gated there).
//
// There is deliberately NO endpoint that returns a secret value — not even for
// the owner, not even write-then-read. `listSecrets` returns SecretMeta, which
// has no value field, so "the admin UI leaked the key" is not a mistake this
// surface can make. Values are entered write-only and only ever leave the
// process attached to an outbound request to an owner-allowed host.

function errResponse(err: unknown) {
  if (err instanceof SecretError) return json({ error: err.message }, { status: 400 });
  return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
}

/** GET — registered secrets (metadata only) + the ref sources available. */
export const GET: RequestHandler = async () => {
  try {
    return json({ secrets: await listSecrets(), refSources: listRefSources() });
  } catch (err) {
    return errResponse(err);
  }
};

/**
 * POST { handle, label?, source, value?, refKey?, injection, allowedHosts, allowedPathPrefixes?, notes? }
 * Create or update. On update, omitting `value` keeps the stored one.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const meta = await upsertSecret({
      handle: String(body.handle ?? ''),
      label: typeof body.label === 'string' ? body.label : undefined,
      source: String(body.source ?? 'vault') as SecretSource,
      value: typeof body.value === 'string' ? body.value : undefined,
      refKey: typeof body.refKey === 'string' ? body.refKey : undefined,
      injection: body.injection as SecretInjection,
      allowedHosts: Array.isArray(body.allowedHosts) ? (body.allowedHosts as string[]) : [],
      allowedPathPrefixes: Array.isArray(body.allowedPathPrefixes)
        ? (body.allowedPathPrefixes as string[])
        : [],
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    return json({ secret: meta });
  } catch (err) {
    return errResponse(err);
  }
};

/** DELETE ?handle=… — remove a secret. Catalogue entries referencing it then fail closed. */
export const DELETE: RequestHandler = async ({ url }) => {
  const handle = url.searchParams.get('handle') ?? '';
  if (!handle) return json({ error: 'handle is required' }, { status: 400 });
  try {
    const deleted = await deleteSecret(handle);
    if (!deleted) return json({ error: `no secret "${handle}"` }, { status: 404 });
    return json({ deleted: true });
  } catch (err) {
    return errResponse(err);
  }
};

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getCredential, updateCredential, deleteCredential } from '$lib/integrations/credentials';
import { getIntegrationAdapter } from '$lib/integrations/registry';
import { buildManualPayload, getManualCredentialSpec } from '$lib/integrations/manual-credentials';
import type { CredentialPayload } from '$lib/integrations/types';

/**
 * Rename a credential, or replace its secret in place.
 *
 * Replacing used to be impossible: a revoked iCloud app-specific password could
 * only be fixed by connecting a second credential and deleting the first, which
 * changed the id every workflow and remembered call had stored (2026-10-31).
 * `payload` now re-encrypts the secret on the same row, clears the stale
 * failure, and re-tests at once so the connections page is right immediately.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) throw error(400, 'Missing credential id');

  let body: { label?: string; metadata?: Record<string, unknown>; payload?: Record<string, unknown> };
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

  if (body.payload === undefined) {
    await updateCredential(id, {
      label: body.label,
      metadata: body.metadata,
    });
    return json({ ok: true });
  }

  const current = await getCredential(id);
  if (!current) throw error(404, 'Credential not found');
  const spec = getManualCredentialSpec(current.integrationType);
  if (!spec || spec.kind !== current.kind) {
    throw error(400, `"${current.integrationType}" credentials cannot be replaced here — reconnect it instead`);
  }
  const built = buildManualPayload(spec, body.payload ?? {}, current.payload as unknown as Record<string, unknown>);
  if ('error' in built) throw error(400, built.error);

  await updateCredential(id, {
    label: body.label,
    metadata: body.metadata,
    payload: built.payload as unknown as CredentialPayload,
    lastTestedAt: undefined,
    lastTestStatus: null,
    lastTestError: null,
  });

  const adapter = getIntegrationAdapter(current.integrationType);
  if (!adapter?.testCredential) return json({ ok: true, test: null });
  try {
    await adapter.testCredential(id);
    const at = new Date();
    await updateCredential(id, { lastTestedAt: at, lastTestStatus: 'ok', lastTestError: null });
    return json({ ok: true, test: { status: 'ok', at: at.toISOString() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const at = new Date();
    await updateCredential(id, { lastTestedAt: at, lastTestStatus: 'failed', lastTestError: msg });
    return json({ ok: true, test: { status: 'failed', error: msg, at: at.toISOString() } });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) throw error(400, 'Missing credential id');
  await deleteCredential(id);
  return json({ ok: true });
};

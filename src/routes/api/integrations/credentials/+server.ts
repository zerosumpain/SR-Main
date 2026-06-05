import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIntegrationAdapter } from '$lib/integrations/registry';
import { getManualCredentialSpec } from '$lib/integrations/manual-credentials';
import { createCredential } from '$lib/integrations/credentials';

/**
 * Create a manually-entered (apikey / basic) credential for an integration that
 * has no OAuth flow — e.g. Apple Calendar (iCloud Apple ID + app-specific
 * password). Previously there was NO way to create such a credential through any
 * UI, so the one registered generic adapter was a dead end. Auth-gated by hooks
 * (all /api/* require a session). The payload is encrypted by createCredential().
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: { integrationType?: string; label?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const integrationType = body.integrationType;
  if (!integrationType || typeof integrationType !== 'string') {
    throw error(400, 'integrationType is required');
  }
  if (!getIntegrationAdapter(integrationType)) {
    throw error(404, `No integration adapter registered for "${integrationType}"`);
  }
  const spec = getManualCredentialSpec(integrationType);
  if (!spec) {
    throw error(400, `"${integrationType}" does not support manually-entered credentials`);
  }

  const label = (typeof body.label === 'string' ? body.label : '').trim();
  if (!label) throw error(400, 'A label is required');

  const input = (body.payload ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = typeof input[f.key] === 'string' ? (input[f.key] as string).trim() : '';
    if (!v) throw error(400, `${f.label} is required`);
    values[f.key] = v;
  }

  // Build the kind-specific payload from the validated fields (see the contract
  // in manual-credentials.ts: basic → username/password, apikey → key).
  let id: string;
  if (spec.kind === 'basic') {
    id = await createCredential({
      integrationType,
      label,
      kind: 'basic',
      payload: { username: values.username, password: values.password },
    });
  } else {
    id = await createCredential({
      integrationType,
      label,
      kind: 'apikey',
      payload: { key: values.key },
    });
  }

  return json({ id });
};

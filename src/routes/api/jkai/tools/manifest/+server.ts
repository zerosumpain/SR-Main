import { discoverIntegrations } from '$lib/apis/integration-discovery';
import { getActivePolicy } from '$lib/toolpolicy/policy';
import { applyCapabilityPolicy } from '$lib/jkai/grounding/capabilities';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  verifyBridgeToken,
  manifestForBuild,
  definitionsForBuild,
} from '$lib/jkai/tool-bridge';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const buildId = verifyBridgeToken(token);
  if (!buildId) throw error(401, 'invalid token');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'build not found');
  const enabled = (build.enabledToolsets ?? ['all']) as string[];
  const manifest = manifestForBuild(enabled);
  const policy = await getActivePolicy();
  const definitions = applyCapabilityPolicy(definitionsForBuild(enabled), policy);
  const integrations = definitions.some(d => d.function.name === 'api_integration_call')
    ? await discoverIntegrations(url?.searchParams.get('query') ?? '', 20).then(rows => ({ status: 'ok', operations: rows.filter(i => !i.writes) })).catch(() => ({ status: 'unavailable', operations: [] }))
    : { status: 'not_enabled', operations: [] };
  return json({
    buildId,
    policyVersion: policy.version,
    integrations,
    manifest,
    tools: definitions.map((d) => ({
      name: d.function.name,
      description: d.function.description,
      parameters: d.function.parameters,
    })),
  });
};

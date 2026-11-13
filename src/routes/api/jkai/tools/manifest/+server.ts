import { discoverIntegrations } from '$lib/apis/integration-discovery';
import { getActivePolicy } from '$lib/toolpolicy/policy';
import { applyCapabilityPolicy } from '$lib/jkai/grounding/capabilities';
import { json, error } from '@sveltejs/kit';
import { runningBridgeBuild } from '$lib/jkai/bridge-auth.server';
import { manifestForBuild, definitionsForBuild } from '$lib/jkai/tool-bridge';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
  const build = await runningBridgeBuild(request.headers.get('authorization'));
  if (!build) throw error(401, 'invalid token');
  const buildId = build.id;
  const enabled = (build.enabledToolsets ?? ['all']) as string[];
  const manifest = await manifestForBuild(enabled);
  const policy = await getActivePolicy();
  const definitions = applyCapabilityPolicy(await definitionsForBuild(enabled), policy);
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

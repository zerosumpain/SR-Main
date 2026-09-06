import { listIntegrations } from './integrations';
import { parameterSchema } from './integration-contract';
import { rankCapabilities } from '$lib/utils/capability-ranking';
/** Untrusted operation metadata, returned as evidence rather than instructions. */
export async function discoverIntegrations(query: string, limit = 3) {
  const rows = await listIntegrations();
  const ranked = rankCapabilities(rows.map(row => ({ name: `${row.key} ${row.name} ${row.api}`, description: row.description, row })), query, limit);
  return ranked.map(({ row }) => ({ key: row.key, name: row.name, description: row.description, api: row.api,
    status: row.status, method: row.method, path: row.path, docsUrl: row.docsUrl,
    writes: !['GET', 'HEAD'].includes(row.method), params: row.params, inputSchema: parameterSchema(row.params), outputs: row.outputs,
    call: { tool: 'api_integration_call', args: { key: row.key, params: {} } },
  }));
}

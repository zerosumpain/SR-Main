import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export { apiCallDef } from './api-call.def';

/** Interpolate {{input.*}} then JSON.parse — returns undefined for blank input. */
function parseJsonConfig(raw: unknown, input: Record<string, unknown>, label: string): Record<string, unknown> | undefined {
  const text = interpolateTemplate(String(raw ?? ''), input).trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new Error('must be a JSON object');
  } catch (err) {
    throw new Error(`api-call: ${label} is not a valid JSON object — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * `api-call` — friendly, catalogue-bound API access. Resolves the selected API
 * by key/name, composes the URL from its baseUrl + path/query, and delegates to
 * the shared SSRF-guarded core (`callCatalogApi`), which injects env-ref auth and
 * keeps every request within the API's baseUrl. dryRun never calls out.
 */
export const apiCallExecutor: NodeExecutor = {
  type: 'api-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const api = interpolateTemplate(String(config.api ?? ''), input).trim();
    if (!api) {
      throw new Error('api-call: no API selected. Pick a registered API from the catalogue (e.g. "open-meteo").');
    }
    const method = String(config.method ?? 'GET').toUpperCase();
    const path = interpolateTemplate(String(config.path ?? ''), input).trim();
    const query = parseJsonConfig(config.query, input, 'query params');
    const headers = parseJsonConfig(config.headers, input, 'headers') as Record<string, string> | undefined;

    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const b = interpolateTemplate(String(config.body ?? ''), input).trim();
      body = b || undefined;
    }

    // DRY RUN: never call the API. Describe what WOULD run so wiring can be
    // verified without side effects.
    if (context.dryRun) {
      return {
        output: { success: true, dryRun: true, api, method, path, ...(query ? { query } : {}) },
        rowCount: 1,
        metadata: { dryRun: true },
      };
    }

    // Lazy dynamic import — the site-tools registry pulls server-only domain
    // modules and MUST NOT be imported at module-init time (circular-init hazard).
    const { callCatalogApi } = await import('$lib/workflows/site-tools/tools/apis');

    const result = await callCatalogApi({ api, path, method, body, headers, query });

    if (!result.success) {
      // Route through the node error path so the node's On-failure config governs.
      throw new Error(result.error || `api-call: request to "${api}" failed`);
    }

    const data = (result.data ?? {}) as {
      api?: string;
      url?: string;
      status?: number;
      json?: unknown;
      text?: string;
      truncated?: boolean;
    };

    return {
      output: {
        success: true,
        api: data.api ?? api,
        status: data.status,
        url: data.url,
        json: data.json,
        ...(data.text !== undefined ? { text: data.text } : {}),
        ...(data.truncated ? { truncated: true } : {}),
      },
      rowCount: Array.isArray(data.json) ? data.json.length : 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in api / path / query / body / headers' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        api: { type: 'string', description: 'Name of the catalogued API called' },
        status: { type: 'number', description: 'HTTP status code' },
        url: { type: 'string', description: 'The composed request URL' },
        json: { type: 'any', description: 'Parsed JSON response body (when the response is JSON)' },
        text: { type: 'string', description: 'Raw response text (when not JSON)' },
        dryRun: { type: 'boolean', description: 'true only on a dry run (no request made)' },
      },
    };
  },
};

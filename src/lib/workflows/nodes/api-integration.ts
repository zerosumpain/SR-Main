import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export { apiIntegrationDef } from './api-integration.def';

/**
 * `api-integration` — run a recorded integration from the register.
 *
 * All request work (URL composition, baseUrl containment, SSRF-pinned fetch,
 * secret resolution under the owner's host binding, response redaction) happens
 * inside `callIntegration` -> `callCatalogApi`, so this executor only has to
 * interpolate the configured params and shape the result. There is deliberately
 * no second request path here — a weaker duplicate is how credentials leak.
 */
export const apiIntegrationExecutor: NodeExecutor = {
  type: 'api-integration',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const key = interpolateTemplate(String(config.integration ?? ''), input).trim();
    if (!key) {
      throw new Error(
        'api-integration: no integration selected. Pick one from the register (/admin/ai/apis) — or create it in /jkai first.',
      );
    }

    // Params arrive as an object of (possibly templated) strings from the panel.
    // Tolerate a JSON string too, for a hand-edited/LLM-generated config.
    let rawParams: Record<string, unknown> = {};
    const cp = config.params;
    if (typeof cp === 'string' && cp.trim()) {
      try {
        const parsed = JSON.parse(interpolateTemplate(cp, input));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          rawParams = parsed as Record<string, unknown>;
        }
      } catch (err) {
        throw new Error(`api-integration: params is not a valid JSON object — ${(err as Error).message}`);
      }
    } else if (cp && typeof cp === 'object' && !Array.isArray(cp)) {
      rawParams = cp as Record<string, unknown>;
    }

    const params: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(rawParams)) {
      params[name] = typeof value === 'string' ? interpolateTemplate(value, input) : value;
    }

    const { callIntegration } = await import('$lib/apis/integrations');

    // DRY RUN: describe the call without making it.
    if (context.dryRun) {
      const planned = await callIntegration({ key, params, dryRun: true });
      return {
        output: { success: true, dryRun: true, integration: planned.integration, method: planned.method, params },
        rowCount: 1,
        metadata: { dryRun: true },
      };
    }

    const result = await callIntegration({
      key,
      params,
      confirmWrite: config.confirmWrite === true,
    });

    if (!result.success) {
      // Route through the node error path so the node's On-failure config governs.
      throw new Error(result.error || `api-integration: "${key}" failed`);
    }

    return {
      output: {
        success: true,
        integration: result.integration,
        api: result.api,
        status: result.status,
        url: result.url,
        values: result.values,
        json: result.json,
        ...(result.text !== undefined ? { text: result.text } : {}),
      },
      rowCount: Array.isArray(result.json) ? result.json.length : 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in the integration key and params' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        integration: { type: 'string', description: 'Key of the integration called' },
        api: { type: 'string', description: 'Catalogued API it belongs to' },
        status: { type: 'number', description: 'HTTP status code' },
        url: { type: 'string', description: 'The composed request URL (credentials redacted)' },
        values: {
          type: 'object',
          description: "The integration's named outputs, e.g. { remaining: 18.2 } — reference as input.values.remaining",
        },
        json: { type: 'any', description: 'Parsed JSON response body' },
        text: { type: 'string', description: 'Raw response text (when not JSON)' },
        dryRun: { type: 'boolean', description: 'true only on a dry run (no request made)' },
      },
    };
  },
};

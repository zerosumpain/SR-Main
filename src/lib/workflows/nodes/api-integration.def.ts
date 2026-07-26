import type { NodeDefinition } from '../types';

/**
 * `api-integration` — call a RECORDED integration from the register at
 * /admin/ai/apis by name, with no code.
 *
 * The difference between the three API nodes:
 *   http-request     — any URL, you wire the auth and read raw JSON.
 *   api-call         — a catalogued API; you still type the path and know the response shape.
 *   api-integration  — pick a named operation from a dropdown; params become
 *                      labelled inputs and the response arrives as NAMED VALUES
 *                      (`output.values.remaining`), so nothing downstream has to
 *                      know the API's JSON shape.
 *
 * That last part is what makes "WhatsApp me when my OpenRouter credit is under
 * $10" a three-node canvas: schedule -> api-integration -> conditional on
 * `input.values.remaining < 10` -> whatsapp.
 */
export const apiIntegrationDef: NodeDefinition = {
  type: 'api-integration',
  label: 'API integration',
  category: 'integration',
  description:
    'Call a registered API integration by name. Pick one from the register — parameters become labelled fields and the response arrives as named values, so no JSON-path wiring is needed.',
  configSchema: {
    type: 'object',
    properties: {
      integration: {
        type: 'string',
        description:
          'Key of the integration to call (from the register / api_integration_list), e.g. "openrouter-credit-balance".',
      },
      params: {
        type: 'object',
        description:
          'Values for the integration\'s parameters, as { paramName: value }. Each value supports {{input.field}} templates.',
      },
      confirmWrite: {
        type: 'boolean',
        description:
          'Must be true for an integration whose method is POST/PUT/PATCH/DELETE — those change remote state.',
      },
    },
    required: ['integration'],
  },
  defaultConfig: { integration: '', params: {}, confirmWrite: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Integration result' }],
  // A specialized panel (ApiIntegrationPanel) renders the register dropdown and
  // generates one field per parameter. basicConfig stays as the fallback for a
  // context where the panel is unavailable.
  basicConfig: [
    {
      key: 'integration',
      label: 'Integration',
      type: 'text',
      description: 'Key of the registered integration to call.',
      placeholder: 'openrouter-credit-balance',
    },
    {
      key: 'confirmWrite',
      label: 'Allow write operation',
      type: 'toggle',
      description: 'Required for POST/PUT/PATCH/DELETE integrations — they change data on the remote API.',
    },
  ],
  summarize: (config) => {
    const key = String(config.integration ?? '').trim() || '(none selected)';
    const params = (config.params ?? {}) as Record<string, unknown>;
    const names = Object.keys(params).filter((k) => String(params[k] ?? '') !== '');
    return {
      line: `Call the "${key}" API integration`,
      preview: {
        kind: 'http',
        details: {
          Integration: key,
          Params: names.length ? names.join(', ') : '—',
          Write: config.confirmWrite ? 'allowed' : 'no',
        },
      },
    };
  },
  llmDescription:
    'Call a RECORDED API integration from the register (the named operations behind api_integration_list / /admin/ai/apis). Prefer this over `api-call` and `http-request` whenever an integration already exists for the data you need: the path, the auth and the response shape are already solved, and the node emits NAMED outputs. ' +
    'Config: `integration` (the integration key, e.g. "openrouter-credit-balance"); `params` (an object of that integration\'s parameter values — each supports {{input.field}} templates); `confirmWrite` (must be true for POST/PUT/PATCH/DELETE integrations). ' +
    'Output: { success, integration, status, url, json, values } where `values` holds the integration\'s named outputs — reference them downstream as {{input.values.<name>}} or, in a conditional, `input.values.<name>`. ' +
    'Auth is resolved server-side from the owner\'s secret registry and only for hosts the owner bound that credential to; credential values never appear in the node output. Under a dry run the node NEVER calls the API. ' +
    'If no integration exists yet for the data you need, create one in chat first (api_register -> api_integration_save -> api_integration_test), then wire this node to it.',
  llmExamples: [
    { integration: 'openrouter-credit-balance', params: {} },
    { integration: 'companies-house-company', params: { companyNumber: '{{input.companyNumber}}' } },
  ],
};

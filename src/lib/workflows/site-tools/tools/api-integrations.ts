// src/lib/workflows/site-tools/tools/api-integrations.ts
//
// `apis` toolset, integration-authoring half. Where `api_search`/`api_call` let
// the model make an ad-hoc request, these let it RECORD the request that worked
// so it becomes reusable — by a later chat turn, by the register at
// /admin/ai/apis, and by the no-code `api-integration` canvas node.
//
// The intended loop when jkai meets a question it has no integration for:
//   1. api_secrets_list        — which credentials exist (names + bound hosts only)
//   2. web_fetch / research    — read the API's docs
//   3. api_register            — catalogue the API (+ attach a secret handle)
//   4. api_integration_save    — record the exact operation, with named outputs
//   5. api_integration_test    — prove it returns real data; stores the evidence
//   6. answer, and it stays available for next time
//
// Nothing here can read a credential: auth is a handle, resolved server-side by
// the secret registry only for owner-allowed hosts, and scrubbed from responses.

import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';
import { toToolError } from './_datastore-errors';
import {
  callIntegration,
  deleteIntegration,
  getIntegration,
  listIntegrations,
  listIntegrationsForPicker,
  saveIntegration,
  type IntegrationOutput,
  type IntegrationParam,
} from '$lib/apis/integrations';

const PARAM_SCHEMA = {
  type: 'array',
  description:
    'Inputs the call takes. `in` says where each goes: "path" substitutes a {name} placeholder in the path, "query" appends ?name=…, "header" sends a request header, "body" becomes a JSON body field.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      in: { type: 'string', enum: ['path', 'query', 'body', 'header'] },
      required: { type: 'boolean' },
      description: { type: 'string' },
      example: { type: 'string' },
      default: { type: 'string' },
    },
    required: ['name', 'in'],
  },
};

const OUTPUT_SCHEMA = {
  type: 'array',
  description:
    'Named values pulled out of the response so callers (and canvas nodes) never have to know its shape. Each `expr` is a SINGLE expression over `json` — the parsed response — e.g. {"name":"remaining","expr":"json.data.total_credits - json.data.total_usage","unit":"USD"}. Arithmetic is allowed; no statements, assignments or function calls.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Plain identifier, e.g. remaining' },
      expr: { type: 'string' },
      unit: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name', 'expr'],
  },
};

export async function handleIntegrationList(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const detail = args?.detail === true;
    const rows = await listIntegrationsForPicker();
    return {
      success: true,
      data: {
        count: rows.length,
        integrations: rows.map((i) => ({
          key: i.key,
          name: i.name,
          description: i.description,
          api: i.api,
          host: i.host,
          method: i.method,
          path: i.path,
          status: i.status,
          lastTestedAt: i.lastTestedAt,
          authKind: i.authKind,
          secretHandle: i.secretHandle,
          outputs: i.outputs.map((o) => o.name),
          ...(detail ? { params: i.params, outputExprs: i.outputs } : {}),
          ...(i.params.length && !detail ? { params: i.params.map((p) => `${p.name} (${p.in})`) } : {}),
        })),
      },
    };
  } catch (err) {
    return toToolError(err, 'integration error');
  }
}

export async function handleIntegrationSave(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const saved = await saveIntegration(
      {
        key: args.key as string | undefined,
        name: String(args.name ?? ''),
        description: args.description as string | undefined,
        api: String(args.api ?? ''),
        method: args.method as string | undefined,
        path: args.path as string | undefined,
        params: (args.params as IntegrationParam[] | undefined) ?? [],
        outputs: (args.outputs as IntegrationOutput[] | undefined) ?? [],
        docsUrl: args.docsUrl as string | undefined,
      },
      'jkai',
    );
    return {
      success: true,
      data: {
        key: saved.key,
        status: saved.status,
        next: `Saved as draft. Call api_integration_test {"key":"${saved.key}"} to prove it works — a passing test marks it verified and records the evidence shown at /admin/ai/apis.`,
      },
    };
  } catch (err) {
    return toToolError(err, 'integration error');
  }
}

async function runIntegration(args: Record<string, unknown>, includeSample: boolean): Promise<ToolResult> {
  try {
    const key = String(args.key ?? '').trim();
    if (!key) return { success: false, error: '"key" (integration key or name) is required' };

    const result = await callIntegration({
      key,
      params: (args.params as Record<string, unknown> | undefined) ?? {},
      confirmWrite: args.confirmWrite === true,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? 'the call failed',
        data: { integration: result.integration, status: result.status, url: result.url, json: result.json },
      };
    }

    // Response bodies can be large; the named outputs are the point. Include a
    // trimmed sample only when authoring/testing, so the model can refine
    // `outputs` against the real shape.
    const sample = includeSample ? JSON.stringify(result.json ?? result.text ?? null).slice(0, 4000) : undefined;

    return {
      success: true,
      data: {
        integration: result.integration,
        status: result.status,
        url: result.url,
        values: result.values,
        ...(sample !== undefined ? { sample } : { json: result.json }),
      },
    };
  } catch (err) {
    return toToolError(err, 'integration error');
  }
}

export async function handleIntegrationTest(args: Record<string, unknown>): Promise<ToolResult> {
  return runIntegration(args, true);
}

export async function handleIntegrationCall(args: Record<string, unknown>): Promise<ToolResult> {
  return runIntegration(args, false);
}

export async function handleIntegrationDelete(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const key = String(args.key ?? '').trim();
    if (!key) return { success: false, error: '"key" is required' };
    const existing = await getIntegration(key);
    if (!existing) return { success: false, error: `no integration named "${key}"` };
    const deleted = await deleteIntegration(existing.key, 'jkai');
    return { success: deleted, data: { key: existing.key, deleted } };
  } catch (err) {
    return toToolError(err, 'integration error');
  }
}

export const apiIntegrationTools: ToolDefinition[] = [
  {
    name: 'api_integration_list',
    description:
      'List the recorded API integrations — the register of named, reusable API calls (each is one method + path + params + named outputs on a catalogued API). Check here FIRST when asked for external data: if an integration already answers the question, just call it with api_integration_call. Pass detail:true for full param/output specs.',
    parameters: {
      type: 'object',
      properties: { detail: { type: 'boolean', description: 'Include full param and output-expression specs.' } },
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleIntegrationList(args),
  },
  {
    name: 'api_integration_save',
    description:
      'Record (or update) a reusable API operation against an already-catalogued API, so this call never has to be worked out again — it shows up in the register at /admin/ai/apis and in the no-code "API integration" canvas node. Give it named `outputs` so callers get e.g. {remaining: 18.2} instead of raw JSON. Register the API with api_register first (that is where the baseUrl and the auth handle live). Saving marks it draft; api_integration_test earns "verified".',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human name, e.g. "OpenRouter credit balance".' },
        key: { type: 'string', description: 'Optional stable slug. Defaults to a slug of the name.' },
        description: { type: 'string', description: 'What question this call answers.' },
        api: { type: 'string', description: 'Catalogue key or name of the API (from api_search / api_integration_list).' },
        method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string', description: 'Path relative to the API baseUrl. {name} placeholders are filled from `path` params, e.g. "/company/{companyNumber}".' },
        params: PARAM_SCHEMA,
        outputs: OUTPUT_SCHEMA,
        docsUrl: { type: 'string' },
      },
      required: ['name', 'api', 'method'],
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleIntegrationSave(args),
  },
  {
    name: 'api_integration_test',
    description:
      'Run a recorded integration once to prove it works, and store the result as evidence (a pass marks it "verified" and is shown in the register). Returns the named outputs plus a trimmed raw sample so you can refine the output expressions against the real response shape. Use this immediately after api_integration_save.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Integration key or name.' },
        params: { type: 'object', description: 'Values for the integration\'s params.' },
        confirmWrite: { type: 'boolean', description: 'Required for POST/PUT/PATCH/DELETE integrations — they change remote state.' },
      },
      required: ['key'],
    },
    category: 'APIs',
    toolset: 'apis',
    // Testing a write integration really does write to the remote API.
    destructive: true,
    handler: (args) => handleIntegrationTest(args),
  },
  {
    name: 'api_integration_call',
    description:
      'Call a recorded integration and get its named outputs — the cheapest way to answer a question an integration already covers (no path/auth/JSON-shape reasoning needed). Use api_integration_list to find the key.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Integration key or name.' },
        params: { type: 'object', description: 'Values for the integration\'s params.' },
        confirmWrite: { type: 'boolean', description: 'Required for POST/PUT/PATCH/DELETE integrations — they change remote state.' },
      },
      required: ['key'],
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleIntegrationCall(args),
  },
  {
    name: 'api_integration_delete',
    description: 'Remove a recorded integration from the register. The catalogued API and any credentials are untouched.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    category: 'APIs',
    toolset: 'apis',
    destructive: true,
    handler: (args) => handleIntegrationDelete(args),
  },
];

for (const tool of apiIntegrationTools) register(tool);

// Re-exported for tests + the admin routes.
export { listIntegrations };

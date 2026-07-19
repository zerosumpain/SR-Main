import type { NodeDefinition } from '../types';

// Ops that carry a request body / whose body field should be shown.
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * `api-call` — read / write / update / push / pull from any API in the
 * permanent `api_catalog` (the same catalogue the self-improvement engine grows
 * and the `api_call` site tool uses). You pick a catalogued API by name, choose
 * a plain-language operation, and type a path relative to its baseUrl — the node
 * composes the full URL, injects env-ref auth server-side, and SSRF-guards every
 * hop. Distinct from `http-request` (arbitrary URL, manual auth): this node is
 * bound to the vetted catalogue and never leaves an API's baseUrl.
 */
export const apiCallDef: NodeDefinition = {
  type: 'api-call',
  label: 'API call (catalogue)',
  category: 'integration',
  description:
    'Read / write / update / push / pull from a registered API in the catalogue. Pick an API by name, choose an operation (GET/POST/PUT/PATCH/DELETE), and give a path relative to its baseUrl. Auth is injected server-side; every request is SSRF-guarded and kept within the API\'s baseUrl.',
  configSchema: {
    type: 'object',
    properties: {
      api: {
        type: 'string',
        description:
          'Catalogue key or name of the registered API to call (from the API catalogue / api_search). Supports {{input.field}} templates.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        description:
          'HTTP method. GET = read/pull; POST = create/push; PUT = replace/update; PATCH = update fields; DELETE = delete.',
      },
      path: {
        type: 'string',
        description:
          "Path appended to the API's baseUrl (e.g. \"/v1/schools?limit=10\"). May include a query string. Supports {{input.field}} templates. Leave blank to call the baseUrl itself.",
      },
      query: {
        type: 'string',
        description:
          'Optional JSON object of query parameters merged into the URL (blank/null values are skipped). Supports templates.',
      },
      body: {
        type: 'string',
        description:
          'Request body for write/update methods — JSON or a template string. Ignored for GET. Supports {{input.field}} templates.',
      },
      headers: {
        type: 'string',
        description: 'Optional JSON object of extra request headers. Supports templates. (Auth is added automatically.)',
      },
    },
    required: ['api', 'method'],
  },
  defaultConfig: { api: '', method: 'GET', path: '', query: '', body: '', headers: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'API response' }],
  basicConfig: [
    {
      key: 'api',
      label: 'API',
      type: 'template-textarea',
      description: 'Catalogue key or name of the registered API. Supports {{input.field}} templates.',
      placeholder: 'open-meteo',
    },
    {
      key: 'method',
      label: 'Operation',
      type: 'dropdown',
      description: 'What to do against the API.',
      options: [
        { value: 'GET', label: 'Read / pull (GET)' },
        { value: 'POST', label: 'Create / push (POST)' },
        { value: 'PUT', label: 'Replace / update (PUT)' },
        { value: 'PATCH', label: 'Update fields (PATCH)' },
        { value: 'DELETE', label: 'Delete (DELETE)' },
      ],
    },
    {
      key: 'path',
      label: 'Path',
      type: 'template-textarea',
      description: "Path relative to the API's baseUrl. May include a ?query. Supports {{input.field}} templates.",
      placeholder: '/v1/forecast?latitude={{input.lat}}&longitude={{input.lon}}',
    },
    {
      key: 'body',
      label: 'Body (JSON)',
      type: 'template-textarea',
      description: 'Request body for write/update methods. Ignored for GET. Supports templates.',
      placeholder: '{ "name": "{{input.name}}" }',
      visibleWhen: { key: 'method', in: BODY_METHODS },
    },
    {
      key: 'query',
      label: 'Query params (JSON)',
      type: 'textarea',
      advancedOnly: true,
      description: 'Optional JSON object of query params merged into the URL.',
      placeholder: '{ "limit": 10 }',
    },
    {
      key: 'headers',
      label: 'Extra headers (JSON)',
      type: 'textarea',
      advancedOnly: true,
      description: 'Optional JSON object of extra request headers. Auth is added automatically.',
      placeholder: '{ "Accept": "application/json" }',
    },
  ],
  summarize: (config) => {
    const method = String(config.method ?? 'GET').toUpperCase();
    const api = String(config.api ?? '').trim() || '(no API)';
    const path = String(config.path ?? '').trim();
    return {
      line: `${method} ${api}${path ? ' ' + path : ''}`,
      preview: { kind: 'db', details: { API: api, Method: method, Path: path || '/' } },
    };
  },
  llmDescription:
    'Call a registered external API from the permanent `api_catalog` — the vetted registry the self-improvement engine grows and the `api_call` site tool uses. Use this to READ/PULL live data (GET) or WRITE/PUSH/UPDATE data (POST/PUT/PATCH/DELETE) from any catalogued API without hand-writing a full URL or wiring auth. ' +
    'Config: `api` (catalogue key or name, e.g. "open-meteo", "companies-house"); `method` (GET read/pull · POST create/push · PUT replace · PATCH update · DELETE); `path` (appended to the API\'s baseUrl — may include a ?query; leave blank to hit the baseUrl); optional `query` (JSON object of params merged in) and `body` (JSON for write methods) and `headers` (JSON). `api`, `path`, `query`, `body`, `headers` all support {{input.field}} templates. ' +
    'The node resolves the API\'s baseUrl, composes the full URL, injects env-ref auth server-side, and SSRF-guards every hop; a request can never leave the catalogued baseUrl. ' +
    'Output: { success, api, status, url, json } (parsed JSON when the response is JSON, else { text }). On a non-2xx response or network error the node errors (honours the On-failure setting). ' +
    'Prefer this over `http-request` whenever the target is (or should be) in the catalogue — you get vetted hosts, injected auth, and status tracking. Use `http-request` only for a truly ad-hoc URL. Under a dry run this node NEVER calls the API — it returns { dryRun: true, api, method, path }.',
  llmExamples: [
    { api: 'open-meteo', method: 'GET', path: '/v1/forecast?latitude={{input.lat}}&longitude={{input.lon}}&current=temperature_2m' },
    { api: 'companies-house', method: 'GET', path: '/company/{{input.companyNumber}}' },
    { api: 'World Bank', method: 'GET', path: '/v2/country/GB/indicator/SP.POP.TOTL?format=json' },
  ],
};

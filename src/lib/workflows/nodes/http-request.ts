import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate, interpolateTemplateStrict } from './template';

/** Resolve a dot-path into a value (empty path returns the object itself). */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Set/replace a single query parameter on an absolute URL. */
function withQueryParam(rawUrl: string, param: string, value: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.set(param, value);
    return u.toString();
  } catch {
    // Fallback for URLs the URL constructor can't parse: naive replace/append.
    const [beforeHash, hash] = rawUrl.split('#');
    const [path, query = ''] = beforeHash.split('?');
    const parts = query
      .split('&')
      .filter((s) => s && s.split('=')[0] !== encodeURIComponent(param) && s.split('=')[0] !== param);
    parts.push(`${encodeURIComponent(param)}=${encodeURIComponent(value)}`);
    const rebuilt = `${path}?${parts.join('&')}`;
    return hash ? `${rebuilt}#${hash}` : rebuilt;
  }
}

interface PaginationConfig {
  mode: 'cursor' | 'page';
  cursorPath?: string;
  cursorParam?: string;
  pageParam?: string;
  startPage?: number | string;
  itemsPath?: string;
  maxPages?: number | string;
}

/** Return a usable pagination config, or null when pagination is off. */
function readPagination(config: Record<string, unknown>): PaginationConfig | null {
  const p = config.pagination;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const mode = (p as Record<string, unknown>).mode;
  if (mode !== 'cursor' && mode !== 'page') return null;
  return p as PaginationConfig;
}

function clampMaxPages(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

interface RequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Perform one request and parse the response body (JSON when advertised, else text). */
async function performRequest(url: string, fetchInit: RequestInit): Promise<RequestResult> {
  const response = await fetch(url, fetchInit);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const contentType = response.headers.get('content-type') || '';
  let body: unknown;
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
  } else {
    body = await response.text();
  }

  return { status: response.status, headers: responseHeaders, body };
}

/**
 * Paginated fetch. Repeatedly requests pages, concatenating each page's items
 * (from `itemsPath`) into a flat `items[]`. Two modes:
 *  - `page`   — increments `pageParam` starting at `startPage`.
 *  - `cursor` — reads the next cursor from the response body at `cursorPath`
 *               and re-requests with it under `cursorParam`.
 * Stops on: maxPages cap, an empty page, or (cursor mode) a missing/empty
 * cursor. Honours `context.abortSignal` between pages. A per-page fetch error
 * propagates (the node fails; `_onError` governs retry/skip).
 * Output keeps today's shape (status/headers/body from the LAST response) and
 * adds `{ items, pages }`.
 */
async function runPaginated(
  baseUrl: string,
  fetchInit: RequestInit,
  pagination: PaginationConfig,
  context: ExecutionContext,
): Promise<NodeResult> {
  const mode = pagination.mode;
  const itemsPath = (pagination.itemsPath || '').trim();
  const maxPages = clampMaxPages(pagination.maxPages);
  const cursorPath = (pagination.cursorPath || '').trim();
  const cursorParam = (pagination.cursorParam || '').trim();
  const pageParam = (pagination.pageParam || 'page').trim() || 'page';
  const startPageNum = Number(pagination.startPage);
  let page = Number.isFinite(startPageNum) ? Math.floor(startPageNum) : 1;

  if (mode === 'cursor' && (!cursorPath || !cursorParam)) {
    throw new Error(
      'Cursor pagination requires both cursorPath (where the next cursor lives in the response) and cursorParam (the query param to send it as).',
    );
  }

  const items: unknown[] = [];
  const logs: string[] = [];
  let pages = 0;
  let last: RequestResult = { status: 0, headers: {}, body: undefined };
  let nextUrl = mode === 'page' ? withQueryParam(baseUrl, pageParam, String(page)) : baseUrl;
  let earlyStop = false;

  while (pages < maxPages) {
    if (context.abortSignal?.aborted) {
      logs.push(`[pagination] aborted after ${pages} page(s)`);
      earlyStop = true;
      break;
    }

    const res = await performRequest(nextUrl, fetchInit);
    pages++;
    last = res;

    const pageItems = resolvePath(res.body, itemsPath);
    const arr = Array.isArray(pageItems) ? pageItems : [];
    if (arr.length === 0) {
      logs.push(`[pagination] page ${pages} returned no items — stopping`);
      earlyStop = true;
      break;
    }
    items.push(...arr);

    if (mode === 'cursor') {
      const cursor = resolvePath(res.body, cursorPath);
      if (cursor == null || cursor === '') {
        logs.push(`[pagination] no cursor at "${cursorPath}" — stopping after ${pages} page(s)`);
        earlyStop = true;
        break;
      }
      nextUrl = withQueryParam(baseUrl, cursorParam, String(cursor));
    } else {
      page++;
      nextUrl = withQueryParam(baseUrl, pageParam, String(page));
    }
  }

  if (!earlyStop && pages >= maxPages) {
    logs.push(`[pagination] reached maxPages cap (${maxPages})`);
  }

  return {
    output: { status: last.status, headers: last.headers, body: last.body, items, pages },
    rowCount: items.length,
    logs,
  };
}

export const httpRequestExecutor: NodeExecutor = {
  type: 'http-request',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const method = (config.method as string) || 'GET';
    const rawUrl = (config.url as string) || '';
    const rawHeaders = (config.headers as string) || '{}';
    const rawBody = (config.body as string) || '';
    const auth = (config.auth as string) || 'none';
    const authHeader = (config.authHeader as string) || 'X-API-Key';

    const allMissing: string[] = [];

    const { result: url, missingPaths: urlMissing } = interpolateTemplateStrict(rawUrl, input);
    allMissing.push(...urlMissing);

    let authToken = '';
    if (auth !== 'none') {
      const { result: tokenResult, missingPaths: tokenMissing } = interpolateTemplateStrict(
        (config.authToken as string) || '', input,
      );
      authToken = tokenResult;
      allMissing.push(...tokenMissing);
    } else {
      authToken = interpolateTemplate((config.authToken as string) || '', input);
    }

    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(interpolateTemplate(rawHeaders, input));
    } catch {
      // ignore malformed headers JSON
    }

    if (auth === 'bearer' && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else if (auth === 'apiKey' && authToken) {
      headers[authHeader] = authToken;
    }

    let interpolatedBody = '';
    if (method !== 'GET' && method !== 'HEAD' && rawBody) {
      const { result: bodyResult, missingPaths: bodyMissing } = interpolateTemplateStrict(rawBody, input);
      interpolatedBody = bodyResult;
      allMissing.push(...bodyMissing);
    }

    if (allMissing.length > 0) {
      throw new Error(`Template references unresolved: ${allMissing.join(', ')}. Check upstream node output.`);
    }

    const pagination = readPagination(config);

    if (context.dryRun) {
      return {
        output: {
          simulated: true,
          would_request: { method, url, headers, body: interpolatedBody || undefined },
          ...(pagination ? { would_paginate: { mode: pagination.mode, maxPages: clampMaxPages(pagination.maxPages) } } : {}),
        },
        rowCount: 1,
        logs: [`[dry-run] skipped-for-dry-run: would ${method} ${url}`],
      };
    }

    const fetchInit: RequestInit = { method, headers };

    if (interpolatedBody) {
      try {
        JSON.parse(interpolatedBody); // validate
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        fetchInit.body = interpolatedBody;
      } catch {
        fetchInit.body = interpolatedBody;
      }
    }

    if (pagination) {
      return runPaginated(url, fetchInit, pagination, context);
    }

    const { status, headers: responseHeaders, body } = await performRequest(url, fetchInit);

    return {
      output: {
        status,
        headers: responseHeaders,
        body,
      },
      rowCount: Array.isArray(body) ? body.length : 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for URL/header/body template interpolation' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        status: { type: 'number', description: 'HTTP status code (last response when paginating)' },
        headers: { type: 'object', description: 'Response headers (last response when paginating)' },
        body: { type: 'any', description: 'Parsed JSON or raw text response body (last response when paginating)' },
        items: { type: 'array', description: 'Pagination only: every page\'s items (from itemsPath) concatenated' },
        pages: { type: 'number', description: 'Pagination only: number of pages fetched' },
      },
    };
  },
};

export const httpRequestDef: NodeDefinition = {
  type: 'http-request',
  label: 'HTTP Request',
  category: 'core',
  description: 'Make an HTTP request. URL, headers, and body support {{input.field}} template variables. Optional pagination auto-follows pages.',
  configSchema: {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE' },
      url: { type: 'string', description: 'Request URL. Supports {{input.field}} templates.' },
      headers: { type: 'string', description: 'JSON object of request headers. Supports templates.' },
      body: { type: 'string', description: 'Request body (JSON or template string). Ignored for GET.' },
      auth: { type: 'string', description: 'Auth type: none, bearer, apiKey' },
      authToken: { type: 'string', description: 'Token value for bearer/apiKey auth. Supports templates.' },
      authHeader: { type: 'string', description: 'Header name for apiKey auth (default: X-API-Key)' },
      pagination: {
        type: 'object',
        description: 'Optional. Auto-follow multiple pages and concatenate each page\'s items. Shape: { mode: "page"|"cursor", itemsPath (dot-path to each page\'s array; blank = body is the array), pageParam (default "page"), startPage (default 1), cursorPath (dot-path to next cursor in the response body), cursorParam (query param to send the cursor as), maxPages (default 3, max 10) }. When set, output also includes { items, pages }.',
      },
    },
    required: ['url'],
  },
  defaultConfig: { method: 'GET', url: '', headers: '{}', body: '', auth: 'none', authToken: '', authHeader: 'X-API-Key' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
  basicConfig: [
    { key: 'method', label: 'Method', type: 'dropdown', options: [
      { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' }, { value: 'PATCH', label: 'PATCH' }, { value: 'DELETE', label: 'DELETE' },
    ]},
    { key: 'url', label: 'URL', type: 'template-textarea', placeholder: 'https://api.example.com/{{input.path}}' },
    { key: 'auth', label: 'Authentication', type: 'dropdown', options: [
      { value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'apiKey', label: 'API Key' },
    ]},
    { key: 'authToken', label: 'Token', type: 'template-textarea' },
    { key: 'headers', label: 'Headers (JSON)', type: 'textarea', advancedOnly: true },
    { key: 'body', label: 'Body', type: 'template-textarea', advancedOnly: true },
    { key: 'authHeader', label: 'API Key Header Name', type: 'text', advancedOnly: true },
  ],
  llmDescription:
    'IMPORTANT: This node outputs { status: number, headers: object, body: any }. The API response is wrapped in the "body" field. Downstream nodes must access API data via input.body (e.g. input.body.results, input.body.data). Do NOT access API fields directly on input — always go through input.body.\n\n' +
    'PAGINATION: set config.pagination to auto-follow multiple pages and concatenate their items — then the output ALSO includes { items: [...all pages concatenated...], pages: <count> } and status/headers/body reflect the LAST response. itemsPath is a dot-path into the response body pointing at each page\'s array (leave blank if the body itself is the array). Two modes:\n' +
    '- Page number: { "mode": "page", "pageParam": "page", "startPage": 1, "itemsPath": "results", "maxPages": 5 } — requests ?page=1,2,3…, stopping on an empty page or maxPages (max 10).\n' +
    '- Cursor: { "mode": "cursor", "cursorPath": "meta.next_cursor", "cursorParam": "cursor", "itemsPath": "data", "maxPages": 5 } — reads the next cursor from the response body at cursorPath, then re-requests with ?cursor=<value>; stops when that field is missing/empty, on an empty page, or at maxPages.',
  llmExamples: [
    { method: 'GET', url: 'https://wttr.in/London?format=j1', headers: '{}', auth: 'none' },
    { method: 'GET', url: 'https://api.example.com/v1/items', headers: '{}', auth: 'none', pagination: { mode: 'page', pageParam: 'page', startPage: 1, itemsPath: 'results', maxPages: 5 } },
    { method: 'GET', url: 'https://api.example.com/v1/feed', headers: '{}', auth: 'none', pagination: { mode: 'cursor', cursorPath: 'meta.next_cursor', cursorParam: 'cursor', itemsPath: 'data', maxPages: 5 } },
  ],
};

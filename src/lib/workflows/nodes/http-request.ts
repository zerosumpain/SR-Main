import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export const httpRequestExecutor: NodeExecutor = {
  type: 'http-request',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const method = (config.method as string) || 'GET';
    const rawUrl = (config.url as string) || '';
    const rawHeaders = (config.headers as string) || '{}';
    const rawBody = (config.body as string) || '';
    const auth = (config.auth as string) || 'none';
    const authToken = interpolateTemplate((config.authToken as string) || '', input);
    const authHeader = (config.authHeader as string) || 'X-API-Key';

    const url = interpolateTemplate(rawUrl, input);

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

    const fetchInit: RequestInit = { method, headers };

    if (method !== 'GET' && method !== 'HEAD' && rawBody) {
      const interpolatedBody = interpolateTemplate(rawBody, input);
      try {
        JSON.parse(interpolatedBody); // validate
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        fetchInit.body = interpolatedBody;
      } catch {
        fetchInit.body = interpolatedBody;
      }
    }

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

    return {
      output: {
        status: response.status,
        headers: responseHeaders,
        body,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for URL/header/body template interpolation' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        status: { type: 'number', description: 'HTTP status code' },
        headers: { type: 'object', description: 'Response headers' },
        body: { type: 'any', description: 'Parsed JSON or raw text response body' },
      },
    };
  },
};

export const httpRequestDef: NodeDefinition = {
  type: 'http-request',
  label: 'HTTP Request',
  category: 'core',
  description: 'Make an HTTP request. URL, headers, and body support {{input.field}} template variables.',
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
    },
    required: ['url'],
  },
  defaultConfig: { method: 'GET', url: '', headers: '{}', body: '', auth: 'none', authToken: '', authHeader: 'X-API-Key' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
};

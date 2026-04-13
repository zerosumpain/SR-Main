import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpRequestExecutor, httpRequestDef } from '$lib/workflows/nodes/http-request';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('httpRequestExecutor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a GET request and returns status + body', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ hello: 'world' }),
      text: async () => '{"hello":"world"}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    const result = await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com/api', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(result.output.status).toBe(200);
    expect(result.output.body).toEqual({ hello: 'world' });
  });

  it('interpolates template variables in URL', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '{}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    await httpRequestExecutor.execute(
      { userId: '42' },
      { method: 'GET', url: 'https://example.com/users/{{input.userId}}', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://example.com/users/42',
      expect.anything(),
    );
  });

  it('adds bearer token when auth is bearer', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '{}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com', headers: '{}', body: '', auth: 'bearer', authToken: 'mytoken' },
      mockContext,
    );

    const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['Authorization']).toBe('Bearer mytoken');
  });

  it('returns non-JSON response as text in body', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: async () => { throw new Error('not JSON'); },
      text: async () => 'plain text response',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    const result = await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(result.output.body).toBe('plain text response');
  });

  it('has correct type', () => {
    expect(httpRequestExecutor.type).toBe('http-request');
  });
});

describe('httpRequestDef', () => {
  it('is core category', () => {
    expect(httpRequestDef.category).toBe('core');
  });
  it('has required url in configSchema', () => {
    expect(httpRequestDef.configSchema.properties?.url).toBeDefined();
  });
});

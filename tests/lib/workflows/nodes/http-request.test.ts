import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpRequestExecutor, httpRequestDef } from '$lib/workflows/nodes/http-request';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
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

  it('skips the network request on dryRun and returns a simulated result', async () => {
    const result = await httpRequestExecutor.execute(
      { userId: '7' },
      { method: 'POST', url: 'https://example.com/users/{{input.userId}}', headers: '{}', body: '{"a":1}', auth: 'none' },
      { ...mockContext, dryRun: true },
    );

    expect(result.output).toMatchObject({ simulated: true });
    expect(result.logs?.[0]).toContain('skipped-for-dry-run');
    // Critically: fetch is never called.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('httpRequestExecutor pagination', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200) {
    return {
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
      text: async () => JSON.stringify(body),
      ok: status < 400,
    };
  }

  it('cursor mode: follows the cursor and terminates when it is missing', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 1 }, { id: 2 }], next_cursor: 'abc' }) as any)
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 3 }], next_cursor: null }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'next_cursor', cursorParam: 'cursor', itemsPath: 'items', maxPages: 5 },
      },
      mockContext,
    );

    expect(result.output.pages).toBe(2);
    expect(result.output.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // body/status reflect the LAST response
    expect(result.output.body).toEqual({ items: [{ id: 3 }], next_cursor: null });
    expect(result.output.status).toBe(200);
    expect(result.rowCount).toBe(3);
    // second request carried the cursor
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('cursor=');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('cursor=abc');
  });

  it('cursor mode: stops when the cursorPath field is entirely absent from the body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ items: [{ id: 1 }] }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'next_cursor', cursorParam: 'cursor', itemsPath: 'items', maxPages: 5 },
      },
      mockContext,
    );

    expect(result.output.pages).toBe(1);
    expect(result.output.items).toEqual([{ id: 1 }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('page mode: increments the page param and stops on an empty page', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ results: [1, 2] }) as any)
      .mockResolvedValueOnce(jsonResponse({ results: [3, 4] }) as any)
      .mockResolvedValueOnce(jsonResponse({ results: [] }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/list', headers: '{}', auth: 'none',
        pagination: { mode: 'page', pageParam: 'page', startPage: 1, itemsPath: 'results', maxPages: 10 },
      },
      mockContext,
    );

    expect(result.output.pages).toBe(3);
    expect(result.output.items).toEqual([1, 2, 3, 4]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('page=1');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('page=2');
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain('page=3');
  });

  it('page mode: honours a non-default startPage', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ results: [1] }) as any)
      .mockResolvedValueOnce(jsonResponse({ results: [] }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/list', headers: '{}', auth: 'none',
        pagination: { mode: 'page', pageParam: 'p', startPage: 5, itemsPath: 'results', maxPages: 10 },
      },
      mockContext,
    );

    expect(result.output.items).toEqual([1]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('p=5');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('p=6');
  });

  it('caps at maxPages even when more pages are available', async () => {
    // Every response has more items + a live cursor, so only the cap stops it.
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ results: [1], next: 'more' }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'next', cursorParam: 'c', itemsPath: 'results', maxPages: 3 },
      },
      mockContext,
    );

    expect(result.output.pages).toBe(3);
    expect(result.output.items).toEqual([1, 1, 1]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('clamps maxPages above the hard limit of 10', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ results: [1], next: 'more' }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'next', cursorParam: 'c', itemsPath: 'results', maxPages: 999 },
      },
      mockContext,
    );

    expect(result.output.pages).toBe(10);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it('itemsPath supports a dot-path into nested response bodies', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [1, 2] }, meta: { next: 'n1' } }) as any)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [3] }, meta: { next: '' } }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'meta.next', cursorParam: 'cursor', itemsPath: 'data.items', maxPages: 5 },
      },
      mockContext,
    );

    expect(result.output.items).toEqual([1, 2, 3]);
    expect(result.output.pages).toBe(2);
  });

  it('respects abortSignal between pages', async () => {
    const controller = new AbortController();
    const ctx = { ...mockContext, abortSignal: controller.signal };
    vi.mocked(fetch).mockImplementation(async () => {
      controller.abort(); // abort right after the first page returns
      return jsonResponse({ results: [1], next: 'more' }) as any;
    });

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'cursor', cursorPath: 'next', cursorParam: 'c', itemsPath: 'results', maxPages: 5 },
      },
      ctx,
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.output.pages).toBe(1);
    expect(result.output.items).toEqual([1]);
  });

  it('a per-page fetch error fails the node', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ results: [1], next: 'x' }) as any)
      .mockRejectedValueOnce(new Error('boom'));

    await expect(
      httpRequestExecutor.execute(
        {},
        {
          method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
          pagination: { mode: 'cursor', cursorPath: 'next', cursorParam: 'c', itemsPath: 'results', maxPages: 5 },
        },
        mockContext,
      ),
    ).rejects.toThrow('boom');
  });

  it('cursor mode requires cursorPath and cursorParam', async () => {
    await expect(
      httpRequestExecutor.execute(
        {},
        {
          method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
          pagination: { mode: 'cursor', itemsPath: 'results', maxPages: 5 },
        },
        mockContext,
      ),
    ).rejects.toThrow(/cursor/i);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('empty itemsPath treats the body itself as the page array', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([1, 2]) as any)
      .mockResolvedValueOnce(jsonResponse([]) as any);

    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/list', headers: '{}', auth: 'none',
        pagination: { mode: 'page', pageParam: 'page', startPage: 1, itemsPath: '', maxPages: 10 },
      },
      mockContext,
    );

    expect(result.output.items).toEqual([1, 2]);
    expect(result.output.pages).toBe(2);
  });

  it('non-paginated request keeps the original output shape (no items/pages)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ hello: 'world' }) as any);

    const result = await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com/api', headers: '{}', auth: 'none' },
      mockContext,
    );

    expect(result.output).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world' },
    });
    expect(result.output.items).toBeUndefined();
    expect(result.output.pages).toBeUndefined();
  });

  it('does not fetch on dryRun even when pagination is configured', async () => {
    const result = await httpRequestExecutor.execute(
      {},
      {
        method: 'GET', url: 'https://example.com/feed', headers: '{}', auth: 'none',
        pagination: { mode: 'page', pageParam: 'page', startPage: 1, itemsPath: 'results', maxPages: 5 },
      },
      { ...mockContext, dryRun: true },
    );

    expect(result.output).toMatchObject({ simulated: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('httpRequestDef', () => {
  it('is core category', () => {
    expect(httpRequestDef.category).toBe('core');
  });
  it('has required url in configSchema', () => {
    expect(httpRequestDef.configSchema.properties?.url).toBeDefined();
  });
  it('documents pagination in configSchema', () => {
    expect(httpRequestDef.configSchema.properties?.pagination).toBeDefined();
  });
});

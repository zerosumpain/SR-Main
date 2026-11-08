import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

const h = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock('$lib/costs/usage-ingest.server', () => ({ ingestUsageEvents: h.ingest }));

const { POST } = await import('./+server');

const DFE = 'f'.repeat(40);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY;

beforeEach(() => {
  mutableEnv.MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY = DFE;
  h.ingest.mockReset();
  h.ingest.mockResolvedValue({ accepted: 1, duplicates: 0, rejected: [] });
});
afterAll(() => {
  if (original === undefined) delete mutableEnv.MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY;
  else mutableEnv.MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY = original;
});

async function call(body: unknown, token?: string) {
  const request = new Request('https://example.test/api/platform/models/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  try {
    const response = (await POST({ request } as never)) as Response;
    return { status: response.status, body: await response.json() };
  } catch (e) {
    const httpError = e as { status?: number };
    if (!httpError.status) throw e;
    return { status: httpError.status, body: null };
  }
}

describe('POST /api/platform/models/usage', () => {
  it('fails closed without a valid credential and writes nothing', async () => {
    expect((await call({ events: [] })).status).toBe(401);
    expect((await call({ events: [] }, 'z'.repeat(40))).status).toBe(401);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it('refuses a body that is not an events array', async () => {
    expect((await call('not json', DFE)).status).toBe(400);
    expect((await call({ event: {} }, DFE)).status).toBe(400);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it('refuses an oversized batch', async () => {
    expect((await call({ events: new Array(101).fill({}) }, DFE)).status).toBe(400);
  });

  it('attributes the batch to the credential, not to anything in the body', async () => {
    const r = await call({ app: 'drive', events: [{ id: 'x' }] }, DFE);
    expect(r.status).toBe(200);
    expect(h.ingest).toHaveBeenCalledWith('dfe-data-strategy', [{ id: 'x' }]);
    expect(r.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
  });
});

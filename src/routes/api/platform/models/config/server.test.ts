import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

const h = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('$lib/server/models/service-config', () => ({ buildModelConfigSnapshot: h.build }));

const { GET } = await import('./+server');

const TOKEN = 'p'.repeat(40);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.MODEL_SERVICE_TOKEN_POLICY_ENGINE;

beforeEach(() => {
  mutableEnv.MODEL_SERVICE_TOKEN_POLICY_ENGINE = TOKEN;
  h.build.mockReset();
  h.build.mockResolvedValue({ contract: 1, settings: {}, resolved: {}, catalogue: [] });
});
afterAll(() => {
  if (original === undefined) delete mutableEnv.MODEL_SERVICE_TOKEN_POLICY_ENGINE;
  else mutableEnv.MODEL_SERVICE_TOKEN_POLICY_ENGINE = original;
});

async function call(token?: string) {
  const request = new Request('https://example.test/api/platform/models/config', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  try {
    const response = (await GET({ request } as never)) as Response;
    return { status: response.status, body: await response.json(), headers: response.headers };
  } catch (e) {
    const httpError = e as { status?: number };
    if (!httpError.status) throw e;
    return { status: httpError.status, body: null, headers: null };
  }
}

describe('GET /api/platform/models/config', () => {
  it('fails closed without a credential, and builds nothing', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('x'.repeat(40))).status).toBe(401);
    expect(h.build).not.toHaveBeenCalled();
  });

  it('fails closed when the lane is not configured at all', async () => {
    delete mutableEnv.MODEL_SERVICE_TOKEN_POLICY_ENGINE;
    expect((await call(TOKEN)).status).toBe(401);
  });

  it('serves the snapshot uncached to a configured application', async () => {
    const r = await call(TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.contract).toBe(1);
    expect(r.headers?.get('cache-control')).toContain('no-store');
  });
});

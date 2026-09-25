import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone's Run starts through the `workflow_run` tool's start path — called
 * through the site-tool seam, not copied — so it inherits every change to it.
 */

vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => ({ id: 'dev-1', ownerEmail: 'owner@example.com' }),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));
vi.mock('$lib/workflows/native/workflows.server', () => ({
  findCanvas: async (slug: string) => (slug === 'morning' ? { id: 'wf-1', name: 'canvas:morning' } : null),
}));

const executeSiteTool = vi.fn();
vi.mock('$lib/workflows/site-tools/executor', () => ({
  executeSiteTool: (...a: unknown[]) => executeSiteTool(...a),
}));

async function run(body: string | null, slug = 'morning') {
  const mod = await import('../../../../src/routes/api/native/workflows/[slug]/run/+server');
  const request = new Request(`http://x/api/native/workflows/${slug}/run`, {
    method: 'POST',
    ...(body !== null ? { body } : {}),
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ params: { slug }, request, url: new URL(request.url) });
}

beforeEach(() => {
  executeSiteTool.mockReset();
  executeSiteTool.mockResolvedValue({ success: true, data: { runId: 'run-9', status: 'running' } });
});

describe('POST /api/native/workflows/[slug]/run', () => {
  it('hands the workflow id and input to workflow_run and answers 202 { runId }', async () => {
    const res = await run(JSON.stringify({ input: { city: 'Leeds' } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: 'run-9' });
    expect(executeSiteTool).toHaveBeenCalledWith('workflow_run', { id: 'wf-1', input: { city: 'Leeds' } });
  });

  it('runs with empty input when the body is empty', async () => {
    expect((await run(null)).status).toBe(202);
    expect(executeSiteTool).toHaveBeenCalledWith('workflow_run', { id: 'wf-1', input: {} });
  });

  it('404s an unknown slug without starting anything, and 500s a run that did not start', async () => {
    expect((await run('{}', 'nope')).status).toBe(404);
    expect(executeSiteTool).not.toHaveBeenCalled();
    executeSiteTool.mockResolvedValue({ success: false, error: 'Workflow not found' });
    expect((await run('{}')).status).toBe(500);
  });
});

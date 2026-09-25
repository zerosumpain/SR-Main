import { describe, it, expect, vi, beforeEach } from 'vitest';

const build = vi.hoisted(() => ({ proposeAmendOps: vi.fn() }));
vi.mock('$lib/workflows/build-from-prompt.server', () => build);
const wf = vi.hoisted(() => ({ findCanvas: vi.fn(), currentGraphVersion: vi.fn() }));
vi.mock('$lib/workflows/native/workflows.server', () => wf);

import { POST } from './+server';

function call(body: unknown) {
  return POST({
    params: { slug: 'news' },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  build.proposeAmendOps.mockReset();
  wf.findCanvas.mockReset().mockResolvedValue({ id: 'wf-1' });
  wf.currentGraphVersion.mockReset().mockResolvedValue(42);
});

describe('POST /api/canvas/:slug/ask', () => {
  it('returns the proposal UNAPPLIED with the graph version it was made against', async () => {
    build.proposeAmendOps.mockResolvedValue({ summary: 's', ops: [{ op: 'remove_node', nodeId: 'n' }], warnings: [] });
    const res = await call({ instruction: '  drop the email step ' });
    expect(build.proposeAmendOps).toHaveBeenCalledWith('wf-1', 'drop the email step');
    expect(await res.json()).toEqual({ summary: 's', ops: [{ op: 'remove_node', nodeId: 'n' }], warnings: [], version: 42 });
  });

  it('asks for an instruction', async () => {
    expect((await call({ instruction: ' ' })).status).toBe(422);
    expect(build.proposeAmendOps).not.toHaveBeenCalled();
  });
});

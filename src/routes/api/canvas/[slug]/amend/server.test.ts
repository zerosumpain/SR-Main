import { describe, it, expect, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ applyNativeAmend: vi.fn() }));
vi.mock('$lib/workflows/native/amend.server', () => native);
const wf = vi.hoisted(() => ({ findCanvas: vi.fn() }));
vi.mock('$lib/workflows/native/workflows.server', () => wf);

import { POST } from './+server';

function call(body: unknown) {
  return POST({
    params: { slug: 'news' },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
  } as never) as Promise<Response>;
}

const OPS = [{ op: 'remove_node', nodeId: 'n1' }];

beforeEach(() => {
  native.applyNativeAmend.mockReset();
  wf.findCanvas.mockReset().mockResolvedValue({ id: 'wf-1' });
});

describe('POST /api/canvas/:slug/amend', () => {
  it('applies the reviewed ops through the shared screen, audited as owner', async () => {
    native.applyNativeAmend.mockResolvedValue({ ok: true, version: 7, outcomes: [{ op: 'remove_node', summary: 'x' }] });
    const res = await call({ ops: OPS, expectedVersion: 3 });
    expect(res.status).toBe(200);
    expect(native.applyNativeAmend).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      ops: OPS,
      expectedVersion: 3,
      actor: 'owner',
    });
    expect(await res.json()).toEqual({ version: 7, outcomes: [{ op: 'remove_node', summary: 'x' }] });
  });

  it('passes a version clash through as 409', async () => {
    native.applyNativeAmend.mockResolvedValue({ ok: false, status: 409, error: 'changed', version: 9 });
    const res = await call({ ops: OPS, expectedVersion: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'changed', version: 9 });
  });

  it('refuses an empty proposal without touching the canvas', async () => {
    expect((await call({ ops: [] })).status).toBe(422);
    expect(native.applyNativeAmend).not.toHaveBeenCalled();
  });

  it('404s an unknown canvas', async () => {
    wf.findCanvas.mockResolvedValue(null);
    expect((await call({ ops: OPS })).status).toBe(404);
  });
});

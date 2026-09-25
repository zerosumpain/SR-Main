import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone answers a Describe-it build's question through the SAME
 * `answerBuildQuestion` the canvas's /build-answer calls.
 */

let paired = true;
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => (paired ? { id: 'dev-1', ownerEmail: 'owner@example.com' } : null),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));
vi.mock('$lib/workflows/native/workflows.server', () => ({
  findCanvas: async (slug: string) => (slug === 'jokes' ? { id: 'wf-1', name: 'canvas:jokes' } : null),
}));
const answerBuildQuestion = vi.fn();
vi.mock('$lib/canvas/build-answer.server', () => ({
  answerBuildQuestion: (...a: unknown[]) => answerBuildQuestion(...a),
}));

async function post(route: 'native' | 'canvas', body: string, slug = 'jokes') {
  const mod =
    route === 'native'
      ? await import('../../../../src/routes/api/native/workflows/[slug]/answer/+server')
      : await import('../../../../src/routes/api/canvas/[slug]/build-answer/+server');
  const request = new Request(`http://x/api/${slug}`, {
    method: 'POST',
    body,
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ params: { slug }, request, url: new URL(request.url) });
}

beforeEach(() => {
  paired = true;
  answerBuildQuestion.mockReset();
  answerBuildQuestion.mockResolvedValue({ status: 202, body: { building: true } });
});

describe('POST /api/native/workflows/[slug]/answer and /api/canvas/[slug]/build-answer', () => {
  it('both hand the raw body to answerBuildQuestion and answer 202 { building: true }', async () => {
    for (const route of ['native', 'canvas'] as const) {
      const res = await post(route, JSON.stringify({ answer: '25 September' }));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ building: true });
    }
    expect(answerBuildQuestion.mock.calls).toEqual([
      ['wf-1', { answer: '25 September' }],
      ['wf-1', { answer: '25 September' }],
    ]);
  });

  it('passes a 409 through, 404s an unknown slug, and 401s an unpaired phone', async () => {
    answerBuildQuestion.mockResolvedValue({ status: 409, body: { error: 'This workflow is not waiting on a question.' } });
    expect((await post('native', JSON.stringify({ skip: true }))).status).toBe(409);
    expect((await post('canvas', JSON.stringify({ skip: true }))).status).toBe(409);
    expect((await post('native', '{}', 'nope')).status).toBe(404);
    expect((await post('native', 'not json')).status).toBe(400);
    paired = false;
    expect((await post('native', JSON.stringify({ answer: 'x' }))).status).toBe(401);
  });
});

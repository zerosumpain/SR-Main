import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable.
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('POST /api/admin/blog/[id]/resolve-proposal (integration)', () => {
  let db: (typeof import('$lib/db'))['db'];
  let schema: typeof import('$lib/db/schema');
  let POST_handler: (typeof import('./+server'))['POST'];
  let parseResolution: (typeof import('$lib/blog/assistant/resolution'))['parseResolution'];
  let postId: number;

  function makeEvent(id: number, body: unknown) {
    return {
      params: { id: String(id) },
      request: new Request(`http://localhost/api/admin/blog/${id}/resolve-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as unknown as Parameters<typeof POST_handler>[0];
  }

  beforeAll(async () => {
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    ({ POST: POST_handler } = await import('./+server'));
    ({ parseResolution } = await import('$lib/blog/assistant/resolution'));

    const [post] = await db
      .insert(schema.blogPosts)
      .values({
        slug: `resolution-integration-${Date.now()}`,
        title: 'Resolution integration test',
        excerpt: 'x',
        content: '<p>x</p>',
      })
      .returning();
    postId = post.id;
  });

  afterAll(async () => {
    const { eq } = await import('drizzle-orm');
    if (postId) await db.delete(schema.blogPosts).where(eq(schema.blogPosts.id, postId));
  });

  async function storedResolutions() {
    const { eq, asc } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(schema.blogAssistantMessages)
      .where(eq(schema.blogAssistantMessages.postId, postId))
      .orderBy(asc(schema.blogAssistantMessages.createdAt));
    return rows
      .filter((r) => r.role === 'proposal_resolved')
      .map((r) => parseResolution(r.content))
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  it('defaults a new post to unknown authorship', async () => {
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ authorship: schema.blogPosts.authorship })
      .from(schema.blogPosts)
      .where(eq(schema.blogPosts.id, postId));
    expect(row.authorship).toBe('unknown');
  });

  it('persists a rejection — the signal that was previously discarded', async () => {
    const res = await POST_handler(
      makeEvent(postId, {
        proposalId: 'rej-1',
        status: 'rejected',
        kind: 'prose',
        original: 'The site is a rounding error.',
        suggested: 'The website represents a negligible fraction of traffic.',
        reason: 'more precise',
      }),
    );
    expect(res.status).toBe(200);

    const stored = await storedResolutions();
    const rejection = stored.find((r) => r.id === 'rej-1');
    expect(rejection).toBeDefined();
    expect(rejection?.status).toBe('rejected');
    expect(rejection?.original).toContain('rounding error');
    expect(rejection?.suggested).toContain('negligible');
    // Nothing landed, so there is no final text.
    expect(rejection?.final).toBeUndefined();
  });

  it('flags an acceptance the author rewrote before applying', async () => {
    const res = await POST_handler(
      makeEvent(postId, {
        proposalId: 'acc-1',
        status: 'accepted',
        kind: 'prose',
        original: 'It is a small site.',
        suggested: 'It is, in many respects, a rather modest website.',
        final: 'The site is a rounding error.',
      }),
    );
    expect(res.status).toBe(200);

    const stored = await storedResolutions();
    const accepted = stored.find((r) => r.id === 'acc-1');
    expect(accepted?.edited).toBe(true);
    expect(accepted?.final).toBe('The site is a rounding error.');
  });

  it('rejects a malformed status rather than recording a guess', async () => {
    await expect(
      POST_handler(makeEvent(postId, { proposalId: 'bad', status: 'maybe' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a proposalId', async () => {
    await expect(
      POST_handler(makeEvent(postId, { status: 'rejected' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

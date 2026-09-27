import { describe, expect, it } from 'vitest';

const { load } = await import('./+page.server');

describe('/home/people/[subject] — forwards to the one page', () => {
  it('308s to /home/people filtered to that person', async () => {
    const event = { params: { subject: 'sam o' } } as unknown as Parameters<typeof load>[0];
    await expect(Promise.resolve().then(() => load(event))).rejects.toMatchObject({
      status: 308,
      location: '/home/people?person=sam%20o',
    });
  });
});

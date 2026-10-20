import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ team: '' }));
vi.mock('$env/dynamic/private', () => ({ env: { get APPLE_TEAM_ID() { return h.team; } } }));
vi.mock('$lib/server/registration', () => ({ appleAudience: () => 'com.strangeramblings.com.appleapp' }));

const { GET } = await import('./+server');

describe('/.well-known/apple-app-site-association', () => {
  it('claims nothing until the team id is configured', async () => {
    expect((await GET({} as never)).status).toBe(404);
    h.team = 'not a team';
    expect((await GET({} as never)).status).toBe(404);
  });

  it('names the app for /app/* once it is', async () => {
    h.team = 'ABCDE12345';
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      applinks: { details: [{ appIDs: ['ABCDE12345.com.strangeramblings.com.appleapp'], components: [{ '/': '/app/*', comment: expect.any(String) }] }] },
    });
  });
});

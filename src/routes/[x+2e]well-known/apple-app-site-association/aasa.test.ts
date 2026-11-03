import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ team: '' }));
vi.mock('$env/dynamic/private', () => ({ env: { get APPLE_TEAM_ID() { return h.team; } } }));
vi.mock('$lib/server/registration', () => ({ appleAudience: () => 'com.strangeramblings.com.appleapp' }));

const { GET } = await import('./+server');

describe('/.well-known/apple-app-site-association', () => {
  it('names the app for install links and sr. tv joins, under the default team', async () => {
    h.team = '';
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['V74Q4X66B7.com.strangeramblings.com.appleapp'],
            components: [
              { '/': '/app/*', comment: expect.any(String) },
              { '/': '/games/join/*', comment: expect.any(String) },
            ],
          },
        ],
      },
    });
  });

  it('APPLE_TEAM_ID overrides the team, and anything else turns the file off', async () => {
    h.team = 'ABCDE12345';
    expect((await (await GET({} as never)).json()).applinks.details[0].appIDs).toEqual(['ABCDE12345.com.strangeramblings.com.appleapp']);
    h.team = 'off';
    expect((await GET({} as never)).status).toBe(404);
  });
});

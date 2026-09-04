import { describe, expect, it } from 'vitest';
import { DEPENDENCIES, worstState } from './catalog';
import {
  componentState,
  parseHetznerStatus,
  parseRssItems,
  parseStatusPage,
  probeDependencies,
} from './probe.server';
import { parseGatusPublicJourney, readGatusPublicJourney } from './gatus.server';

describe('dependency catalogue', () => {
  it('has unique ids and an actionable source for every dependency', () => {
    expect(new Set(DEPENDENCIES.map((item) => item.id)).size).toBe(DEPENDENCIES.length);
    for (const dependency of DEPENDENCIES) {
      expect(dependency.statusUrl).toMatch(/^https:\/\//);
      expect(dependency.affects).toBeTruthy();
    }
  });

  it('covers the user journey and the estate providers', () => {
    expect(DEPENDENCIES.map((item) => item.id)).toEqual([
      'public-site',
      'cloudflare',
      'hetzner',
      'azure',
      'google',
      'openrouter',
      'tailscale',
      'github',
      'backblaze',
    ]);
  });
});

describe('RAG state', () => {
  it('orders outages, degradation and missing evidence conservatively', () => {
    expect(worstState(['green', 'green'])).toBe('green');
    expect(worstState(['green', 'red', 'amber'])).toBe('red');
    expect(worstState(['green', 'amber'])).toBe('amber');
    expect(worstState(['green', 'unknown'])).toBe('unknown');
    expect(worstState([])).toBe('unknown');
  });

  it('maps common Statuspage component states', () => {
    expect(componentState('operational')).toBe('green');
    expect(componentState('degraded_performance')).toBe('amber');
    expect(componentState('partial_outage')).toBe('amber');
    expect(componentState('major_outage')).toBe('red');
    expect(componentState('invented')).toBe('unknown');
  });
});

describe('independent public monitoring', () => {
  it('combines homepage and application results conservatively by five-minute window', () => {
    const observations = parseGatusPublicJourney([
      {
        name: 'Homepage',
        results: [
          { success: true, duration: 120_000_000, timestamp: '2026-09-04T10:01:00Z' },
          { success: true, duration: 180_000_000, timestamp: '2026-09-04T10:06:00Z' },
        ],
      },
      {
        name: 'Application',
        results: [
          { success: false, duration: 80_000_000, timestamp: '2026-09-04T10:02:00Z' },
          { success: true, duration: 3_200_000_000, timestamp: '2026-09-04T10:07:00Z' },
        ],
      },
    ]);

    expect(observations).toHaveLength(2);
    expect(observations.map((item) => item.state)).toEqual(['red', 'amber']);
    expect(observations[0].summary).toContain('Application');
    expect(observations[1].latencyMs).toBe(3_200);
  });

  it('ignores malformed Gatus samples instead of inventing green evidence', () => {
    expect(parseGatusPublicJourney([{ name: 'Homepage', results: [{ success: true }] }])).toEqual([]);
  });
});

describe('provider parsers', () => {
  it('ignores unrelated Cloudflare components and reports a relevant one', () => {
    const parsed = parseStatusPage({
      components: [
        { name: 'Workers AI', status: 'major_outage' },
        { name: 'Authoritative DNS', status: 'operational' },
        { name: 'Tunnel', status: 'degraded_performance' },
      ],
    }, /^(Authoritative DNS|Tunnel)$/);
    expect(parsed.state).toBe('amber');
    expect(parsed.summary).toContain('Tunnel');
    expect(parsed.summary).not.toContain('Workers AI');
  });

  it('does not turn a provider schema change into a green status', () => {
    expect(parseStatusPage({ components: [] }, /^Tunnel$/).state).toBe('unknown');
  });

  it('reads active Hetzner cloud incidents from its embedded status payload', () => {
    const html = `
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            systems: [
              { '@id': '/systems/2', parent: null, titleEn: 'Cloud' },
              { '@id': '/systems/3', parent: '/systems/2', titleEn: 'Cloud Server' },
              { '@id': '/systems/99', parent: null, titleEn: 'Webhosting' },
            ],
            incidents: {
              topNotification: [
                { system: '/systems/99', incidentType: 'outage', titleEn: 'Unrelated webhosting outage' },
                { system: '/systems/3', incidentType: 'outage', titleEn: 'Cloud servers unavailable' },
              ],
            },
          },
        },
      })}</script>`;
    const parsed = parseHetznerStatus(html);
    expect(parsed.state).toBe('red');
    expect(parsed.summary).toContain('Cloud servers unavailable');
    expect(parsed.summary).not.toContain('webhosting');
  });

  it('treats no relevant Hetzner notification as operational', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { systems: [], incidents: { topNotification: [] } } },
    })}</script>`;
    expect(parseHetznerStatus(html).state).toBe('green');
  });

  it('extracts active Azure RSS items', () => {
    const items = parseRssItems(`
      <rss><channel><item><title>Blob Storage degraded in UK South</title>
      <description><![CDATA[Requests may time out]]></description></item></channel></rss>
    `);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Blob Storage degraded in UK South');
    expect(items[0].description).toContain('Requests may time out');
  });
});

describe.runIf(process.env.DEPENDENCY_LIVE_TEST === '1')('live dependency sources', () => {
  it('returns one bounded observation for every catalogued dependency', async () => {
    const observations = await probeDependencies();
    expect(observations.map((item) => item.dependencyId)).toEqual(
      DEPENDENCIES.map((item) => item.id),
    );
    expect(observations.every((item) => Number.isFinite(item.latencyMs))).toBe(true);
    expect(observations.filter((item) => item.state === 'unknown')).toEqual([]);
  }, 20_000);

  it('reads the independent public journey monitor', async () => {
    const observations = await readGatusPublicJourney();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((item) => item.dependencyId === 'public-site')).toBe(true);
  }, 10_000);
});

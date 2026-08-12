import { describe, expect, it, vi } from 'vitest';

const states = [
  { entity_id: 'update.home_assistant_core_update', state: 'on', last_updated: '2026-08-12T09:00:00Z', attributes: { installed_version: '2026.7.0', latest_version: '2026.8.0' } },
  { entity_id: 'sensor.ok', state: 'on' },
];
vi.mock('../homeassistant/service', () => ({ getHomeAssistantService: vi.fn(() => ({ queryAllStates: vi.fn(async () => ({ success: true, data: states })) })) }));
vi.mock('../site-tools/executor', () => ({ executeSiteTool: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock('./data-store', () => ({ appendAtomic: vi.fn() }));

import { infrastructureStatusExecutor } from './infrastructure-status';

describe('infrastructure-status', () => {
  it('returns an evidence-backed current-to-latest review without fabricating benefits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: '2026.8.0', html_url: 'https://github.com/home-assistant/core/releases/tag/2026.8.0', published_at: '2026-08-01T00:00:00Z', body: '- Fixes a specific automation regression affecting reloads\n- Adds a new dashboard feature for areas' }), { status: 200 })));
    const result = await infrastructureStatusExecutor.execute({}, { scope: 'home_assistant' }, { dryRun: true, workflowId: 'wf' } as never);
    const reviews = result.output.versionReviews as Array<{ capability: string; currentVersion: string | null; latestVersion: string | null; recommendation: string; benefits: string[] }>;
    expect(reviews).toContainEqual(expect.objectContaining({ capability: 'Home Assistant Core', currentVersion: '2026.7.0', latestVersion: '2026.8.0', recommendation: 'review first', benefits: ['Fixes a specific automation regression affecting reloads', 'Adds a new dashboard feature for areas'] }));
    expect(reviews.find((entry) => entry.capability === 'Life360')).toMatchObject({ recommendation: 'unavailable', benefits: [] });
    vi.unstubAllGlobals();
  });

  it('labels publisher lookup failure unavailable rather than inventing release data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const result = await infrastructureStatusExecutor.execute({}, { scope: 'home_assistant' }, { dryRun: true, workflowId: 'wf' } as never);
    const core = (result.output.versionReviews as Array<{ capability: string; recommendation: string; latestVersion: string | null; benefits: string[] }>).find((entry) => entry.capability === 'Home Assistant Core');
    expect(core).toMatchObject({ recommendation: 'unavailable', latestVersion: null, benefits: [] });
    vi.unstubAllGlobals();
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('./integrations', () => ({ listIntegrations: vi.fn(async () => [
  { key: 'national-rail-board', name: 'National Rail station board', description: 'Live arrivals and departures for any rail station', api: 'darwin', method: 'GET', path: '/board/{crs}', status: 'verified', params: [{ name: 'crs', in: 'path', required: true }], outputs: [{ name: 'services', expr: 'json.services' }] },
  { key: 'billing-credit', name: 'Billing credit balance', description: 'Current account credits', api: 'billing', method: 'GET', params: [], outputs: [] },
  { key: 'weather-forecast', name: 'Weather forecast', api: 'weather', method: 'GET', params: [{ name: 'city', in: 'query', required: true }], outputs: [] },
  { key: 'calendar-events', name: 'Calendar events', api: 'calendar', method: 'GET', params: [], outputs: [] },
]) }));
import { discoverIntegrations } from './integration-discovery';
import { listIntegrations } from './integrations';
import { getTools } from '$lib/workflows/site-tools/registry';
import { resolveCapabilities } from '$lib/jkai/grounding/capabilities';
import { dispatchMetaTool } from '$lib/mcp/meta-tool';
describe('saved-operation discovery across domains', () => {
  it.each([
    ['What’s the next train leaving Darlington?', 'national-rail-board'],
    ['What about the Darwin integration', 'national-rail-board'],
    ['How many billing credits are left?', 'billing-credit'],
    ['Weather forecast for London', 'weather-forecast'],
    ['Calendar events today', 'calendar-events'],
  ])('returns the callable operation for %s', async (query, key) => {
    const [match] = await discoverIntegrations(query);
    expect(match.key).toBe(key);
    expect(match.call).toMatchObject({ tool: 'api_integration_call', args: { key } });
    expect(match.inputSchema.additionalProperties).toBe(false);
  });
  it('does not route a train request to training tools in the actual registry', () => {
    const registry = getTools(); expect(registry.length).toBeGreaterThan(150);
    expect(resolveCapabilities(registry, 'What’s the next train leaving Darlington?', 3).map(t => t.name)).not.toContain('health_training_load');
  });
  it('exposes the same saved contract through tool_search and jkai_extended', async () => {
    const search = await getTools().find(t => t.name === 'tool_search')!.handler({ query: 'train Darlington' });
    expect(search.data).toMatchObject({ integrations: [{ key: 'national-rail-board', inputSchema: { required: ['crs'] } }] });
    const extended = await dispatchMetaTool({ operation: 'list', query: 'train Darlington' }, { emit: () => {} });
    expect(extended).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'api_integration_call', integration: expect.objectContaining({ key: 'national-rail-board' }) })]));
  });
  it('does not conceal register lookup failure as a missing integration', async () => {
    vi.mocked(listIntegrations).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(discoverIntegrations('rail')).rejects.toThrow('database unavailable');
    vi.mocked(listIntegrations).mockRejectedValueOnce(new Error('database unavailable'));
    expect(await dispatchMetaTool({ operation: 'list', query: 'rail' }, { emit: () => {} })).toEqual(expect.arrayContaining([expect.objectContaining({ integrationLookup: 'unavailable' })]));
  });
});

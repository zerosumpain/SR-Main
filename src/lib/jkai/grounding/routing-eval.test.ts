import { it, expect } from 'vitest';
import { resolveCapabilities } from './capabilities';
const tools = [
 { name: 'ha_query_state', description: 'Current temperature and light state from Home Assistant', toolset: 'home' },
 { name: 'apple_calendar_list', description: 'Read Apple calendar events and meetings', toolset: 'calendar' },
 { name: 'api_integration_call', description: 'Recorded PayPal payment integration', toolset: 'apis' },
 { name: 'file_search', description: 'Search uploaded document and file contents', toolset: 'files' },
];
it.each([
 ['current temperature', 'ha_query_state'], ['Apple calendar', 'apple_calendar_list'],
 ['PayPal payment', 'api_integration_call'], ['uploaded document', 'file_search'],
])('resolves %s to the authoritative capability', (query, expected) => {
 expect(resolveCapabilities(tools, query, 1)[0].name).toBe(expected);
});

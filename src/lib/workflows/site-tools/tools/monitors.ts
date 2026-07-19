// `monitors` toolset — natural-language monitors. monitor_create turns "watch X,
// tell me when Y" into a scheduled watch workflow; monitor_list shows them.
// Management (pause/resume/delete) is on the /jkai/monitors page.
import { register } from '../registry-internal';
import { createMonitor, listMonitors } from '$lib/monitors/monitors.server';

register({
  name: 'monitor_create',
  description:
    'Create a MONITOR: turn a "watch X and tell me when Y" request into a recurring scheduled workflow that checks a source, keeps only genuinely new items, and messages you when something new appears. Use when the user wants to be notified about ongoing changes (prices, listings, news, a page, an API). Returns the monitor + its canvas URL. May take a while (it generates a workflow).',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'What to watch and when to be told, in plain language (e.g. "tell me when a new SW1 flat under £2k appears on the letting site each morning").' },
      cron: { type: 'string', description: 'Optional 5-field cron cadence (e.g. "0 8 * * *"). Omit to let the monitor infer one (defaults to every 6 hours).' },
    },
    required: ['description'],
  },
  category: 'Monitors',
  toolset: 'monitors',
  handler: async (args, ctx) => {
    const description = typeof args.description === 'string' ? args.description : '';
    if (!description.trim()) return { success: false, error: 'description is required' };
    const cron = typeof args.cron === 'string' && args.cron.trim() ? args.cron.trim() : undefined;
    try {
      const marker = await createMonitor(description, cron, ctx?.emit);
      const url = `${(process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '')}/jkai/canvas/${marker.slug}`;
      return { success: true, data: { ...marker, url, manageUrl: '/jkai/monitors' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'monitor_create failed' };
    }
  },
});

register({
  name: 'monitor_list',
  description: 'List the active monitors (watch workflows) with their schedule, enabled state, and last run status.',
  parameters: { type: 'object', properties: {} },
  category: 'Monitors',
  toolset: 'monitors',
  handler: async () => {
    try {
      const monitors = await listMonitors();
      return { success: true, data: { count: monitors.length, monitors } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'monitor_list failed' };
    }
  },
});

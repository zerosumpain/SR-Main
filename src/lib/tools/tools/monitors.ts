// `monitors` toolset — natural-language monitors. monitor_create turns "watch X,
// tell me when Y" into a scheduled watch workflow; monitor_list shows them.
// Management (pause/resume/delete) is on the /jkai/daydreams/watches page.
import { register } from '../registry-internal';
import { createMonitor, listMonitors } from '$lib/monitors/monitors.server';
import { createEventMonitor, listEventMonitors, removeEventMonitor } from '$lib/monitors/event-monitors.server';
import { EVENT_CATALOGUE } from '$lib/events/catalogue';
import { refuseUnlessOwner } from './owner-only';

register({
  name: 'monitor_create',
  effect: 'mutate',
  confirm: 'never',
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
      return { success: true, data: { ...marker, url, manageUrl: '/jkai/daydreams/watches' } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'monitor_create failed' };
    }
  },
});

register({
  name: 'monitor_list',
  effect: 'read',
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

// Event monitors (workflow knit 2026-11-11, slice 5): "tell me when <event>
// happens". A platform event type, an optional filter on the payload, and a
// notification to John when one matches. Kept in a setting, no workflow is
// generated. See `$lib/monitors/event-monitors.server`.
//
// The subscription is NOT started here. This module is imported by the tool
// registry, so by every process role and every test; started at import, each
// of them listened and one event could notify more than once. One process
// listens: src/hooks.server.ts starts it under the `background` service.

const eventTypes = () => (EVENT_CATALOGUE as readonly { type: string; label: string }[]).map((e) => ({ type: e.type, label: e.label }));

register({
  name: 'event_monitor_create',
  effect: 'mutate',
  description:
    'Tell John when a site event happens: pick an event type from the catalogue (a release going live, a connector breaking, a capture being ready, a wish-list offer, a workflow finishing) and he gets a notification each time one is raised. Optional filter clauses match top-level payload fields ({ key, op: equals | contains, value }). Use for "tell me when <event> happens"; for watching a web page or a price over time use monitor_create instead. Notifies at most once per `everyMinutes` per monitor.',
  parameters: {
    type: 'object',
    properties: {
      event: { type: 'string', description: 'The event type, e.g. "release.live". event_monitor_list names them all.' },
      filter: {
        type: 'array',
        description: 'Optional: every clause must match the event payload.',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, op: { type: 'string', enum: ['equals', 'contains'] }, value: { type: 'string' } },
          required: ['key', 'value'],
        },
      },
      label: { type: 'string', description: 'Optional: the notification title, in a few words.' },
      everyMinutes: { type: 'number', minimum: 1, maximum: 1440, description: 'Least minutes between two notifications from this monitor. Default 10.' },
    },
    required: ['event'],
  },
  category: 'Monitors',
  toolset: 'monitors',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('event_monitor_create', ctx);
    if (refused) return refused;
    try {
      const out = await createEventMonitor({ eventType: args.event, filter: args.filter, label: args.label, minMinutes: args.everyMinutes });
      if (!out.ok) return { success: false, error: out.error };
      return { success: true, data: { monitor: out.monitor, message: `John will be told when ${out.monitor.eventType} happens.` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'event_monitor_create failed' };
    }
  },
});

register({
  name: 'event_monitor_list',
  effect: 'read',
  description: 'List the event monitors ("tell me when <event> happens") with their event type, filter and notification gap, and the event types a monitor can be made for. Read-only.',
  parameters: { type: 'object', properties: {} },
  category: 'Monitors',
  toolset: 'monitors',
  surfaces: ['chat', 'app'],
  handler: async (_args, ctx) => {
    const refused = refuseUnlessOwner('event_monitor_list', ctx);
    if (refused) return refused;
    try {
      const monitors = await listEventMonitors();
      return { success: true, data: { count: monitors.length, monitors, eventTypes: eventTypes() } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'event_monitor_list failed' };
    }
  },
});

register({
  name: 'event_monitor_remove',
  effect: 'mutate',
  confirm: 'light',
  description: 'Remove one event monitor by its id (from event_monitor_list), so John is no longer told about that event.',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'The monitor id, em_….' } }, required: ['id'] },
  category: 'Monitors',
  toolset: 'monitors',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('event_monitor_remove', ctx);
    if (refused) return refused;
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!/^em_[a-f0-9]{1,32}$/.test(id)) return { success: false, error: 'id must be an em_… monitor id.' };
    try {
      const gone = await removeEventMonitor(id);
      return gone ? { success: true, data: { removed: gone.id, eventType: gone.eventType } } : { success: false, error: `No event monitor ${id}.` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'event_monitor_remove failed' };
    }
  },
});

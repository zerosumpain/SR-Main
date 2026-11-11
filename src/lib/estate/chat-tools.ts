// src/lib/estate/chat-tools.ts
//
// jkai's estate and connection tools (workflow knit 2026-11-11, slices 3 and
// 4): what /admin/estate and /admin/connections show, and the two safe fix
// buttons from the connections page.
//
//   estate_status      each host's state, what is wrong and which services are down
//   connector_status   every account and service connection, probed live
//   connector_resync   pull from the health band's service now       (light confirm)
//   connector_test     prove a mail account can still read mail      (light confirm)
//
// The reads go through `probeEstate` + `readHostCards` and `probeAll`, the
// functions the pages load from. A host card's network address is not
// returned. The two writes do what the page's form actions do and no more.
// The page's other buttons are NOT tools: testing a bank or OAuth secret
// rotates tokens and reconnecting an account is a consent redirect, so both
// stay on the page, by decision.
//
// Owner-only, not member-safe. Registered from here (src/hooks.server.ts
// imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { probeEstate } from './probe.server';
import { readHostCards } from './vitals.server';
import { probeAll } from '$lib/connectors/probes';
import { needsResync, sortReports, type ConnectorReport } from '$lib/connectors/types';

const STATUSES = ['ok', 'degraded', 'broken', 'unconfigured'] as const;
const failed = (name: string, err: unknown) => ({ success: false as const, error: `${name} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) });

/** One connection as a reply needs it. PURE. */
export function connectorRow(r: ConnectorReport) {
  return {
    key: r.key,
    label: r.label,
    group: r.group,
    tier: r.tier,
    status: r.status,
    detail: r.detail.slice(0, 300),
    ...(r.impact ? { impact: r.impact.slice(0, 200) } : {}),
    ...(r.lastOkAt ? { lastOkAt: r.lastOkAt } : {}),
    ...(r.fixUrl ? { fixUrl: r.fixUrl } : {}),
    ...(r.fixHint ? { fixHint: r.fixHint.slice(0, 200) } : {}),
  };
}

register({
  name: 'estate_status',
  description:
    'The state of the machines and services the site runs on (/admin/estate): each host with its state, the reason, anything of concern (memory, disk, load, temperature) and which of its services are up or down, plus every probed service that is not answering. For "is everything up", "what is down". Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Estate',
  toolset: 'estate',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (_args, ctx) => {
    const refused = refuseUnlessOwner('estate_status', ctx);
    if (refused) return refused;
    try {
      const health = await probeEstate();
      const hosts = (await readHostCards(health)).map((h) => ({
        id: h.id,
        label: h.label,
        role: h.role,
        state: h.state,
        reason: h.reason,
        concerns: h.concerns,
        services: h.services,
        ...(h.vitals ? { memoryUsedPct: h.vitals.mem?.usedPct ?? null, diskUsedPct: h.vitals.disk?.usedPct ?? null, load: h.vitals.load?.[0] ?? null } : {}),
      }));
      const probes = Object.entries(health);
      return {
        success: true,
        data: {
          hosts,
          probes: { up: probes.filter(([, s]) => s === 'up').length, total: probes.length },
          down: probes.filter(([, s]) => s === 'down').map(([id]) => id),
          unknown: probes.filter(([, s]) => s !== 'up' && s !== 'down').map(([id]) => id),
          url: '/admin/estate',
        },
      };
    } catch (err) {
      return failed('estate_status', err);
    }
  },
});

register({
  name: 'connector_status',
  description:
    'Every connection the site depends on (/admin/connections), probed live: mail, calendar, health, bank and home accounts and the services behind them, each with its status (ok, degraded, broken, unconfigured), what the probe saw, what stops working while it is broken and where to fix it. For "is my mail still connected", "what needs reconnecting". Worst first. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...STATUSES], description: 'Optional: only connections in this state.' },
      attention_only: { type: 'boolean', description: 'Only the accounts that need John to do something. Default false.' },
    },
    required: [],
  },
  category: 'Estate',
  toolset: 'estate',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('connector_status', ctx);
    if (refused) return refused;
    try {
      const reports = sortReports(await probeAll());
      const counts = Object.fromEntries(STATUSES.map((s) => [s, reports.filter((r) => r.status === s).length]));
      const attention = needsResync(reports);
      const wanted = (STATUSES as readonly string[]).includes(args.status as string) ? (args.status as string) : null;
      const shown = (args.attention_only === true ? attention : reports).filter((r) => !wanted || r.status === wanted);
      return {
        success: true,
        data: { counts, needsYou: attention.length, connections: shown.slice(0, 60).map(connectorRow), url: '/admin/connections' },
      };
    } catch (err) {
      return failed('connector_status', err);
    }
  },
});

register({
  name: 'connector_resync',
  description:
    'Pull from a connection right now instead of waiting for its schedule, as the Resync button on /admin/connections does. Only the health band (service "whoop") can be resynced this way: one incremental pull, not a backfill. Says how many records came in.',
  parameters: {
    type: 'object',
    properties: { service: { type: 'string', enum: ['whoop'], description: 'Which connection to pull from.' } },
    required: ['service'],
  },
  category: 'Estate',
  toolset: 'estate',
  effect: 'mutate',
  confirm: 'light',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('connector_resync', ctx);
    if (refused) return refused;
    if (args.service !== 'whoop') return { success: false, error: 'service must be "whoop": the only connection with a resync.' };
    try {
      const { syncWhoop } = await import('$lib/server/health-service');
      const result = await syncWhoop();
      if (!result.success) return { success: false, error: (result.errors[0] ?? 'The sync failed; see /admin/connections/health for the job log.').slice(0, 300) };
      return { success: true, data: { service: 'whoop', recordsSynced: result.recordsSynced, url: '/admin/connections' } };
    } catch (err) {
      return failed('connector_resync', err);
    }
  },
});

register({
  name: 'connector_test',
  description:
    'Prove one of John\'s mail accounts can still read mail, not just refresh its token, as the Test button on /admin/connections does: it lists a few messages from the last day and says how many it could read. Takes the connection key from connector_status (gmail:<number>). Other connections are tested on the page.',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string', description: 'The connection key from connector_status, e.g. gmail:1.' } },
    required: ['key'],
  },
  category: 'Estate',
  toolset: 'estate',
  effect: 'mutate',
  confirm: 'light',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('connector_test', ctx);
    if (refused) return refused;
    const key = typeof args.key === 'string' ? args.key.trim() : '';
    const match = /^gmail:(\d{1,9})$/.exec(key);
    if (!match) return { success: false, error: 'key must be a mail connection from connector_status, like gmail:1. Other connections are tested on /admin/connections.' };
    try {
      const { db } = await import('$lib/db');
      const { gmailAccounts } = await import('$lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const { ownerGmailWhere } = await import('$lib/integrations/gmail/owner-accounts');
      const [acct] = await db.select().from(gmailAccounts).where(ownerGmailWhere(eq(gmailAccounts.id, Number(match[1])))).limit(1);
      if (!acct) return { success: false, error: 'No such mail account.' };
      const { gmailService } = await import('$lib/integrations/gmail/service');
      const ids = await gmailService.listMessages(acct, 'newer_than:1d', 5);
      return { success: true, data: { key, ok: true, read: ids.length, message: `Read ${ids.length} message${ids.length === 1 ? '' : 's'} from the last day.` } };
    } catch (err) {
      return failed('connector_test', err);
    }
  },
});

// Daily connector check → WhatsApp when something is broken.
//
// A dashboard nobody opens is how Gmail sat `auth_expired` for days while the
// briefing quietly invented an inbox. The alert is the part that actually
// closes the loop; the page is for fixing, not for noticing.
//
// Mirrors the briefing/self-improve engine shape: prod-only cron, kill switch
// re-checked in the callback, never throws into croner.
import { ownerPhone } from '$lib/config/owner';
import { Cron } from 'croner';
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { probeAll } from './probes';
import { brokenOf, sortReports, type ConnectorReport } from './types';

export const CRON_EXPR = '45 6 * * *'; // 06:45 — before the 07:00 briefing
export const CRON_TZ = 'Europe/London';
export const SETTINGS_ENABLED_KEY = 'connectors.monitor.enabled';
const DASHBOARD = 'https://strangeramblings.com/admin/connections';

let cronJob: Cron | null = null;
let started = false;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The alert body. Only broken connectors are worth a message — `degraded` shows
 * on the dashboard but does not wake anyone, or the alert becomes noise and
 * gets ignored, which is the failure mode this whole feature exists to fix.
 */
export function buildAlert(reports: ConnectorReport[]): string | null {
  const broken = brokenOf(reports);
  if (!broken.length) return null;
  const lines = [`⚠ ${broken.length} connector${broken.length === 1 ? '' : 's'} down`, ''];
  for (const r of sortReports(broken)) {
    lines.push(`• ${r.label}: ${r.detail}`);
    if (r.fixHint) lines.push(`  → ${r.fixHint}`);
  }
  lines.push('', DASHBOARD);
  return lines.join('\n');
}

export async function runConnectorCheck(): Promise<{ reports: ConnectorReport[]; alerted: boolean }> {
  const reports = await probeAll();
  const message = buildAlert(reports);
  if (!message) return { reports, alerted: false };

  try {
    const to = ownerPhone();
    if (!to) throw new Error('WORKFLOW_NOTIFY_PHONE is not set');
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    await executeTool('whatsapp_send', { to, message });
    return { reports, alerted: true };
  } catch (err) {
    // If WhatsApp itself is the broken connector this is expected — the
    // dashboard still tells the story next time it is opened.
    console.error('[connectors] alert send failed:', errMsg(err));
    return { reports, alerted: false };
  }
}

export function startConnectorMonitor(): void {
  if (started) return;
  started = true;

  const host = os.hostname();
  if (host === 'homeserv' && process.env.CONNECTOR_MONITOR_ALLOW_DEV !== '1') {
    console.log('[connectors] host is homeserv — daily check disabled. Set CONNECTOR_MONITOR_ALLOW_DEV=1 to enable locally.');
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void (async () => {
        try {
          if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) return;
          const { reports, alerted } = await runConnectorCheck();
          const broken = brokenOf(reports).length;
          console.log(`[connectors] daily check: ${reports.length} probed, ${broken} broken, alerted=${alerted}`);
        } catch (err) {
          console.error('[connectors] daily check failed:', errMsg(err));
        }
      })();
    });
    console.log(`[connectors] daily check scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[connectors] failed to schedule:', errMsg(err));
  }
}

export function stopConnectorMonitor(): void {
  cronJob?.stop();
  cronJob = null;
  started = false;
}

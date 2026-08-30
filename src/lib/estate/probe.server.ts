// Live reachability for the estate catalogue. Server-side only.
//
// Same doctrine as $lib/architecture/health.ts: every check is best-effort with
// a short timeout, and a failure is a status, never a thrown page load. An
// admin page that 500s during an incident is worse than one that says
// "unknown".
//
// Two probe strategies, because one is not enough:
//   http — a request; <500 means the service answered, including a 302 to its
//          own login page, which is what a healthy AdGuard looks like.
//   tcp  — a bare socket connect. Used for Portainer, which serves HTTPS with a
//          self-signed certificate that fetch() correctly refuses. Rather than
//          disabling TLS verification process-wide to make a dashboard tile
//          green, this proves the port is listening and says only that.
import net from 'node:net';
import os from 'node:os';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { isAzureStorageEnabled, azExists } from '$lib/storage/azure-blob';
import { TAILNET } from './endpoints';
import type { HealthStatus } from '$lib/architecture/topology';

const TIMEOUT = 2500;

async function httpProbe(url: string): Promise<HealthStatus> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return res.status < 500 ? 'up' : 'degraded';
  } catch {
    return 'down';
  }
}

function tcpProbe(host: string, port: number): Promise<HealthStatus> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (s: HealthStatus) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(s);
    };
    sock.setTimeout(TIMEOUT);
    sock.once('connect', () => done('up'));
    sock.once('timeout', () => done('down'));
    sock.once('error', () => done('down'));
    sock.connect(port, host);
  });
}

async function checkDb(): Promise<HealthStatus> {
  try {
    await db.execute(sql`select 1`);
    return 'up';
  } catch {
    return 'down';
  }
}

async function checkAzure(): Promise<HealthStatus> {
  if (!isAzureStorageEnabled()) return 'unknown';
  try {
    await azExists(process.env.AZURE_BLOB_CONTAINER || 'drive', '.estate-healthcheck');
    return 'up';
  } catch {
    return 'down';
  }
}

/** Keyed by EstateEndpoint.probeId. */
export async function probeEstate(): Promise<Record<string, HealthStatus>> {
  const homeservBase = (process.env.SCRAPER_SERVICE_URL || `http://${TAILNET.homeserv}:5173/`).replace(/\/+$/, '');
  // The VPS calls itself strangeserv on the tailnet; the systemd unit runs there.
  const onVps = os.hostname() !== 'homeserv';

  const checks: Array<[string, Promise<HealthStatus>]> = [
    ['site', httpProbe('https://strangeramblings.com/')],
    ['site-vitals', httpProbe('https://strangeramblings.com/api/landing/vitals')],
    ['docs', httpProbe('https://docs.strangeramblings.com/')],
    ['library', httpProbe('https://library.strangeramblings.com/')],
    ['database', checkDb()],
    ['azure', checkAzure()],
    ['homeserv', httpProbe(`${homeservBase}/`)],
    ['home-assistant', httpProbe('http://homeserv.tail668b8c.ts.net:8123/')],
    ['adguard', httpProbe(`http://${TAILNET.porkserv}:8080/`)],
    // Self-signed TLS — see the header note.
    ['portainer', tcpProbe(TAILNET.porkserv, 9443)],
    // The resolver itself, not its admin UI. A healthy :8080 says nothing about
    // whether the LAN can still resolve a name, and that is the failure with the
    // bigger blast radius. TCP :53 rather than a real query: node has no DNS
    // primitive that targets one server without reconfiguring the process
    // resolver, and a listening socket is the honest limit of what this proves.
    ['adguard-dns', tcpProbe(TAILNET.porkserv, 53)],
    // The host vitals agents. Probed like any other service so that "the thing
    // that watches the boxes" cannot itself fail unwatched.
    ['homeserv-vitals', httpProbe(`http://${TAILNET.homeserv}:9101/vitals`)],
    ['porkserv-vitals', httpProbe(`http://${TAILNET.porkserv}:9101/vitals`)],
    // ttyd, and sshd on both boxes. sshd is the last thing to stop answering on
    // a machine that is still alive at all, so a host with everything else dark
    // but :22 open is a service problem; one with :22 dark too is a box problem.
    ['ttyd', httpProbe('http://homeserv.tail668b8c.ts.net:3010/')],
    ['homeserv-ssh', tcpProbe(TAILNET.homeserv, 22)],
    ['porkserv-ssh', tcpProbe(TAILNET.porkserv, 22)],
    // Loopback on the VPS ONLY. Probing 127.0.0.1:3110 from anywhere else can
    // never succeed, so it would paint a permanently-red tile for a service
    // that is fine — the same false-alarm shape as the old gateway probe that read
    // "down" for months because it was asking the wrong path.
    ['whatsapp-bridge', onVps ? tcpProbe('127.0.0.1', 3110) : Promise.resolve<HealthStatus>('unknown')],
    ['openrouter', httpProbe('https://openrouter.ai/api/v1/models')],
  ];

  const results = await Promise.all(checks.map(([, p]) => p));
  return Object.fromEntries(checks.map(([k], i) => [k, results[i]]));
}

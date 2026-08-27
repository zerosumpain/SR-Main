import { whatsappBridgeUrl } from '$lib/config/whatsapp-bridge';
// Live status probe for the architecture map. Server-side only. Each check is
// best-effort with a short timeout; unreachable → 'down', not-applicable → 'unknown'.
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { isAzureStorageEnabled, azExists } from '$lib/storage/azure-blob';
import type { HealthStatus } from './topology';

const TIMEOUT = 2500;

async function pingUrl(url: string | undefined): Promise<HealthStatus> {
  if (!url) return 'unknown';
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    return res.status < 500 ? 'up' : 'degraded';
  } catch {
    return 'down';
  }
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
    // exists() on a nonexistent blob returns false but still proves auth + reachability.
    await azExists(process.env.AZURE_BLOB_CONTAINER || 'drive', '.arch-healthcheck');
    return 'up';
  } catch {
    return 'down';
  }
}

export async function probeArchitecture(): Promise<Record<string, HealthStatus>> {
  const homeservUrl = process.env.SCRAPER_SERVICE_URL || 'http://homeserv.tail668b8c.ts.net:5173/';
  const waUrl = whatsappBridgeUrl();

  const [database, azure, homeserv, whatsapp] = await Promise.all([
    checkDb(),
    checkAzure(),
    pingUrl(homeservUrl),
    // The worker answers /health even while LOGGED OUT, so this tile says
    // "the process is up", not "WhatsApp is paired" — /admin/connections/whatsapp
    // reads the session state itself.
    pingUrl(waUrl ? `${waUrl}/health` : undefined),
  ]);

  // If this handler is answering, the app + the Cloudflare tunnel in front are up.
  return { site: 'up', 'workflow-engine': 'up', database, azure, homeserv, whatsapp };
}

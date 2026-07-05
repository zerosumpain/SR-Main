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
  const hermesUrl = process.env.HERMES_PLATFORM_URL;

  const [database, azure, homeserv, hermes] = await Promise.all([
    checkDb(),
    checkAzure(),
    pingUrl(homeservUrl),
    pingUrl(hermesUrl ? `${hermesUrl.replace(/\/+$/, '')}/health` : undefined),
  ]);

  // If this handler is answering, the app + the Cloudflare tunnel in front are up.
  return { site: 'up', 'workflow-engine': 'up', database, azure, homeserv, hermes };
}

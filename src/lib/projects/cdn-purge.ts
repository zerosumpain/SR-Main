import { env } from '$env/dynamic/private';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';
import { getPublishedDir } from '$lib/jkai/sandbox';

const ORIGIN = 'https://strangeramblings.com';
const PURGE_BATCH = 30; // Cloudflare non-Enterprise caps purge-by-URL at 30 per call

/**
 * Build the absolute prod URLs to purge for a project: the directory root plus
 * every bundle file. Pure — paths are normalised (backslashes, leading slashes)
 * and de-duplicated, root first.
 */
export function buildPurgeUrls(key: string, relFiles: string[]): string[] {
  const base = `${ORIGIN}/projects/${key}/`;
  const urls: string[] = [base];
  const seen = new Set<string>([base]);
  for (const rel of relFiles) {
    const clean = rel.split(/[\\/]+/).filter(Boolean).join('/');
    if (!clean) continue;
    const url = base + clean;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Purge a project's cached assets from Cloudflare so a toggle-to-private takes
 * effect at the edge immediately (the origin already 404s; this clears the
 * stale-public edge copies). Best-effort and never throws:
 *  - no-op when CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID are unset (e.g. dev);
 *  - no-op for SSR route-projects (no on-disk bundle; their HTML isn't edge-cached).
 */
export async function purgeProjectCdn(key: string): Promise<{ purged: number }> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const zone = env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return { purged: 0 };

  let relFiles: string[];
  try {
    const dir = join(getPublishedDir(), key);
    const files = await listFilesRecursive(dir);
    relFiles = files.map((f) => relative(dir, f));
  } catch {
    return { purged: 0 }; // route-project / no bundle dir
  }

  const urls = buildPurgeUrls(key, relFiles);
  let purged = 0;
  for (const batch of chunk(urls, PURGE_BATCH)) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: batch }),
      });
      if (res.ok) purged += batch.length;
      else console.error('[cdn-purge] Cloudflare purge failed', res.status, await res.text().catch(() => ''));
    } catch (err) {
      console.error('[cdn-purge] Cloudflare purge error', err);
    }
  }
  return { purged };
}

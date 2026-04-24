/**
 * GET  /api/scraper/playbook?url=<url>|domain=<domain>
 *   → { domain, playbook, playbookUpdatedAt } or { domain, playbook: null }
 *
 * DELETE /api/scraper/playbook?url=<url>|domain=<domain>
 *   → { cleared: true }
 *
 * Drives the stealth-scrape panel's "Playbook status" section: users can see
 * whether a playbook exists for a given site, view its JSON, and clear it
 * to force a fresh auto-mapping on the next run.
 */
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { scraperTargetKnowledge } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeDomain } from '$lib/workflows/scraper/target-knowledge';

function resolveDomain(url: URL): string {
  const direct = url.searchParams.get('domain');
  if (direct) return normalizeDomain(direct);
  const target = url.searchParams.get('url');
  if (!target) throw error(400, 'url or domain query param required');
  try {
    return normalizeDomain(target);
  } catch {
    throw error(400, `could not extract domain from "${target}"`);
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const domain = resolveDomain(url);
  const [row] = await db
    .select({
      domain: scraperTargetKnowledge.domain,
      playbook: scraperTargetKnowledge.playbook,
      playbookUpdatedAt: scraperTargetKnowledge.playbookUpdatedAt,
    })
    .from(scraperTargetKnowledge)
    .where(eq(scraperTargetKnowledge.domain, domain));
  if (!row) return json({ domain, playbook: null, playbookUpdatedAt: null });
  return json(row);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const domain = resolveDomain(url);
  await db
    .update(scraperTargetKnowledge)
    .set({ playbook: null, playbookUpdatedAt: null, updatedAt: new Date() })
    .where(eq(scraperTargetKnowledge.domain, domain));
  return json({ domain, cleared: true });
};

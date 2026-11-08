import { db } from '$lib/db';
import { scraperTargetKnowledge, type ScraperTargetKnowledge } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

/** Lower-case, strip 'www.' */
export function normalizeDomain(raw: string): string {
  try {
    const u = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? raw;
  }
}

export async function lookupByDomains(domains: string[]): Promise<ScraperTargetKnowledge[]> {
  const normalized = Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
  if (!normalized.length) return [];
  return db.select().from(scraperTargetKnowledge).where(inArray(scraperTargetKnowledge.domain, normalized));
}

export async function upsertKnowledge(input: {
  domain: string;
  requiresInteractive?: boolean;
  interactiveHint?: string;
  knownSelectors?: Record<string, unknown>;
  notes?: string;
  source?: 'manual' | 'auto-captcha-detected' | 'auto-failure';
}): Promise<ScraperTargetKnowledge> {
  const domain = normalizeDomain(input.domain);
  const now = new Date();
  const [row] = await db.insert(scraperTargetKnowledge).values({
    domain,
    requiresInteractive: input.requiresInteractive ?? false,
    interactiveHint: input.interactiveHint,
    knownSelectors: input.knownSelectors,
    notes: input.notes,
    source: input.source ?? 'manual',
    lastVerifiedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: scraperTargetKnowledge.domain,
    set: {
      requiresInteractive: input.requiresInteractive ?? false,
      interactiveHint: input.interactiveHint,
      knownSelectors: input.knownSelectors,
      notes: input.notes,
      source: input.source ?? 'manual',
      updatedAt: now,
    },
  }).returning();
  return row;
}

export async function deleteKnowledge(id: number): Promise<void> {
  await db.delete(scraperTargetKnowledge).where(eq(scraperTargetKnowledge.id, id));
}

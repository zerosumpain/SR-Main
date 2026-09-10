import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyAnalyses, policyShares, policyStages } from '$lib/db/schema';
import { loadArtefacts, ownedAnalysis } from './store';
import { shareableReport, type SharedReport } from '../share';
import { PolicyError } from '../validation';

/**
 * Share links for one assessment — the policy twin of `$lib/decks/shares`.
 *
 * The raw token is generated once and never persisted; only its SHA-256 is
 * stored, so a database dump yields no working URLs. Unknown, revoked and
 * expired all resolve to `null` and the route turns every one of them into the
 * same 404, so probing a token learns nothing about whether it ever existed.
 */

/** 32 random bytes, base64url — about 43 unguessable URL-safe characters. */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A link cannot be minted without a lifetime; this is the default one. */
export const SHARE_TTL_DAYS = 30;
export const SHARE_MAX_TTL_DAYS = 365;
/** Enough to hand a paper round a working group, not enough to be a broadcast. */
const MAX_ACTIVE = 20;

export type ShareRow = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  live: boolean;
};

const row = (s: typeof policyShares.$inferSelect): ShareRow => ({
  id: s.id, label: s.label,
  createdAt: s.createdAt.toISOString(),
  expiresAt: s.expiresAt.toISOString(),
  revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
  lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
  useCount: s.useCount,
  live: !s.revokedAt && s.expiresAt.getTime() > Date.now(),
});

export async function listShares(owner: string, analysisId: string): Promise<ShareRow[] | null> {
  if (!(await ownedAnalysis(owner, analysisId))) return null;
  const rows = await db.select().from(policyShares).where(eq(policyShares.analysisId, analysisId)).orderBy(asc(policyShares.createdAt));
  return rows.map(row);
}

export async function createShare(owner: string, analysisId: string, input: { label?: string | null; expiresInDays?: number | null }): Promise<{ id: string; token: string; expiresAt: string }> {
  const analysis = await ownedAnalysis(owner, analysisId);
  if (!analysis) throw new PolicyError('missing', 'Analysis not found.');
  // A run that has not written its report has nothing to share, and a link
  // minted now would be a promise about work that may still fail.
  if (!['completed', 'completed_with_gaps'].includes(analysis.status)) {
    throw new PolicyError('state', 'This assessment has not finished. A link can be created once it has produced its report.');
  }
  const existing = (await db.select().from(policyShares).where(eq(policyShares.analysisId, analysisId))).map(row);
  if (existing.filter((s) => s.live).length >= MAX_ACTIVE) {
    throw new PolicyError('capacity', `There are already ${MAX_ACTIVE} live links for this assessment. Revoke one before creating another.`);
  }
  const days = Math.min(SHARE_MAX_TTL_DAYS, Math.max(1, Math.round(Number(input.expiresInDays) || SHARE_TTL_DAYS)));
  const token = generateShareToken();
  const [created] = await db.insert(policyShares).values({
    analysisId, tokenHash: hashShareToken(token),
    label: input.label?.trim().slice(0, 80) || null,
    createdBy: owner,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  }).returning();
  return { id: created.id, token, expiresAt: created.expiresAt.toISOString() };
}

export async function revokeShare(owner: string, analysisId: string, shareId: string): Promise<boolean> {
  if (!(await ownedAnalysis(owner, analysisId))) return false;
  const result = await db.update(policyShares).set({ revokedAt: new Date() })
    .where(and(eq(policyShares.id, shareId), eq(policyShares.analysisId, analysisId)))
    .returning({ id: policyShares.id });
  return result.length > 0;
}

export type SharedAssessment = SharedReport & {
  title: string;
  jurisdiction: string | null;
  policyArea: string | null;
  status: string;
  completedAt: string | null;
  sharedLabel: string | null;
  expiresAt: string;
};

/**
 * Resolve a raw token to the shareable copy of its assessment, or null.
 *
 * `null` covers unknown, revoked, expired and deleted alike — the caller must
 * answer all four with the same 404. The use counter is bumped without awaiting
 * it, so a slow write cannot stall a reader's page.
 */
export async function resolveShare(rawToken: string): Promise<SharedAssessment | null> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 200) return null;
  const [share] = await db.select().from(policyShares).where(eq(policyShares.tokenHash, hashShareToken(rawToken))).limit(1);
  if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) return null;
  const [analysis] = await db.select().from(policyAnalyses).where(eq(policyAnalyses.id, share.analysisId)).limit(1);
  if (!analysis || !['completed', 'completed_with_gaps'].includes(analysis.status)) return null;

  const stages = await db.select({ ordinal: policyStages.ordinal, name: policyStages.name, warnings: policyStages.warnings })
    .from(policyStages).where(eq(policyStages.analysisId, share.analysisId)).orderBy(asc(policyStages.ordinal));
  const report = shareableReport({ artefacts: await loadArtefacts(share.analysisId), stages });

  void db.update(policyShares)
    .set({ lastUsedAt: new Date(), useCount: sql`${policyShares.useCount} + 1` })
    .where(eq(policyShares.id, share.id))
    .catch(() => {});

  return {
    ...report,
    title: analysis.title,
    jurisdiction: analysis.jurisdiction,
    policyArea: analysis.policyArea,
    status: analysis.status,
    completedAt: analysis.completedAt ? analysis.completedAt.toISOString() : null,
    sharedLabel: share.label,
    expiresAt: share.expiresAt.toISOString(),
  };
}

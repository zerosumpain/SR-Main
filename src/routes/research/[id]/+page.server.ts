import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { depthPreset, coerceDepth } from '$lib/deepdive/depth';
import { coerceScope, describeScope } from '$lib/deepdive/scope';
import { loadFrontier } from '$lib/deepdive/frontier';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw redirect(302, '/research');

  const srcs = await db
    .select({
      id: sources.id,
      url: sources.url,
      title: sources.title,
      domain: sources.domain,
      credibilityScore: sources.credibilityScore,
      credibilityType: sources.credibilityType,
    })
    .from(sources)
    .where(eq(sources.sessionId, params.id))
    .orderBy(desc(sources.credibilityScore))
    .limit(50);

  const leads = await loadFrontier(params.id);
  const depth = coerceDepth(session.depth);
  const preset = depthPreset(depth);
  const report = session.report as { executive_summary?: string } | null;

  return {
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      depth,
      goals: Array.isArray(session.goals) ? (session.goals as string[]) : [],
      summary: report?.executive_summary ?? '',
      durationMs: session.durationMs,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt.toISOString(),
      scopeLabel: describeScope(coerceScope(session.scope)),
    },
    tier: { label: preset.label, budgetMs: preset.budgetMs, extractsFacts: preset.extractsFacts },
    sources: srcs,
    leads: leads.map((l) => ({
      id: l.id,
      query: l.query,
      parentId: l.parentId,
      depth: l.depth,
      origin: l.origin,
      originDetail: l.originDetail,
      status: l.status,
      reason: l.reason,
      score: l.score,
    })),
  };
};

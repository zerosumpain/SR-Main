// Gather the raw material for a briefing: learned question intents (the
// personalisation core), recent research, what you've been asking, and live
// site signals. All best-effort — a missing source contributes nothing.
import { db } from '$lib/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { researchSessions, orchestratorChats } from '$lib/db/schema';
import { getRecordByKey, DatastoreError } from '$lib/datastore';

export interface BriefingSignals {
  insights: { intents: Array<{ intent: string; count: number; missingCapability?: string }>; topUnmet: string[] } | null;
  recentResearch: Array<{ topic: string; status: string; createdAt: string }>;
  recentQuestions: string[];
  siteSignals: Record<string, unknown>;
  gathered: string[]; // which sources actually produced data
}

export async function gatherBriefingSignals(): Promise<BriefingSignals> {
  const gathered: string[] = [];

  // Learned question intents + unmet needs (written by the self-improve LEARN phase).
  let insights: BriefingSignals['insights'] = null;
  try {
    const rec = await getRecordByKey('question_insights', 'latest', 'owner');
    const d = rec.data as { intents?: Array<{ intent: string; count: number; missingCapability?: string }>; topUnmet?: string[] };
    insights = {
      intents: Array.isArray(d.intents) ? d.intents.slice(0, 8) : [],
      topUnmet: Array.isArray(d.topUnmet) ? d.topUnmet : [],
    };
    gathered.push('question-insights');
  } catch (err) {
    if (!(err instanceof DatastoreError && err.code === 'not_found')) {
      console.error('[briefing] insights gather failed:', err instanceof Error ? err.message : err);
    }
  }

  // Recent deep-dive research.
  let recentResearch: BriefingSignals['recentResearch'] = [];
  try {
    const rows = await db
      .select({ topic: researchSessions.topic, status: researchSessions.status, createdAt: researchSessions.createdAt })
      .from(researchSessions)
      .orderBy(desc(researchSessions.createdAt))
      .limit(5);
    recentResearch = rows.map((r) => ({ topic: r.topic, status: r.status, createdAt: r.createdAt?.toISOString() ?? '' }));
    if (recentResearch.length) gathered.push('research');
  } catch (err) {
    console.error('[briefing] research gather failed:', err instanceof Error ? err.message : err);
  }

  // What you've been asking (last 24h).
  let recentQuestions: string[] = [];
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await db
      .select({ content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.role, 'user'), gte(orchestratorChats.createdAt, since)))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(30);
    recentQuestions = rows.map((r) => (r.content || '').slice(0, 200)).filter(Boolean);
    if (recentQuestions.length) gathered.push('recent-questions');
  } catch (err) {
    console.error('[briefing] questions gather failed:', err instanceof Error ? err.message : err);
  }

  // Live site signals (best-effort — walk/presence live on homeserv only).
  let siteSignals: Record<string, unknown> = {};
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const [walk, presence] = await Promise.all([
      executeTool('live_walk_status', {}).catch(() => null),
      executeTool('family_presence_current', {}).catch(() => null),
    ]);
    siteSignals = { walk: walk?.data ?? null, presence: presence?.data ?? null };
    if (walk?.data || presence?.data) gathered.push('site-signals');
  } catch {
    /* signals are optional */
  }

  return { insights, recentResearch, recentQuestions, siteSignals, gathered };
}

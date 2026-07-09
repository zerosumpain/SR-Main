import type { PageServerLoad } from './$types';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { claudeSessions, claudeSessionStages } from '$lib/db/schema';

const PAGE_SIZE = 40;

type TermEntry = { term: string; count: number };

export const load: PageServerLoad = async ({ url }) => {
  const project = url.searchParams.get('project') || 'all';
  const stage = url.searchParams.get('stage') || 'all';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);

  const filters = [];
  if (project !== 'all') filters.push(eq(claudeSessions.project, project));
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(claudeSessions.title, like), ilike(claudeSessions.firstPrompt, like)));
  }
  // Stage filter applied in SQL (not just client-side) so the aggregates, the
  // paginated session set, and hasMore all reflect it. The card still trims to the
  // selected stage's segments client-side in +page.svelte.
  if (stage !== 'all') {
    filters.push(
      sql`exists (select 1 from claude_session_stages cs where cs.session_id = ${claudeSessions.id} and cs.stage = ${stage})`,
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  // ── lightweight aggregate rows over the whole (filtered) set ──
  const agg = await db
    .select({
      id: claudeSessions.id,
      project: claudeSessions.project,
      startedAt: claudeSessions.startedAt,
      estCostUsd: claudeSessions.estCostUsd,
      costKnown: claudeSessions.costKnown,
      tokens: claudeSessions.tokens,
      featureTypes: claudeSessions.featureTypes,
      termFreq: claudeSessions.termFreq,
    })
    .from(claudeSessions)
    .where(where);

  // project distribution (over ALL sessions, ignoring the project filter, for the selector)
  const projRows = await db
    .select({ project: claudeSessions.project, n: sql<number>`count(*)::int` })
    .from(claudeSessions)
    .groupBy(claudeSessions.project)
    .orderBy(sql`count(*) desc`);
  const projects = projRows.map((r) => ({ project: r.project, count: r.n }));

  // aggregate metrics
  let totalCost = 0;
  let costKnownAll = true;
  let totalOutput = 0;
  const featureCounts: Record<string, number> = {};
  const termTotals: Record<string, number> = {};
  const byWeek: Record<string, { cost: number; sessions: number }> = {};
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of agg) {
    const cost = r.estCostUsd != null ? Number(r.estCostUsd) : 0;
    totalCost += cost;
    if (r.costKnown === false) costKnownAll = false;
    const tok = (r.tokens as { output?: number }) || {};
    totalOutput += tok.output || 0;
    for (const f of (r.featureTypes as string[]) || []) featureCounts[f] = (featureCounts[f] || 0) + 1;
    for (const t of (r.termFreq as TermEntry[]) || []) termTotals[t.term] = (termTotals[t.term] || 0) + t.count;
    if (r.startedAt) {
      const iso = new Date(r.startedAt).toISOString().slice(0, 10);
      if (minDate === null || iso < minDate) minDate = iso;
      if (maxDate === null || iso > maxDate) maxDate = iso;
      const wk = weekKey(new Date(r.startedAt));
      byWeek[wk] ??= { cost: 0, sessions: 0 };
      byWeek[wk].cost += cost;
      byWeek[wk].sessions += 1;
    }
  }

  const featureDist = Object.entries(featureCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
  const topTerms = Object.entries(termTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([term, count]) => ({ term, count }));
  const costSeries = Object.entries(byWeek)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({ week, cost: Number(v.cost.toFixed(2)), sessions: v.sessions }));

  // ── the current page of sessions (full rows) ──
  const sessions = await db
    .select()
    .from(claudeSessions)
    .where(where)
    .orderBy(desc(claudeSessions.startedAt))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const ids = sessions.map((s) => s.id);
  const stageRows = ids.length
    ? await db
        .select()
        .from(claudeSessionStages)
        .where(inArray(claudeSessionStages.sessionId, ids))
        .orderBy(claudeSessionStages.sessionId, claudeSessionStages.ordinal)
    : [];
  const stagesBySession: Record<string, typeof stageRows> = {};
  for (const st of stageRows) (stagesBySession[st.sessionId] ??= []).push(st);

  const items = sessions.map((s) => ({
    ...s,
    estCostUsd: s.estCostUsd != null ? Number(s.estCostUsd) : null,
    stages: (stagesBySession[s.id] || []).map((st) => ({
      ...st,
      costUsd: st.costUsd != null ? Number(st.costUsd) : 0,
      // trim very large plan bodies for transport; the vast majority are small
      rawText: st.rawText && st.rawText.length > 14000 ? st.rawText.slice(0, 14000) + '\n…[truncated]' : st.rawText,
    })),
  }));

  return {
    filters: { project, stage, q, page },
    totals: {
      sessions: agg.length,
      totalCost: Number(totalCost.toFixed(2)),
      costKnown: costKnownAll,
      totalOutput,
      minDate,
      maxDate,
      projectCount: projects.length,
    },
    projects,
    featureDist,
    topTerms,
    costSeries,
    items,
    hasMore: sessions.length === PAGE_SIZE,
  };
};

function weekKey(d: Date): string {
  // ISO-ish year-week bucket for the cost timeline
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

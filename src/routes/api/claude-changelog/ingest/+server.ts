// POST /api/claude-changelog/ingest — receive a parsed Claude Code session (from
// the homeserv scanner scripts/claude-changelog/ingest.mjs) and upsert it into
// claude_sessions + claude_session_stages. homeserv's DATABASE_URL is a local dev
// DB, so ingestion must go through this VPS endpoint (see the spec).
//
// Auth: if CLAUDE_CHANGELOG_SECRET is set, a matching Bearer token is required
// (mirrors /api/policy-engine/ingest). The route is exempted from Auth.js in
// hooks.server.ts. Idempotent: skips re-ingest when contentHash + schemaVersion
// are unchanged unless ?force=1.
//
// GET → summary stats (owner-gated via the normal /api gate; used for debugging).
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { claudeSessions, claudeSessionStages } from '$lib/db/schema';
import type { RequestHandler } from './$types';

function authorized(request: Request): boolean {
  const secret = env.CLAUDE_CHANGELOG_SECRET;
  if (!secret) return true; // unset → open (dev convenience), same as policy-engine
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

const STAGES = new Set(['request', 'design', 'plan', 'result', 'fixes']);

type StageIn = {
  stage: string; ordinal: number; title?: string; summary?: string; rawText?: string;
  startedAt?: string | null; endedAt?: string | null; tokens?: unknown; costUsd?: number;
  messageCount?: number; toolCalls?: number; metadata?: unknown;
};
type SessionIn = {
  id: string; project?: string; title?: string; firstPrompt?: string; cwd?: string;
  gitBranch?: string; startedAt?: string | null; endedAt?: string | null; status?: string;
  messageCount?: number; userMsgCount?: number; assistantMsgCount?: number; toolCallCount?: number;
  models?: unknown; tokens?: unknown; estCostUsd?: number; costKnown?: boolean;
  featureTypes?: unknown; termFreq?: unknown; toolHistogram?: unknown; touchedPaths?: unknown;
  skills?: unknown; costBreakdown?: unknown; fullTranscript?: string;
  summary?: string; transcriptPath?: string; contentHash?: string;
  fileMtime?: string | null; fileSize?: number; schemaVersion?: number;
};

function ts(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const body = (await request.json().catch(() => null)) as { session?: SessionIn; stages?: StageIn[] } | null;
  const s = body?.session;
  const stages = Array.isArray(body?.stages) ? body!.stages! : [];
  if (!s || !s.id) throw error(400, 'missing session.id');

  const force = url.searchParams.get('force') === '1';

  // Skip unchanged (same content + parser version) unless forced.
  if (!force && s.contentHash) {
    const existing = await db
      .select({ hash: claudeSessions.contentHash, ver: claudeSessions.schemaVersion })
      .from(claudeSessions)
      .where(eq(claudeSessions.id, s.id))
      .limit(1);
    if (existing[0] && existing[0].hash === s.contentHash && existing[0].ver === (s.schemaVersion ?? 1)) {
      return json({ ok: true, id: s.id, skipped: 'unchanged' });
    }
  }

  const row = {
    id: s.id,
    project: s.project ?? 'unknown',
    title: s.title ?? null,
    firstPrompt: s.firstPrompt ?? null,
    cwd: s.cwd ?? null,
    gitBranch: s.gitBranch ?? null,
    startedAt: ts(s.startedAt),
    endedAt: ts(s.endedAt),
    status: s.status ?? 'completed',
    messageCount: s.messageCount ?? 0,
    userMsgCount: s.userMsgCount ?? 0,
    assistantMsgCount: s.assistantMsgCount ?? 0,
    toolCallCount: s.toolCallCount ?? 0,
    models: s.models ?? [],
    tokens: s.tokens ?? {},
    estCostUsd: s.estCostUsd != null ? String(s.estCostUsd) : null,
    costKnown: s.costKnown ?? true,
    featureTypes: s.featureTypes ?? [],
    termFreq: s.termFreq ?? [],
    toolHistogram: s.toolHistogram ?? {},
    touchedPaths: s.touchedPaths ?? [],
    skills: s.skills ?? {},
    costBreakdown: s.costBreakdown ?? [],
    fullTranscript: s.fullTranscript ?? null,
    summary: s.summary ?? null,
    transcriptPath: s.transcriptPath ?? null,
    contentHash: s.contentHash ?? null,
    fileMtime: ts(s.fileMtime),
    fileSize: s.fileSize ?? null,
    schemaVersion: s.schemaVersion ?? 1,
    ingestedAt: new Date(),
  };

  const stageRows = stages
    .filter((st) => STAGES.has(st.stage))
    .map((st) => ({
      sessionId: s.id,
      stage: st.stage,
      ordinal: st.ordinal,
      title: st.title ?? null,
      summary: st.summary ?? null,
      rawText: st.rawText ?? null,
      startedAt: ts(st.startedAt),
      endedAt: ts(st.endedAt),
      tokens: st.tokens ?? {},
      costUsd: st.costUsd != null ? String(st.costUsd) : null,
      messageCount: st.messageCount ?? 0,
      toolCalls: st.toolCalls ?? 0,
      metadata: st.metadata ?? {},
    }));

  // Upsert the session and replace its stages atomically. The transaction also
  // serialises the concurrent cron + SessionEnd-hook writes for the same session
  // (the DELETE locks the rows), so the (session_id, ordinal) unique index can't
  // be violated and a session is never left stage-less mid-write.
  await db.transaction(async (tx) => {
    await tx
      .insert(claudeSessions)
      .values(row)
      .onConflictDoUpdate({ target: claudeSessions.id, set: { ...row, id: sql`${claudeSessions.id}` } });
    await tx.delete(claudeSessionStages).where(eq(claudeSessionStages.sessionId, s.id));
    if (stageRows.length) await tx.insert(claudeSessionStages).values(stageRows);
  });

  return json({ ok: true, id: s.id, stages: stageRows.length });
};

export const GET: RequestHandler = async () => {
  const [counts] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      totalCost: sql<number>`coalesce(sum(${claudeSessions.estCostUsd}), 0)::float`,
    })
    .from(claudeSessions);
  return json({ sessions: counts?.sessions ?? 0, totalCost: counts?.totalCost ?? 0 });
};

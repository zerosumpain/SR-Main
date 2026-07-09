// GET /api/claude-changelog/session/[id] — full detail for one Claude Code session:
// the rendered full transcript + the per-model cost breakdown. Fetched on demand
// when the "full transcript" modal opens, to keep the changelog page load light.
//
// Auth: owner-only. The /api/claude-changelog/ hooks bypass is POST-only, so this
// GET falls through to the normal Auth.js owner gate (spec Decision Log #6).
import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { claudeSessions } from '$lib/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const rows = await db
    .select({
      id: claudeSessions.id,
      title: claudeSessions.title,
      project: claudeSessions.project,
      startedAt: claudeSessions.startedAt,
      endedAt: claudeSessions.endedAt,
      models: claudeSessions.models,
      tokens: claudeSessions.tokens,
      estCostUsd: claudeSessions.estCostUsd,
      costKnown: claudeSessions.costKnown,
      costBreakdown: claudeSessions.costBreakdown,
      fullTranscript: claudeSessions.fullTranscript,
      transcriptPath: claudeSessions.transcriptPath,
    })
    .from(claudeSessions)
    .where(eq(claudeSessions.id, params.id))
    .limit(1);

  const row = rows[0];
  if (!row) throw error(404, 'session not found');
  return json({ ...row, estCostUsd: row.estCostUsd != null ? Number(row.estCostUsd) : null });
};

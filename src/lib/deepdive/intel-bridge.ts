// Deep dive → intel graph. A completed research session already has its own
// cross-session entity index (used to dedup entities BETWEEN deep dives); this
// bridge is what puts the findings into the intel graph that the rest of jkai
// reasons over — /jkai/intel, @knowledge recall, alerts, the timeline.
//
// One LLM call per completed session, over a digest of the report (executive
// summary + cluster summaries + top facts) rather than every fact row, so the
// cost is bounded regardless of how big the dive was.
import { createHash } from 'crypto';
import { db } from '$lib/db';
import { eq } from 'drizzle-orm';
import { researchSessions } from '$lib/db/schema';
import type { ResearchReport } from './types';
import { extractIntoIntel } from '$lib/jkai/intel/auto-extract';

const MAX_RANKED_FACTS = 40;

/** Flatten a research report into the text worth extracting entities from. */
export function buildResearchDigest(topic: string, report: ResearchReport): string {
  const parts: string[] = [`Research topic: ${topic}`];

  if (report.executive_summary) {
    parts.push(`Executive summary:\n${report.executive_summary}`);
  }

  const clusters = (report.clusters ?? []).filter((c) => c?.title || c?.summary);
  if (clusters.length) {
    parts.push(
      'Findings:\n' + clusters.map((c) => `- ${c.title}: ${c.summary ?? ''}`.trim()).join('\n'),
    );
  }

  const facts = (report.ranked_facts ?? []).filter((f) => typeof f === 'string' && f.trim());
  if (facts.length) {
    parts.push('Key facts:\n' + facts.slice(0, MAX_RANKED_FACTS).map((f) => `- ${f}`).join('\n'));
  }

  const timeline = (report.timeline ?? []).filter((t) => t?.date);
  if (timeline.length) {
    parts.push(
      'Timeline:\n' + timeline.map((t) => `- ${t.date}: ${(t.facts ?? []).join('; ')}`).join('\n'),
    );
  }

  return parts.join('\n\n');
}

/**
 * Extract a completed research session into the intel graph. No-op when the
 * session has no report yet. Safe to call more than once — the digest hash
 * gates re-extraction.
 */
export async function extractResearchIntoIntel(sessionId: string): Promise<void> {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!session?.report) return;

  const digest = buildResearchDigest(session.topic, session.report as ResearchReport);
  if (!digest.trim()) return;

  await extractIntoIntel({
    kind: 'research',
    refId: session.id,
    title: session.topic,
    text: digest,
    contentHash: createHash('sha256').update(digest).digest('hex'),
    metadata: { sessionId: session.id, sourceUrl: `/deepdive/${session.id}` },
  });
}

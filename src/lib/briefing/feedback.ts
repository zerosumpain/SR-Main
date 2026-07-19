// Briefing feedback — 👍/👎 votes on briefings stored in the datastore and fed
// back into synthesis (the deferred engagement-learning loop). A vote carries
// free-text "what" (the topic/section it applies to) so the LLM can weight
// future briefings toward upvoted themes and away from downvoted ones.
import { ensureCollection, upsertRecord, queryRecords } from '$lib/datastore';
import { FEEDBACK_COLLECTION, SYSTEM_ACTOR, BRIEFING_PERMS, errMsg } from './types';

export interface BriefingVote {
  briefingId: string;
  vote: 'up' | 'down';
  /** The topic/section the vote applies to (free text; '' = whole briefing). */
  what: string;
  at: string;
}

export async function ensureFeedbackCollection(): Promise<void> {
  await ensureCollection(
    FEEDBACK_COLLECTION,
    { name: 'Briefing feedback', description: 'Thumbs up/down on briefing content', isSystem: true, defaultPermissions: BRIEFING_PERMS },
    SYSTEM_ACTOR,
  );
}

export async function recordVote(briefingId: string, vote: 'up' | 'down', what: string): Promise<void> {
  await ensureFeedbackCollection();
  const v: BriefingVote = { briefingId, vote, what: what.slice(0, 120), at: new Date().toISOString() };
  // Key by briefing+what so re-voting the same thing replaces, not duplicates.
  const key = `${briefingId}:${v.what || '_overall'}`;
  await upsertRecord(FEEDBACK_COLLECTION, { key, data: v as unknown as Record<string, unknown> }, SYSTEM_ACTOR);
}

/** Recent votes (default last 40) for prompt weighting + the UI. */
export async function listVotes(limit = 40): Promise<BriefingVote[]> {
  try {
    await ensureFeedbackCollection();
    const { records } = await queryRecords(
      FEEDBACK_COLLECTION,
      { sort: { field: 'updatedAt', dir: 'desc' }, limit },
      SYSTEM_ACTOR,
    );
    return records.map((r) => r.data as unknown as BriefingVote);
  } catch (err) {
    console.error('[briefing] listVotes failed:', errMsg(err));
    return [];
  }
}

/** One prompt line summarising engagement, or '' when there's no signal. */
export function feedbackPromptLine(votes: BriefingVote[]): string {
  const ups = votes.filter((v) => v.vote === 'up' && v.what).map((v) => v.what);
  const downs = votes.filter((v) => v.vote === 'down' && v.what).map((v) => v.what);
  const dedupe = (arr: string[]) => [...new Set(arr)].slice(0, 8);
  const parts: string[] = [];
  if (ups.length) parts.push(`the user has upvoted briefing content about: ${dedupe(ups).join(', ')} — give these MORE space`);
  if (downs.length) parts.push(`the user has downvoted content about: ${dedupe(downs).join(', ')} — give these LESS space or drop them`);
  return parts.length ? `Engagement feedback: ${parts.join('; ')}.` : '';
}

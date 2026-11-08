// src/lib/briefing/wa-feedback.ts
//
// Tuning the morning briefing from WhatsApp, where it is read.
//
// The page has had 👍/👎 buttons since July, but the briefing is read on the
// phone and nobody opens a page to vote on a message. A reply is the surface
// he actually uses — the same lesson as daydream feedback (wa-feedback.ts in
// daydream). The composer reads these votes every morning and moves the
// matching sections up or down.
//
// STRICT, like its daydream sibling: the reply must start with the word
// "briefing", so "more coffee" in an ordinary chat never trains anything.
//   briefing more calendar   → up-vote "calendar"
//   briefing less weather    → down-vote "weather"
//   briefing 👍 / briefing 👎 → a vote on the whole briefing (shown on the page)

import { queryRecords } from '$lib/datastore';
import { BRIEFINGS_COLLECTION, SYSTEM_ACTOR, errMsg } from './types';
import { recordVote } from './feedback';

export interface BriefingReply {
  vote: 'up' | 'down';
  /** '' = the whole briefing. */
  what: string;
}

const UP = new Set(['👍', 'good', 'useful', 'great']);
const DOWN = new Set(['👎', 'bad', 'not useful', 'meh']);

/** PURE. `briefing more X` / `briefing less X` / `briefing 👍`, or nothing. */
export function matchBriefingReply(text: string): BriefingReply | null {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  const m = t.match(/^briefing[:,]? (.+)$/);
  if (!m || t.length > 60) return null;
  const rest = m[1].trim();
  if (UP.has(rest)) return { vote: 'up', what: '' };
  if (DOWN.has(rest)) return { vote: 'down', what: '' };
  const tuned = rest.match(/^(more|less|fewer|no more) (?:about |of |on )?(.{2,40})$/);
  if (!tuned) return null;
  return { vote: tuned[1] === 'more' ? 'up' : 'down', what: tuned[2].trim() };
}

/** The briefing a reply is about: the newest one written. */
async function latestBriefingId(): Promise<string | null> {
  const { records } = await queryRecords(BRIEFINGS_COLLECTION, { sort: { field: 'updatedAt', dir: 'desc' }, limit: 1 }, SYSTEM_ACTOR);
  return records[0]?.key ?? null;
}

export async function interceptBriefingFeedback(text: string): Promise<{ handled: boolean; reply?: string }> {
  const match = matchBriefingReply(text);
  if (!match) return { handled: false };
  try {
    const id = await latestBriefingId();
    if (!id) return { handled: true, reply: 'There is no briefing to tune yet.' };
    await recordVote(id, match.vote, match.what);
    if (!match.what) return { handled: true, reply: match.vote === 'up' ? 'Thanks — noted.' : 'Noted. Tell me what to change with “briefing less <topic>”.' };
    return { handled: true, reply: `Noted — ${match.vote === 'up' ? 'more' : 'less'} ${match.what} from tomorrow's briefing.` };
  } catch (err) {
    console.error('[briefing] WhatsApp feedback failed:', errMsg(err));
    return { handled: true, reply: 'I could not save that just now — the briefing page has the same buttons.' };
  }
}

import { describe, it, expect } from 'vitest';
import { matchFeedbackReply, replyTarget, thoughtLink, type ReplyCandidate } from './wa-feedback';

describe('matchFeedbackReply — the closed phrase list', () => {
  it('matches the vocabulary, whole and case-insensitive', () => {
    expect(matchFeedbackReply('👍')).toBe('useful');
    expect(matchFeedbackReply('Useful')).toBe('useful');
    expect(matchFeedbackReply('good one!')).toBe('useful');
    expect(matchFeedbackReply('not that')).toBe('not_useful');
    expect(matchFeedbackReply('👎')).toBe('not_useful');
    expect(matchFeedbackReply('Never this kind')).toBe('never_kind');
    expect(matchFeedbackReply('never')).toBe('never_kind');
  });

  it('refuses conversation that merely contains a verdict word', () => {
    expect(matchFeedbackReply('not useful but funny')).toBeNull();
    expect(matchFeedbackReply('that was useful, do more about the gym')).toBeNull();
    expect(matchFeedbackReply('can you never do that again please, and also…')).toBeNull();
    expect(matchFeedbackReply('')).toBeNull();
  });
});

describe('replyTarget — which thought a bare verdict answers', () => {
  const now = new Date('2026-09-25T18:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  // A think note exactly as `think/run.ts` stamps one it raised through
  // notifyOwner: status delivered, channel push, deliveredAt set.
  const think = (over: Partial<ReplyCandidate> = {}): ReplyCandidate => ({
    id: 'think-1',
    title: 'Late screens cost you deep sleep',
    kind: 'think_correlate',
    channel: 'push',
    status: 'delivered',
    deliveredAt: hoursAgo(1),
    feedback: null,
    evidence: [],
    ...over,
  });

  it('a delivered, unrated think note is what "useful" / "not that" / "never" answer', () => {
    expect(replyTarget([think()], now, { unrated: true })?.id).toBe('think-1');
  });

  it('takes the most recently delivered, whatever its kind', () => {
    const musing = think({ id: 'musing', kind: 'musing_health', channel: 'whatsapp', deliveredAt: hoursAgo(3) });
    expect(replyTarget([musing, think()], now, { unrated: true })?.id).toBe('think-1');
    expect(replyTarget([think({ deliveredAt: hoursAgo(4) }), musing], now, { unrated: true })?.id).toBe('musing');
  });

  it('skips one already rated for a verdict', () => {
    const rated = think({ feedback: 'useful' });
    expect(replyTarget([rated], now, { unrated: true })).toBeNull();
    expect(replyTarget([rated], now, { unrated: false })?.id).toBe('think-1');
  });

  it('never answers outside 12 hours, a note that only sat on the feed, or one never delivered', () => {
    expect(replyTarget([think({ deliveredAt: hoursAgo(13) })], now, { unrated: true })).toBeNull();
    expect(replyTarget([think({ channel: 'silent', status: 'suppressed' })], now, { unrated: true })).toBeNull();
    expect(replyTarget([think({ deliveredAt: null })], now, { unrated: true })).toBeNull();
  });

  it('links a think note to itself on the one feed, and anything older to the feed (its room is gone)', () => {
    expect(thoughtLink({ id: 'think-1', kind: 'think_correlate' })).toBe('https://strangeramblings.com/jkai/daydreams?note=think-1');
    expect(thoughtLink({ id: 'm-1', kind: 'musing_health' })).toBe('https://strangeramblings.com/jkai/daydreams');
  });
});

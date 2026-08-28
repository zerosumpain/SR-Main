import { describe, it, expect } from 'vitest';
import { matchFeedbackReply } from './wa-feedback';
import { chooseChannel } from './deliver';
import { isLocalSunday, phraseWeek, weekFactLines, type WeekFacts } from './digest/weekly';

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

describe('chooseChannel — WhatsApp preference (D3)', () => {
  const thought = { kind: 'musing_health', score: 0.9 };
  const state = () => ({ todayCount: 0, lastDeliveredAt: null, lastByKind: new Map() });
  const base = { now: new Date('2026-08-27T12:00:00Z'), threshold: 0.75 };

  it('prefers whatsapp over push over chat', () => {
    expect(chooseChannel(thought, state(), { ...base, hasPushSubscriber: true, hasWhatsApp: true }).channel).toBe('whatsapp');
    expect(chooseChannel(thought, state(), { ...base, hasPushSubscriber: true, hasWhatsApp: false }).channel).toBe('push');
    expect(chooseChannel(thought, state(), { ...base, hasPushSubscriber: false, hasWhatsApp: false }).channel).toBe('chat');
  });

  it('keeps every limit ahead of the channel choice', () => {
    const d = chooseChannel({ ...thought, score: 0.5 }, state(), { ...base, hasPushSubscriber: false, hasWhatsApp: true });
    expect(d.channel).toBe('silent');
  });
});

describe('weekly digest phrasing', () => {
  const facts: WeekFacts = {
    weekEnding: '2026-08-30',
    raised: 6,
    delivered: 3,
    usefulVotes: 2,
    notUsefulVotes: 1,
    placesAnswered: 4,
    hypothesesTested: 5,
    hypothesesHeld: 1,
    hypothesesRefuted: 3,
    leadsOpened: 2,
    auditDropped: 0,
    spendMinor: 12634,
    topTitles: ['Recovery is the stronger signal today'],
  };

  it('summarises a full week deterministically', () => {
    const s = phraseWeek(facts);
    expect(s).toContain('6 thoughts raised, 3 delivered');
    expect(s).toContain('2↑ 1↓');
    expect(s).toContain('£126.34');
    expect(s).toContain('audit clean');
  });

  it('reports the nothing when there is nothing', () => {
    const s = phraseWeek({ ...facts, raised: 0, delivered: 0, usefulVotes: 0, notUsefulVotes: 0, placesAnswered: 0, hypothesesTested: 0, leadsOpened: 0, spendMinor: 0, topTitles: [] });
    expect(s).toContain('Nothing raised this week');
  });

  it('every number the narrative may use appears in the fact lines', () => {
    const lines = weekFactLines(facts).join('\n');
    expect(lines).toContain('£126.34');
    expect(lines).toContain('5 (1 held up, 3 refuted)');
    expect(lines).toContain('Recovery is the stronger signal');
  });

  it('knows Sunday in local time', () => {
    expect(isLocalSunday(new Date('2026-08-30T12:00:00Z'))).toBe(true); // a Sunday
    expect(isLocalSunday(new Date('2026-08-27T12:00:00Z'))).toBe(false); // a Thursday
    // BST midnight edge: 23:30Z Saturday is 00:30 Sunday in London.
    expect(isLocalSunday(new Date('2026-08-29T23:30:00Z'))).toBe(true);
  });
});

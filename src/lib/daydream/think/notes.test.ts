import { describe, it, expect } from 'vitest';
import {
  inScope,
  isForPhone,
  isOnFeed,
  noteHref,
  parseFeedbackBody,
  parseScope,
  thinkChannelOf,
  toFeedNote,
  toNativeNote,
  todayNotes,
  type ThinkRow,
} from './notes';
import { validateThinkOutput } from './audit';
import { makeCard } from './tools';
import { claimRefs } from '../refutations';

const NOW = new Date('2026-09-25T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function row(over: Partial<ThinkRow> = {}): ThinkRow {
  return {
    id: 't-1',
    kind: 'think_correlate',
    title: 'Late screens cost you deep sleep',
    narrative: 'On the 9 nights your last chat was after 23:30, deep sleep averaged 52 min against 71.\n\nNext: stop at 23:00 for a week.',
    explanation: 'Read 2 cards: health_series({"metric":"deep"}) · chat_threads({})',
    evidence: [
      { kind: 'think-card', id: 'health_series:[["metric","deep"]]@2026-09-25' },
      { kind: 'think-card', id: 'chat_threads:[]@2026-09-25' },
      { kind: 'think-question', id: 'chat', note: 'chat × correlate' },
    ],
    status: 'delivered',
    suppressedReason: null,
    feedback: null,
    createdAt: hoursAgo(2),
    deliveredAt: hoursAgo(2),
    note: null,
    ...over,
  };
}

describe('thinkChannelOf', () => {
  it('reads the recorded question first', () => {
    expect(thinkChannelOf(row().evidence, 'correlate')).toBe('chat');
  });

  it('falls back to the channel most cited cards came from, for notes written before the question was recorded', () => {
    const evidence = [
      { kind: 'think-card', id: 'ha_get_history:[["entity","climate.hall"]]@2026-09-25' },
      { kind: 'think-card', id: 'ha_query_state:[["entity","sensor.x"]]@2026-09-25' },
      { kind: 'think-card', id: 'health_series:[["metric","deep"]]@2026-09-25' },
    ];
    expect(thinkChannelOf(evidence, 'quality_of_life')).toBe('home');
  });

  it('then to the outcome, and null only when nothing names a channel', () => {
    const crossChannel = [{ kind: 'think-card', id: 'correlate:[["a","x"]]@2026-09-25' }];
    expect(thinkChannelOf(crossChannel, 'health_plan')).toBe('health');
    expect(thinkChannelOf(crossChannel, 'efficiency')).toBeNull();
    expect(thinkChannelOf(null, 'efficiency')).toBeNull();
  });

  it('ignores a question naming a channel that does not exist', () => {
    expect(thinkChannelOf([{ kind: 'think-question', id: 'weather' }], 'research')).toBe('research');
  });
});

describe('the audit records the channel, and the echo guard ignores it', () => {
  const cards = new Map([1, 2].map((n) => {
    const c = makeCard(n, 'spend', { n }, `card ${n}`, '2026-09-25');
    return [c.id, c] as const;
  }));
  const note = { outcome: 'money_analysis', title: 'Canva charged twice', body: 'Two Canva rows of £12.99 landed a day apart.', cites: ['C1', 'C2'] };

  it('adds a think-question reference naming the channel', () => {
    const out = validateThinkOutput({ notes: [note] }, cards, { channel: 'money' });
    const q = out.notes[0].candidate.evidence.find((e) => e.kind === 'think-question');
    expect(q).toEqual({ kind: 'think-question', id: 'money', note: 'money × money_analysis' });
  });

  it('never counts the channel as shared evidence — two notes from one channel are not one claim', () => {
    const out = validateThinkOutput({ notes: [note] }, cards, { channel: 'money' });
    const refs = claimRefs(out.notes[0].candidate.evidence);
    expect([...refs].some((r) => r.startsWith('think-question:'))).toBe(false);
    expect(refs.size).toBe(2);
  });
});

describe('what the feed and the phone show', () => {
  it('keeps delivered, rated and feed-only notes on the feed', () => {
    expect(isOnFeed(row())).toBe(true);
    expect(isOnFeed(row({ status: 'dismissed', feedback: 'not_useful' }))).toBe(true);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'feed_only: daily cap' }))).toBe(true);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'notify: owner routed it to feed' }))).toBe(true);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'below_threshold (0.6 < 0.7)' }))).toBe(true);
  });

  it('keeps refuted, echoed, filed and non-think rows off it', () => {
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'already_refuted (Canva)' }))).toBe(false);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'refuted_by_review' }))).toBe(false);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: 'uncertain_after_review' }))).toBe(false);
    expect(isOnFeed(row({ status: 'suppressed', suppressedReason: null }))).toBe(false);
    expect(isOnFeed(row({ status: 'archived' }))).toBe(false);
    expect(isOnFeed(row({ kind: 'musing_health' }))).toBe(false);
    expect(isOnFeed(row({ kind: 'think_' }))).toBe(false);
  });

  it('keeps a never, and every note of a muted kind, off the phone', () => {
    expect(isForPhone(row(), new Set())).toBe(true);
    expect(isForPhone(row({ feedback: 'never_kind', status: 'dismissed' }), new Set())).toBe(false);
    expect(isForPhone(row(), new Set(['think_correlate']))).toBe(false);
  });

  it('Today: the newest two from 48 hours, never one he turned down', () => {
    const rows = [
      row({ id: 'old', createdAt: hoursAgo(50) }),
      row({ id: 'b', createdAt: hoursAgo(5) }),
      row({ id: 'no', createdAt: hoursAgo(1), status: 'dismissed', feedback: 'not_useful' }),
      row({ id: 'a', createdAt: hoursAgo(3), status: 'suppressed', suppressedReason: 'feed_only: daily cap', deliveredAt: null }),
      row({ id: 'c', createdAt: hoursAgo(8) }),
    ];
    expect(todayNotes(rows, new Set(), NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('toNativeNote — the fixed wire shape', () => {
  it('maps a row to exactly the contract', () => {
    expect(toNativeNote(row({ feedback: 'useful', status: 'actioned' }))).toEqual({
      id: 't-1',
      outcome: 'correlate',
      channel: 'chat',
      title: 'Late screens cost you deep sleep',
      body: 'On the 9 nights your last chat was after 23:30, deep sleep averaged 52 min against 71.\n\nNext: stop at 23:00 for a week.',
      createdAt: hoursAgo(2).toISOString(),
      url: '/jkai/daydreams?note=t-1',
      feedback: 'useful',
    });
  });

  it('folds never into not_useful, and falls back to what it read when there is no narrative', () => {
    const n = toNativeNote(row({ feedback: 'never_kind', narrative: null }));
    expect(n.feedback).toBe('not_useful');
    expect(n.body).toMatch(/^Read 2 cards/);
    expect(toNativeNote(row({ feedback: 'not_useful' })).feedback).toBe('not_useful');
  });

  it('escapes an id in the link', () => {
    expect(noteHref('a b&c')).toBe('/jkai/daydreams?note=a%20b%26c');
  });

  it('the feed note keeps the verdict as given and says whether it interrupted him', () => {
    const f = toFeedNote(row({ feedback: 'never_kind', status: 'dismissed', deliveredAt: null }), new Set(['think_correlate']));
    expect(f.verdict).toBe('never_kind');
    expect(f.feedback).toBe('not_useful');
    expect(f.raised).toBe(false);
    expect(f.turnedDown).toBe(true);
    expect(f.kindMuted).toBe(true);
    expect(f.outcomeLabel).toBe('A connection');
    expect(f.channelLabel).toBe('Chat');
  });
});

describe('input', () => {
  it('scope: absent or all is everything, health is health, anything else is refused', () => {
    expect(parseScope(null)).toBe('all');
    expect(parseScope('')).toBe('all');
    expect(parseScope('health')).toBe('health');
    expect(parseScope('money')).toBeNull();
  });

  it('the health scope takes health-channel notes and every proposed week', () => {
    expect(inScope({ channel: 'health', outcome: 'correlate' }, 'health')).toBe(true);
    expect(inScope({ channel: 'diary', outcome: 'health_plan' }, 'health')).toBe(true);
    expect(inScope({ channel: 'home', outcome: 'correlate' }, 'health')).toBe(false);
    expect(inScope({ channel: null, outcome: 'build' }, 'all')).toBe(true);
  });

  it('feedback: maps the three wire verdicts, never onto the kind mute', () => {
    expect(parseFeedbackBody({ id: 'x', verdict: 'useful' })).toEqual({ ok: true, id: 'x', verdict: 'useful' });
    expect(parseFeedbackBody({ id: 'x', verdict: 'not_useful' })).toEqual({ ok: true, id: 'x', verdict: 'not_useful' });
    expect(parseFeedbackBody({ id: 'x', verdict: 'never' })).toEqual({ ok: true, id: 'x', verdict: 'never_kind' });
  });

  it('feedback: refuses anything else', () => {
    expect(parseFeedbackBody(null).ok).toBe(false);
    expect(parseFeedbackBody([]).ok).toBe(false);
    expect(parseFeedbackBody({ verdict: 'useful' }).ok).toBe(false);
    expect(parseFeedbackBody({ id: '  ', verdict: 'useful' }).ok).toBe(false);
    expect(parseFeedbackBody({ id: 'x', verdict: 'never_kind' }).ok).toBe(false);
    expect(parseFeedbackBody({ id: 'x', verdict: 'toString' }).ok).toBe(false);
    expect(parseFeedbackBody({ id: 'x' }).ok).toBe(false);
  });
});

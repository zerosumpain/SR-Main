import { describe, it, expect } from 'vitest';
import { classify, beatGate, trailingChain, SOFT_CHECKIN_TEXT } from './chat-continuation';

describe('chat-continuation classify', () => {
  it('flags streaming status interleaves as in_progress', () => {
    expect(classify('⏳ Still working... (9 min elapsed — iteration 17/90, waiting for provider response (streaming))')).toBe('in_progress');
    expect(classify('Still grinding — found HA token. iter 55/90, running execute_code')).toBe('in_progress');
    expect(classify('Generating the HTML page now...')).toBe('in_progress');
  });

  it('still recognises plain questions', () => {
    expect(classify('Where should I put the file?')).toBe('questioning');
    expect(classify('Want me to continue?')).toBe('benign');
  });

  it('flags blocked patterns', () => {
    expect(classify('I cannot proceed without the API key.')).toBe('blocked');
    expect(classify('This needs additional configuration before I can run.')).toBe('blocked');
  });

  it('treats neutral completion as silent', () => {
    expect(classify("We've landed! All done.")).toBe('silent');
  });

  it("doesn't mistake punctuation-rich completions for in_progress", () => {
    // Ends with a period, no streaming pattern → not in_progress.
    expect(classify("Done! The file is at /home/john/foo.html — open it whenever.")).not.toBe('in_progress');
  });
});

describe('chat-continuation beatGate', () => {
  const MAX = 6;
  const gate = (beats: number, ageMin: number) =>
    beatGate({ beats, ageMs: ageMin * 60_000, maxConsecutiveBeats: MAX });

  it('acts freely when the thread ends on a real message', () => {
    expect(gate(0, 3)).toBe('act');
  });

  it('re-beats an unanswered thread instead of stopping at one', () => {
    // The regression: the handler used to refuse outright once its own note
    // was the newest message, so it posted exactly once per user turn and then
    // went silent — during precisely the long runs it exists to report on.
    expect(gate(1, 30)).toBe('act');
    expect(gate(2, 30)).toBe('act');
  });

  it('widens the interval with each consecutive beat', () => {
    expect(gate(1, 2)).toBe('backoff');
    expect(gate(1, 4)).toBe('act');
    expect(gate(2, 9)).toBe('backoff');
    expect(gate(2, 11)).toBe('act');
    expect(gate(3, 19)).toBe('backoff');
    expect(gate(3, 21)).toBe('act');
  });

  it('still goes quiet on a thread nobody answers', () => {
    expect(gate(MAX, 999)).toBe('capped');
    expect(gate(MAX + 3, 999)).toBe('capped');
  });
});

/**
 * The duplicate check-ins of 2026-10-03: a thread was asked "have we landed?"
 * again after answering it, and a build watcher's closing note set off a
 * check-in on the thread it narrated, so two threads about one build answered
 * "landed" and "not landed" in the same tick.
 */
describe('chat-continuation trailingChain', () => {
  const beat = (kind: string, content = 'x') => ({ role: kind === 'user-trigger' ? 'user' : 'assistant', content, metadata: { heartbeat: { activity: 'chat-continuation', kind } } });
  const plain = (content = 'Here is the answer.') => ({ role: 'assistant', content, metadata: null });

  it('a thread ending on a real reply has no chain', () => {
    expect(trailingChain([plain(), beat('reply')])).toEqual({ beats: 0, softCheckedIn: false, otherActivity: false });
  });

  it('remembers that this pause already had its soft check-in', () => {
    const rows = [beat('reply', "We've landed."), beat('user-trigger', SOFT_CHECKIN_TEXT), plain()];
    expect(trailingChain(rows)).toEqual({ beats: 2, softCheckedIn: true, otherActivity: false });
  });

  it('an auto-continue chain is not a soft check-in', () => {
    const rows = [beat('reply'), beat('user-trigger', '[heartbeat] continuing on your behalf'), plain()];
    expect(trailingChain(rows).softCheckedIn).toBe(false);
  });

  it('a check-in from an earlier pause does not count once a real message intervenes', () => {
    const rows = [plain(), beat('reply'), beat('user-trigger', SOFT_CHECKIN_TEXT)];
    expect(trailingChain(rows).softCheckedIn).toBe(false);
  });

  it("flags a thread whose newest row is another heartbeat activity's note", () => {
    const watcher = { role: 'assistant', content: '✓ build completed', metadata: { heartbeat: { activity: 'watch-build-915fae11', kind: 'note' } } };
    expect(trailingChain([watcher, plain()])).toEqual({ beats: 0, softCheckedIn: false, otherActivity: true });
  });
});

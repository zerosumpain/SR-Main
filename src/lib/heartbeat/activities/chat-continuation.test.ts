import { describe, it, expect } from 'vitest';
import { classify, beatGate } from './chat-continuation';

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

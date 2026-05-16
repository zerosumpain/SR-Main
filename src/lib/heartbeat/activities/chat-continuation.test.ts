import { describe, it, expect } from 'vitest';
import { classify } from './chat-continuation';

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

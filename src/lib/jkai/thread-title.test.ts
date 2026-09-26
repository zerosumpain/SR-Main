import { describe, it, expect } from 'vitest';
import { isPlaceholderTitle, titleFromMessage } from './thread-title';

describe('isPlaceholderTitle', () => {
  it('treats no title and the phone app\'s "New thread" as untitled', () => {
    for (const t of [null, undefined, '', '  ', 'New thread', 'new thread ']) {
      expect(isPlaceholderTitle(t)).toBe(true);
    }
  });

  it('keeps a real title, even one that mentions a new thread', () => {
    expect(isPlaceholderTitle("What's wrong with this fella")).toBe(false);
    expect(isPlaceholderTitle('New thread on the Keystone deck')).toBe(false);
  });
});

describe('titleFromMessage', () => {
  it('keeps a short message whole', () => {
    expect(titleFromMessage('Sup dog')).toBe('Sup dog');
  });

  it('cuts a long one at a whole word, not mid-word', () => {
    const t = titleFromMessage('Summarise my health data for today — sleep, recovery, strain and anything unusual');
    expect(t).toBe('Summarise my health data for today — sleep, recovery…');
    expect(t!.length).toBeLessThanOrEqual(61);
  });

  it('flattens lines and drops markdown and code', () => {
    expect(titleFromMessage('**Why** does\n\nthis fail?\n```ts\nconst x = 1\n```')).toBe('Why does this fail?');
  });

  it('is null with nothing to name it by', () => {
    for (const m of [null, undefined, '', '   ', '```\ncode only\n```']) expect(titleFromMessage(m)).toBeNull();
  });

  it('hard-cuts one enormous word rather than returning nothing', () => {
    expect(titleFromMessage('x'.repeat(200))).toBe(`${'x'.repeat(60)}…`);
  });
});

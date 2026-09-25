import { describe, it, expect } from 'vitest';
import { isPlaceholderTitle } from './thread-title';

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

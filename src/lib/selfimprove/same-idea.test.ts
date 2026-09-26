import { describe, it, expect } from 'vitest';
import { SAME_IDEA_SIMILARITY, findSameIdea, isSameIdea } from './same-idea';
import { TITLE_ECHO_SIMILARITY } from '$lib/daydream/refutations';

describe('same-idea', () => {
  it('uses the think loop’s own threshold rather than a copy of the number', () => {
    expect(SAME_IDEA_SIMILARITY).toBe(TITLE_ECHO_SIMILARITY);
  });

  it('calls a rewording the same idea and a different subject not', () => {
    expect(isSameIdea('Show train delays on the homepage', 'Show my train delays on the home page')).toBe(true);
    expect(isSameIdea('Show train delays on the homepage', 'A mortgage rate watch')).toBe(false);
    expect(isSameIdea('', 'anything')).toBe(false);
  });

  it('picks the closest twin when several clear the bar', () => {
    const items = [{ title: 'Show train delays on the homepage today' }, { title: 'Show train delays on the homepage' }];
    expect(findSameIdea('Show train delays on the homepage', items)).toBe(items[1]);
  });
});

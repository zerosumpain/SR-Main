import { describe, it, expect } from 'vitest';
import { feedbackLine } from './deliver';

describe('feedbackLine', () => {
  // Every delivery lands in chat, because push_subscriptions is empty. Without
  // a way to answer, `feedback` stays NULL on every row, the cold-start
  // threshold never falls from 0.75 and every kind weight sits at 1.0 — the
  // whole learning apparatus idles on an empty input.
  it('gives the note somewhere to go', () => {
    const line = feedbackLine('abc-123');
    expect(line).toContain('/jkai/daydreams');
    expect(line).toContain('abc-123');
  });

  // The one that matters. `src/app.html` sets data-sveltekit-preload-data
  // ="hover" for the whole app, so a GET that RECORDS a verdict could be fired
  // by a preload the owner never chose — training the weights on a mouse
  // movement. The link must only navigate; the vote is a POST from the page.
  it('points at a page, not at an action that records anything', () => {
    const line = feedbackLine('abc-123');
    for (const verb of ['/api/', 'verdict=', 'useful', 'not_useful', 'never_kind']) {
      expect(line).not.toContain(verb);
    }
  });

  it('carries the id as a read-only query param', () => {
    expect(feedbackLine('xyz')).toContain('?rate=xyz');
  });
});

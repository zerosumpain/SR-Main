import { describe, it, expect } from 'vitest';
import { carriedToolsets } from './carried-toolsets';

/**
 * Cover for "a terse follow-up unloads the toolset the conversation was using".
 *
 * `inferToolsets` only ever reads the CURRENT message, and `activatedToolsets`
 * is a fresh Set every turn, so nothing survived a one-word reply. Measured
 * 2026-08-13: after a deck was designed using the real deck vocabulary, "build
 * it" matched only `builds` — the jkai app builder — and unloaded `decks` and
 * `presentations`. The deck was never created. "yes" and "go on then" match
 * nothing at all, and the model then burns tool rounds rediscovering what it
 * was using a minute ago; on Codex each of those rounds is a ~4.3s floor.
 *
 * `carriedToolsets` closes that by re-reading the recent user turns. Its whole
 * job is to be generous about what to keep and strict about how much.
 */

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

describe('carriedToolsets', () => {
  it('carries the previous turn\'s toolsets through a terse follow-up', () => {
    const history = [user('draft me a blog post about the bathroom refit'), assistant('Here is a draft…')];
    // "go on then" matches nothing on its own — that is the whole bug.
    expect(carriedToolsets(history, [])).toContain('blog');
  });

  it('does not re-add a toolset the current message already matched', () => {
    const history = [user('draft a blog post'), assistant('…')];
    const carried = carriedToolsets(history, ['blog']);
    expect(carried).not.toContain('blog');
  });

  it('never returns a duplicate, even when several turns mention the same thing', () => {
    const history = [user('blog post one'), assistant('…'), user('another blog post'), assistant('…')];
    const carried = carriedToolsets(history, []);
    expect(carried).toEqual([...new Set(carried)]);
  });

  it('caps how much it carries — every carried toolset is more schemas in the prompt', () => {
    // Deliberately dense: health + blog + builds + scraper vocabulary at once.
    const history = [
      user('check my sleep and hrv'),
      user('now draft a blog post'),
      user('scrape that job board and build an app for it'),
    ];
    expect(carriedToolsets(history, []).length).toBeLessThanOrEqual(3);
  });

  it('looks only at recent turns, so an old topic does not haunt the thread', () => {
    const history = [
      user('check my sleep and hrv'), // 4 user turns back — out of the window
      user('what is the weather'),
      user('and the calendar'),
      user('send an email'),
    ];
    expect(carriedToolsets(history, [])).not.toContain('health');
  });

  it('ignores assistant turns — only what the USER asked for is context', () => {
    const history = [assistant('I could draft you a blog post about sleep and hrv if you like')];
    expect(carriedToolsets(history, [])).toEqual([]);
  });

  it('is safe on an empty history', () => {
    expect(carriedToolsets([], [])).toEqual([]);
  });

  it('prefers the nearest turn when the budget runs out', () => {
    const history = [
      user('check my sleep and hrv and readiness'),
      user('scrape that job board'),
    ];
    const carried = carriedToolsets(history, []);
    // Most recent first: the turn the user is actually still in wins the budget.
    expect(carried[0]).toBe('scraper');
  });
});

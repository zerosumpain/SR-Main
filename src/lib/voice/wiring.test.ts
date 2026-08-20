// Proof that the surfaces which opted in actually emit the voice block.
//
// Wiring a helper in is not the same as it taking effect — this repo has a
// documented case of a tool bridge that was deployed, registered and never once
// called. These assertions read the real prompt strings the surfaces send.

import { describe, expect, it } from 'vitest';
import { voiceBlock } from './block';

describe('surfaces that opted in', () => {
  it('the blog assistant carries public-prose, with exemplars', async () => {
    const { buildSystemPrompt } = await import('$lib/blog/assistant/prompt');
    const prompt = buildSystemPrompt(
      {
        id: 1,
        title: 't',
        slug: 's',
        status: 'draft',
        tags: [],
        excerpt: 'e',
        content: '<p>Body.</p>',
        coverImageUrl: null,
        coverImageAlt: null,
      } as unknown as Parameters<typeof buildSystemPrompt>[0],
      [],
    );
    expect(prompt).toContain('VOICE — public prose');
    // The band that replaced the old, wrong "short sentences are fine".
    expect(prompt).toContain('Do not chop them into short ones');
    expect(prompt).not.toContain('Short sentences are fine');
    // Exemplars are the point; make sure they survive into the prompt.
    expect(prompt).toContain('I built a thing');
  });

  it('release notes carry terse — conventions without the persona', async () => {
    const block = voiceBlock('terse', { exemplars: 0 });
    expect(block).toContain('British English');
    expect(block).not.toContain('Write as John');
    expect(block).not.toContain('I built a thing');
  });

  it('every register the surfaces ask for renders non-empty', () => {
    for (const r of ['public-prose', 'explanatory', 'terse'] as const) {
      expect(voiceBlock(r, { exemplars: 0 }).length).toBeGreaterThan(150);
    }
  });
});

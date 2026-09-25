import { describe, it, expect } from 'vitest';
import { noticedSection } from './briefing';

const note = (i: number, raised = true) => ({
  title: `Note ${i}`,
  url: `/jkai/daydreams?note=t-${i}`,
  raised,
  channelLabel: 'Health',
  outcomeLabel: 'A connection',
});

describe('noticedSection — the briefing lists think notes', () => {
  it('one linked fact per note, saying whether it interrupted him', () => {
    const { facts, lines } = noticedSection([note(1), note(2, false)]);
    expect(facts).toEqual([
      { label: 'Noticed, and told you', value: '“Note 1” — Health · A connection', href: '/jkai/daydreams?note=t-1' },
      { label: 'Noticed, on the feed', value: '“Note 2” — Health · A connection', href: '/jkai/daydreams?note=t-2' },
    ]);
    expect(lines).toEqual(['• Noticed: Note 1', '• Noticed: Note 2']);
  });

  it('keeps the WhatsApp block short and says how many more wait on the feed', () => {
    const { lines } = noticedSection([1, 2, 3, 4, 5, 6].map((i) => note(i)));
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('  …and 2 more on the feed');
  });

  it('says nothing when there is nothing', () => {
    expect(noticedSection([])).toEqual({ facts: [], lines: [] });
  });
});

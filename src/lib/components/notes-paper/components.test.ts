import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import DateStamp from './DateStamp.svelte';
import EndMark from './EndMark.svelte';
import IndexCard from './IndexCard.svelte';
import InkRing from './InkRing.svelte';
import InkUnderline from './InkUnderline.svelte';
import PencilDot from './PencilDot.svelte';
import Tally from './Tally.svelte';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

describe('notes-paper components', () => {
  it('rings and underlines their content without hiding it from a screen reader', () => {
    const ring = render(InkRing, { props: { children: text('eleven') } }).body;
    expect(ring).toContain('<span>eleven</span>');
    expect(ring).toMatch(/<svg[^>]*aria-hidden="true"/);
    const under = render(InkUnderline, { props: { tone: 'ink', children: text('total') } }).body;
    expect(under).toContain('data-tone="ink"');
  });

  it('draws a tally a stroke a count, and names it only when asked', () => {
    const named = render(Tally, { props: { count: 7, label: 'seven minute read' } }).body;
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="seven minute read"');
    // One gate (four uprights and a slash) and two odd strokes: seven moves.
    expect((named.match(/M/g) ?? []).length).toBe(7);
    const quiet = render(Tally, { props: { count: 3 } }).body;
    expect(quiet).toContain('aria-hidden="true"');
    expect(render(Tally, { props: { count: 0 } }).body).not.toContain('<svg');
  });

  it('stamps a date as a time element when given a machine date', () => {
    const body = render(DateStamp, { props: { date: '28 Sept 2026', datetime: '2026-09-28', sub: 'essays' } }).body;
    expect(body).toMatch(/<time class="np-stamp-d[^"]*" datetime="2026-09-28">28 Sept 2026<\/time>/);
    expect(body).toContain('essays');
  });

  it('pins a card in the element asked for, straight when told', () => {
    const body = render(IndexCard, { props: { as: 'aside', tilt: 0, pin: false, children: text('card') } }).body;
    expect(body).toMatch(/<aside class="np-card/);
    expect(body).toContain('--np-tilt: 0deg');
    expect(body).not.toContain('np-pin');
  });

  it('marks a word with the same pencil every time, as decoration', () => {
    const a = render(PencilDot, { props: { word: 'essays' } }).body;
    expect(a).toBe(render(PencilDot, { props: { word: 'Essays' } }).body);
    expect(a).toContain('aria-hidden="true"');
    expect(render(EndMark, { props: {} }).body).toContain('class="np-end');
  });
});

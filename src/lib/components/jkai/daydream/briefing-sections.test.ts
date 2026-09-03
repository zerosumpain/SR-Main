import { describe, expect, it } from 'vitest';
import {
  briefingFactRows,
  briefingFactSections,
  briefingRollupCells,
  briefingSourceTone,
  sectionSlug,
} from './briefing-sections';
import type { BriefingData, BriefingDetail } from '$lib/briefing/types';

const record = (over: Partial<BriefingDetail> = {}): BriefingData => ({
  id: '2026-09-02',
  trigger: 'workflow',
  status: 'complete',
  startedAt: '2026-09-02T06:00:00.000Z',
  title: 'Briefing · Wed 2 Sep',
  markdown: 'one line',
  sources: [],
  llmCalls: 1,
  costUsd: 0,
  detail: {
    headline: 'A quiet one',
    dateLabel: 'Wed 2 Sep',
    generatedAt: '2026-09-02T06:00:00.000Z',
    timezone: 'Europe/London',
    location: null,
    weather: null,
    knowledge: null,
    facts: [
      { section: 'Location', label: 'Where', value: 'Home', source: 'life360' },
      { section: 'Location', label: 'Since', value: '2 Sep, 22:10', source: 'life360' },
      { section: 'Daydreams', label: 'Said', value: '2 crossings', source: 'daydream', href: '/jkai/daydreams/feed' },
    ],
    gaps: [],
    sources: [
      { key: 'life360', label: 'Location', status: 'ok', detail: 'home' },
      { key: 'email', label: 'Email', status: 'failed', detail: 'token expired' },
    ],
    ...over,
  },
});

describe('briefing sections', () => {
  it('slugs a section the way the day page anchors it', () => {
    expect(sectionSlug('Weather · where you are')).toBe('weather-where-you-are');
    expect(sectionSlug('!!!')).toBe('section');
  });

  it('hoists Daydreams to the front and keeps the rest in record order', () => {
    const sections = briefingFactSections(record().detail);
    expect(sections.map((s) => s.section)).toEqual(['Daydreams', 'Location']);
    expect(sections[1].facts).toHaveLength(2);
  });

  it('carries a fact href through and gives a clock time the mono face', () => {
    const rows = briefingFactRows(record().detail!.facts);
    expect(rows[0]).toMatchObject({ label: 'Where', href: null, mono: false });
    expect(rows[1]).toMatchObject({ label: 'Since', mono: true });
    expect(rows[2].href).toBe('/jkai/daydreams/feed');
  });

  it('builds one cell per section plus gaps and sources, prefixed with the day page', () => {
    const cells = briefingRollupCells(record(), '/jkai/daydreams/briefing/2026-09-02');
    expect(cells.map((c) => c.key)).toEqual(['daydreams', 'location', 'gaps', 'sources']);
    expect(cells[0].href).toBe('/jkai/daydreams/briefing/2026-09-02#sec-daydreams');
    expect(cells[1].value).toBe('2');
    expect(cells[2].tone).toBe('good');
    expect(cells[3]).toMatchObject({ value: '1', suffix: '/2', tone: 'watch' });
  });

  it('takes the Daydreams cell subtitle from the block WhatsApp carried', () => {
    const withText = record({ daydreamsText: '2 said · 1 held\nmore lines' });
    expect(briefingRollupCells(withText)[0].sub).toBe('2 said · 1 held');
  });

  it('tones the source ledger by ratio', () => {
    expect(briefingSourceTone(0, 0)).toBe('quiet');
    expect(briefingSourceTone(4, 4)).toBe('good');
    expect(briefingSourceTone(3, 4)).toBe('steady');
    expect(briefingSourceTone(1, 2)).toBe('watch');
    expect(briefingSourceTone(1, 4)).toBe('urgent');
  });
});

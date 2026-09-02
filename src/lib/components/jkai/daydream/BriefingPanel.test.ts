import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BriefingPanel from './BriefingPanel.svelte';
import {
  BRIEFING_SOURCE_CATALOG,
  DEFAULT_BRIEFING_PROFILE,
  type BriefingProfile,
} from '$lib/constants/briefing';
import type { BriefingData } from '$lib/briefing/types';

const profile = (): BriefingProfile => structuredClone(DEFAULT_BRIEFING_PROFILE);

const sourceCatalog = () => BRIEFING_SOURCE_CATALOG.map((source) => ({
  ...source,
  preference: profile().sources[source.key],
  connection: source.mode === 'native' ? 'native' as const : 'connected' as const,
}));

const latestBriefing: BriefingData = {
  id: 'briefing-1',
  trigger: 'workflow',
  status: 'complete',
  startedAt: '2026-09-01T06:30:00.000Z',
  finishedAt: '2026-09-01T06:31:00.000Z',
  title: 'Tuesday briefing',
  markdown: 'The day starts with one clear priority.',
  sources: ['memory', 'weather'],
  llmCalls: 1,
  costUsd: 0.012,
  detail: {
    headline: 'A clear start, with one thing worth watching',
    dateLabel: 'Tue 1 Sep',
    generatedAt: '2026-09-01T06:31:00.000Z',
    timezone: 'Europe/London',
    location: { isHome: true, label: 'Home', accuracyM: 12 },
    weather: {
      home: { label: 'Home', nowC: 16, minC: 12, maxC: 19, precipProbMaxPct: 20, windKph: 8 },
      here: null,
      sameSpot: true,
    },
    knowledge: null,
    memories: [{
      id: 'memory-1',
      category: 'preference',
      content: 'Short operational summaries are easier to act on.',
      confidence: 'high',
      createdAt: '2026-09-01T05:45:00.000Z',
    }],
    facts: [{ section: 'Weather', label: 'Rain', value: '20%', source: 'weather-home' }],
    gaps: [],
    sources: [
      { key: 'weather-home', label: 'Weather at home', status: 'ok', detail: '16°C' },
      { key: 'memories', label: 'New memories', status: 'ok', detail: '1 recent memory' },
    ],
  },
};

function renderPanel(briefings: BriefingData[]) {
  return render(BriefingPanel, {
    props: {
      embedded: true,
      data: {
        briefings,
        enabled: true,
        topics: ['Current projects'],
        profile: profile(),
        sourceCatalog: sourceCatalog(),
        workflowId: 'workflow-1',
        schedule: { display: 'Daily at 06:30', expr: '30 6 * * *' },
      },
    },
  }).body;
}

describe('BriefingPanel composition', () => {
  it('renders the briefing, memory handoff, and collapsed evidence as one view', () => {
    const html = renderPanel([latestBriefing]);

    expect(html).toContain('A clear start, with one thing worth watching');
    expect(html).toContain('Short operational summaries are easier to act on.');
    expect(html).toContain('Sources and evidence');
    expect(html).toContain('<details class="evidence');
    expect(html).not.toContain('Decide what earns attention');
    expect(html).not.toContain('br-sec');
  });

  it('renders configuration instead of an empty legacy briefing', () => {
    const html = renderPanel([]);

    expect(html).toContain('Decide what earns attention');
    expect(html).toContain('Editorial priorities');
    expect(html).not.toContain('Sources and evidence');
    expect(html).not.toContain('Earlier briefings');
  });
});

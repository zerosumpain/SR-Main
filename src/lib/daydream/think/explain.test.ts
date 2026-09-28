import { describe, expect, it } from 'vitest';
import { describeSource, describeSources, noteStage, parseCardRef, sourceText, splitNarrative } from './explain';

describe('splitNarrative', () => {
  it('splits the Next: line run.ts appends', () => {
    expect(splitNarrative('Two Canva charges.\n\nNext: Open Canva billing.')).toEqual({
      summary: 'Two Canva charges.',
      next: 'Open Canva billing.',
    });
  });
  it('leaves a body without a next step whole', () => {
    expect(splitNarrative('Para one.\n\nPara two.')).toEqual({ summary: 'Para one.\n\nPara two.', next: null });
  });
  it('keeps a mid-sentence "Next:" in the body', () => {
    expect(splitNarrative('Next: week looks busy.')).toEqual({ summary: '', next: 'week looks busy.' });
    expect(splitNarrative('Plan. Next: Tuesday').next).toBeNull();
  });
  it('copes with null', () => {
    expect(splitNarrative(null)).toEqual({ summary: '', next: null });
  });
});

describe('describeSource', () => {
  it('says spend in words', () => {
    expect(sourceText(describeSource('spend', { days: 60, merchant: 'Canva' }))).toBe('Bank spend · Canva · last 60 days');
  });
  it('says the diary window', () => {
    expect(sourceText(describeSource('diary', { from: 'today', to: '+14d', query: '' }))).toBe('Your diary · today to 14 days ahead');
  });
  it('names a web page by its host and keeps the link', () => {
    const s = describeSource('fetch_url', { url: 'https://www.gov.uk/government/news/x' });
    expect(s).toEqual({ label: 'Web page', detail: 'gov.uk', href: 'https://www.gov.uk/government/news/x' });
  });
  it('never offers a non-http link', () => {
    expect(describeSource('fetch_url', { url: 'javascript:alert(1)' }).href).toBeUndefined();
  });
  it('lists home domains and areas', () => {
    expect(describeSource('ha_find', { query: '', domain: ['lock', 'person'], area: '' }).detail).toBe('lock, person');
    expect(describeSource('ha_find', {}).detail).toBe('everything in the house');
  });
  it('shortens a long list of health sections', () => {
    const d = describeSource('health_hub', { sections: ['read', 'tiles', 'instruments', 'forecasts', 'moves'] }).detail;
    expect(d).toBe('the read, headline figures, instruments and 2 more');
  });
  it('falls back honestly for an unknown tool', () => {
    expect(describeSource('new_tool', {})).toEqual({ label: 'new tool', detail: '' });
  });
});

describe('parseCardRef / describeSources', () => {
  const ref = 'spend:[["days",60],["merchant","Canva"]]@2026-09-28';
  it('parses a card ref', () => {
    expect(parseCardRef(ref)).toEqual({ tool: 'spend', args: { days: 60, merchant: 'Canva' } });
  });
  it('refuses prototype keys and junk', () => {
    expect(parseCardRef('spend:[["__proto__",1]]@2026-09-28')).toEqual({ tool: 'spend', args: {} });
    expect(parseCardRef('spend:not-json@2026-09-28')).toBeNull();
  });
  it('dedupes and skips non-card evidence', () => {
    const lines = describeSources([
      { kind: 'think-card', id: ref },
      { kind: 'think-card', id: ref.replace('2026-09-28', '2026-09-29') },
      { kind: 'think-question', id: 'money' },
    ]);
    expect(lines.map(sourceText)).toEqual(['Bank spend · Canva · last 60 days']);
  });
  it('is empty for anything that is not a list', () => {
    expect(describeSources(null)).toEqual([]);
  });
});

describe('noteStage', () => {
  it('an unrated note waits on you', () => {
    expect(noteStage({ verdict: null })).toEqual({ stage: 'spotted', bucket: 'decide' });
  });
  it('a rated note with nothing pending is done', () => {
    expect(noteStage({ verdict: 'useful' })).toEqual({ stage: 'decide', bucket: 'done' });
  });
  it('a check awaiting sign-off is yours, even when rated', () => {
    expect(noteStage({ verdict: 'useful', commissionState: 'awaiting_approval' }).bucket).toBe('decide');
  });
  it('a running check is in motion', () => {
    expect(noteStage({ verdict: null, commissionState: 'running' })).toEqual({ stage: 'motion', bucket: 'motion' });
  });
  it('a report on an unrated note comes back to you', () => {
    expect(noteStage({ verdict: null, commissionState: 'completed' })).toEqual({ stage: 'result', bucket: 'decide' });
    expect(noteStage({ verdict: 'useful', commissionState: 'completed' })).toEqual({ stage: 'result', bucket: 'done' });
  });
  it('an accepted build idea is in motion; a shipped one is a result', () => {
    expect(noteStage({ verdict: 'useful', build: { status: 'open', accepted: true } }).bucket).toBe('motion');
    expect(noteStage({ verdict: 'useful', build: { status: 'open', accepted: false } }).bucket).toBe('done');
    expect(noteStage({ verdict: 'useful', build: { status: 'shipped', accepted: true } }).stage).toBe('result');
  });
});

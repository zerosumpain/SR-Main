import { describe, expect, it } from 'vitest';
import {
  agoWords,
  buildSentence,
  countWord,
  noteNumber,
  readDaydream,
  readPulse,
  sinceWords,
  spanWords,
  timesWord,
  type Clause,
  type Sentence,
  type SentenceInput,
} from './sentence';

// 14:40 in London on Friday 9 October 2026 (BST, so 13:40 UTC).
const NOW = Date.parse('2026-10-09T13:40:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const FACTS = { cadenceMinutes: 45, activeHours: { start: 7, end: 23 }, hitRate: 0.62, windowDays: 14 };

/** The sentence as a reader sees it (screen-reader text for dashes), footnotes left out. */
function read(s: Sentence): string {
  const clause = (c: Clause) => `${c.lead}${c.spoken ?? c.word}${c.tail}${c.aside ? ` (${c.aside})` : ''}${c.end}`;
  return `${s.opening}${s.clauses.map(clause).join('')}${s.closing}`.trim();
}

const BASE: SentenceInput = {
  now: NOW,
  temp: 12.3,
  pulse: { state: 'fresh', bpm: 52, at: minsAgo(11) },
  steps: 3178,
  daydream: { state: 'next', minutes: 40 },
  deploys: { today: 0, yesterday: 2 },
  releases: { total: 1388, since: '2026-03-20T10:00:00Z' },
};

describe('the landing sentence', () => {
  it('reads every live value as one sentence', () => {
    expect(read(buildSentence(BASE))).toBe(
      'It’s 12° out. My heart is keeping time at 52 beats a minute (the watch checked in 11 minutes ago),' +
        ' I’ve walked 3,178 steps since midnight, and the site will daydream again in 40 minutes.' +
        ' It has shipped nothing yet today, after two yesterday, and has released itself 1,388 times since March.',
    );
  });

  it('carries the five value words in footnote order', () => {
    const s = buildSentence(BASE);
    expect(s.clauses.map((c) => c.id)).toEqual(['pulse', 'steps', 'daydream', 'ship', 'releases']);
    expect(s.clauses.map((c) => noteNumber(c.id))).toEqual([1, 2, 3, 4, 5]);
    expect(s.clauses.map((c) => c.word)).toEqual(['52', '3,178 steps', '40 minutes', 'nothing yet', '1,388 times']);
  });

  it('says so when there is no fresh pulse, with a dash a screen reader hears as words', () => {
    const none = buildSentence({ ...BASE, pulse: { state: 'none' } }).clauses[0];
    expect(none).toMatchObject({ word: '—', spoken: 'no fresh reading', aside: 'waiting on the watch' });
    const stale = buildSentence({ ...BASE, pulse: { state: 'stale', at: minsAgo(9 * 60) } }).clauses[0];
    expect(stale).toMatchObject({ word: '—', spoken: 'no fresh reading', aside: 'nothing fresh from the watch' });
    // How long the watch has been quiet is not the front page's business.
    const old = buildSentence({ ...BASE, pulse: { state: 'stale', at: minsAgo(3 * 1440) } });
    expect(read(old)).not.toMatch(/\d+ (days?|hours?)|for (a|an|\d)/);
  });

  it('tells no steps reported apart from a recorded zero', () => {
    expect(read(buildSentence({ ...BASE, steps: null }))).toContain(', the phone hasn’t sent any steps yet today,');
    expect(read(buildSentence({ ...BASE, steps: 0 }))).toContain('I’ve walked 0 steps since midnight,');
    expect(read(buildSentence({ ...BASE, steps: 1 }))).toContain('I’ve walked 1 step since midnight,');
  });

  it('has a clause for every daydream state, and keeps "asleep" about the loop', () => {
    const dd = (daydream: SentenceInput['daydream']) => read(buildSentence({ ...BASE, daydream }));
    expect(dd({ state: 'now' })).toContain('and the site is thinking now.');
    expect(dd({ state: 'next', minutes: 1 })).toContain('daydream again in a minute.');
    expect(dd({ state: 'next', minutes: 130 })).toContain('daydream again in 2 hours.');
    expect(dd({ state: 'asleep', wakes: '07:00' })).toContain('the site’s daydreamer is asleep till 07:00 (the loop, not me).');
    expect(dd({ state: 'late', minutes: 180 })).toContain('the site’s daydreamer is running late (it was due 3 hours ago).');
    expect(dd({ state: 'off' })).toContain('the site’s daydreamer is switched off for now.');
    expect(dd({ state: 'unknown', cadence: 45 })).toContain('and the site daydreams every 45 minutes.');
  });

  it('counts deploys in words, today and yesterday', () => {
    const ship = (today: number, yesterday: number) => read(buildSentence({ ...BASE, deploys: { today, yesterday } }));
    expect(ship(0, 0)).toContain('It has shipped nothing yet today, after a quiet yesterday,');
    expect(ship(1, 1)).toContain('It has shipped once today, after one yesterday,');
    expect(ship(2, 0)).toContain('It has shipped twice today, after a quiet yesterday,');
    expect(ship(3, 14)).toContain('It has shipped three times today, after 14 yesterday,');
    expect(ship(12, 3)).toContain('It has shipped 12 times today, after three yesterday,');
  });

  it('ends cleanly when the release record is missing or empty', () => {
    const gone = buildSentence({ ...BASE, deploys: null, releases: null });
    expect(gone.clauses.map((c) => c.id)).toEqual(['pulse', 'steps', 'daydream']);
    expect(read(gone)).toMatch(/40 minutes\. Its release record isn’t answering just now\.$/);
    const empty = buildSentence({ ...BASE, releases: { total: 0, since: null } });
    expect(read(empty)).toMatch(/after two yesterday\.$/);
  });

  it('names the year when the record began in another one', () => {
    expect(read(buildSentence({ ...BASE, releases: { total: 1, since: '2025-11-02T09:00:00Z' } }))).toMatch(
      /released itself once since November 2025\.$/,
    );
  });

  it('opens on the weather only once it is in, with a real minus sign', () => {
    expect(buildSentence({ ...BASE, temp: null }).opening).toBe('');
    expect(buildSentence({ ...BASE, temp: -2.4 }).opening).toBe('It’s −2° out.');
    expect(buildSentence({ ...BASE, temp: -0.2 }).opening).toBe('It’s 0° out.');
  });

  it('never strands punctuation: a word followed at once by punctuation has an empty tail', () => {
    for (const c of buildSentence({ ...BASE, steps: null }).clauses) {
      expect(c.tail === '' || /^\s/.test(c.tail)).toBe(true);
      expect(c.lead.endsWith(' ')).toBe(true);
    }
  });

  it('never mentions Whoop, or says where anyone is', () => {
    const all = [
      BASE,
      { ...BASE, pulse: { state: 'none' } as const },
      { ...BASE, daydream: { state: 'asleep', wakes: '07:00' } as const },
    ].map((s) => read(buildSentence(s)).toLowerCase());
    for (const s of all) expect(s).not.toMatch(/whoop|walking now|out walking|at home|away/);
  });
});

describe('reading the pulse', () => {
  it('needs the heart-rate reading’s own time, fresh within six hours', () => {
    expect(readPulse({ pulse: 52.4, pulseAt: minsAgo(11) }, NOW)).toEqual({ state: 'fresh', bpm: 52, at: minsAgo(11) });
    expect(readPulse({ pulse: 52, pulseAt: minsAgo(7 * 60) }, NOW)).toEqual({ state: 'stale', at: minsAgo(7 * 60) });
    // The feed's placeholder 60 with no reading behind it is not a pulse.
    expect(readPulse({ pulse: 60 }, NOW)).toEqual({ state: 'none' });
    expect(readPulse({ pulse: 0, pulseAt: minsAgo(3) }, NOW)).toEqual({ state: 'none' });
    expect(readPulse({ pulse: 60, pulseAt: 'garbage' }, NOW)).toEqual({ state: 'none' });
    expect(readPulse(null, NOW)).toEqual({ state: 'none' });
  });
});

describe('reading the daydreamer', () => {
  const live = (nextRunAt: string | null, paused = false) => ({ daydream: { lastRunAt: null, nextRunAt, paused } });
  it('counts down to the next think, then says it is thinking', () => {
    expect(readDaydream(live(new Date(NOW + 40 * 60_000).toISOString()), FACTS, NOW)).toEqual({ state: 'next', minutes: 40 });
    expect(readDaydream(live(new Date(NOW + 30_000).toISOString()), FACTS, NOW)).toEqual({ state: 'now' });
    expect(readDaydream(live(new Date(NOW - 90_000).toISOString()), FACTS, NOW)).toEqual({ state: 'now' });
  });
  it('says it is late, not thinking, once the due time is more than a cadence gone', () => {
    expect(readDaydream(live(new Date(NOW - 44 * 60_000).toISOString()), FACTS, NOW)).toEqual({ state: 'now' });
    expect(readDaydream(live(new Date(NOW - 45 * 60_000).toISOString()), FACTS, NOW)).toEqual({ state: 'late', minutes: 45 });
    expect(readDaydream(live(new Date(NOW - 3 * 3_600_000).toISOString()), FACTS, NOW)).toEqual({ state: 'late', minutes: 180 });
  });
  it('is asleep outside its hours, London time, whatever the loop says', () => {
    const late = Date.parse('2026-10-09T22:30:00Z'); // 23:30 BST
    const early = Date.parse('2026-01-15T06:59:00Z'); // 06:59 GMT
    expect(readDaydream(live(null), FACTS, late)).toEqual({ state: 'asleep', wakes: '07:00' });
    expect(readDaydream(live(null, true), FACTS, early)).toEqual({ state: 'asleep', wakes: '07:00' });
    expect(readDaydream(live(null), FACTS, Date.parse('2026-01-15T07:00:00Z')).state).toBe('off');
  });
  it('is switched off inside its hours when not scheduled, and unknown before the poll answers', () => {
    expect(readDaydream(live(new Date(NOW + 600_000).toISOString(), true), FACTS, NOW)).toEqual({ state: 'off' });
    expect(readDaydream({ daydream: undefined }, FACTS, NOW)).toEqual({ state: 'off' });
    expect(readDaydream(null, FACTS, NOW)).toEqual({ state: 'unknown', cadence: 45 });
  });
});

describe('words', () => {
  it('counts, times and spans', () => {
    expect([0, 1, 2, 10, 11, 1388].map(countWord)).toEqual(['no', 'one', 'two', 'ten', '11', '1,388']);
    expect([1, 2, 3, 10, 11].map(timesWord)).toEqual(['once', 'twice', 'three times', 'ten times', '11 times']);
    expect([0, 1, 40, 59, 60, 61, 130].map(spanWords)).toEqual([
      'a minute', 'a minute', '40 minutes', '59 minutes', 'an hour', 'an hour', '2 hours',
    ]);
  });
  it('ages', () => {
    expect(agoWords(minsAgo(0.4), NOW)).toBe('a moment ago');
    expect(agoWords(minsAgo(1), NOW)).toBe('a minute ago');
    expect(agoWords(minsAgo(11), NOW)).toBe('11 minutes ago');
    expect(agoWords(minsAgo(70), NOW)).toBe('an hour ago');
    expect(agoWords(minsAgo(300), NOW)).toBe('5 hours ago');
    expect(agoWords(minsAgo(3 * 1440), NOW)).toBe('3 days ago');
    // A watch clock slightly ahead of the server is "a moment ago", not negative.
    expect(agoWords(new Date(NOW + 30_000).toISOString(), NOW)).toBe('a moment ago');
  });
  it('since', () => {
    expect(sinceWords('2026-03-20T10:00:00Z', NOW)).toBe('March');
    expect(sinceWords(null, NOW)).toBeNull();
    expect(sinceWords('nope', NOW)).toBeNull();
  });
});

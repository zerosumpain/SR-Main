import { describe, expect, it } from 'vitest';
import { DAYDREAM_SESSION_GOAL, INTEREST_COOLDOWN_DECLINED_DAYS, cleanInterests, cooldownDays, pickInterest, type Coverage } from './interests';

const now = new Date('2026-10-16T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

// The list a research cycle was actually handed on prod, 2026-10-16.
const notebook = [
  ...Array.from({ length: 11 }, (_, i) => ({ title: `News brief — 2026-10-${String(15 - i).padStart(2, '0')}`, folder: 'News', tags: ['news', 'brief'] })),
  { title: 'Ember-1', folder: '', tags: [] },
];
const sessions = [
  { topic: 'A sharper test for whether the agent’s claims are actually justified', goals: [`${DAYDREAM_SESSION_GOAL}: …`] },
  { topic: 'how do i de-restrict my Amflow PR Carbon Pro 2027 so i can go over 15.5mph. use social sources', goals: [] },
  { topic: 'Reddit firsthand reports on de-restricting the Amflow PR Carbon Pro 2027 above 15.5 mph', goals: [] },
  { topic: 'Ember-1', goals: [] },
  { topic: 'Barns Ness geology Scotland', goals: [] },
  { topic: 'dfdf', goals: [] },
];

describe('cleanInterests', () => {
  const list = cleanInterests(notebook, sessions);

  it('drops the machine-written news briefs and the sessions daydream started', () => {
    expect(list.map((i) => i.title)).toEqual([
      'Ember-1',
      'how do i de-restrict my Amflow PR Carbon Pro 2027 so i can go over 15.5mph. use social sources',
      'Barns Ness geology Scotland',
    ]);
  });

  it('keys each interest as a topic subject', () => {
    expect(list[0].key).toBe('topic:ember-1');
  });
});

describe('the prod list of 2026-10-16', () => {
  // Notebook first (pinned, then newest), then research sessions newest first.
  const prodNotebook = [
    'just a test',
    'Im struggling to unlock my Microsoft sccount',
    'notes on delivery',
    '',
    'Rome Holiday',
    'And I am talking now and I\'m going to keep…',
    "We've booked a holiday to Rome",
    'Trip ideas and deals for our break in rome',
    'Ember-1',
  ].map((title) => ({ title, folder: '', tags: [] as string[] }));
  const prodSessions = [
    'how do i de-restrict my amflow pr carbon pro 2027 so i can go over 15.5mph. use social sources',
    'Reddit firsthand reports on de-restricting the Amflow PR Carbon Pro 2027 above 15.5 mph',
    'Ember-1',
    'Barns Ness geology Scotland',
    'something about sausages',
    'dfdf',
    'best start in life command paper details',
    "what 'best start in life' command paper",
    'Forest Holidays discount codes and offers for a UK stay starting 28 Dec',
    'things to do to be safe in rome',
    'something about rome',
  ].map((topic) => ({ topic, goals: [] }));

  it('keeps one entry per thing he asked about', () => {
    expect(cleanInterests(prodNotebook, prodSessions).map((i) => i.title)).toEqual([
      'Im struggling to unlock my Microsoft sccount',
      'notes on delivery',
      'Rome Holiday',
      'Ember-1',
      'how do i de-restrict my amflow pr carbon pro 2027 so i can go over 15.5mph. use social sources',
      'Barns Ness geology Scotland',
      'something about sausages',
      'best start in life command paper details',
      'Forest Holidays discount codes and offers for a UK stay starting 28 Dec',
    ]);
  });
});

describe('pickInterest', () => {
  const list = cleanInterests(notebook, sessions);
  const cov = (entries: Array<[string, Coverage]>) => new Map(entries);

  it('takes a never-covered interest first, in list order', () => {
    expect(pickInterest(list, cov([['topic:ember-1', { lastAt: daysAgo(2), verdicts: [] }]]), now)?.title).toMatch(/Amflow/);
  });

  it('rests an interest for a week after its last note', () => {
    const all = cov(list.map((i) => [i.key, { lastAt: daysAgo(3), verdicts: [] }]));
    expect(pickInterest(list, all, now)).toBeNull();
  });

  it('takes the one looked at longest ago among those due', () => {
    const c = cov([
      ['topic:ember-1', { lastAt: daysAgo(9), verdicts: [] }],
      [list[1].key, { lastAt: daysAgo(12), verdicts: [] }],
      [list[2].key, { lastAt: daysAgo(1), verdicts: [] }],
    ]);
    expect(pickInterest(list, c, now)?.key).toBe(list[1].key);
  });

  it('rests it three weeks when he turned the last two down', () => {
    expect(cooldownDays({ lastAt: now, verdicts: [true, true] })).toBe(INTEREST_COOLDOWN_DECLINED_DAYS);
    expect(cooldownDays({ lastAt: now, verdicts: [true, false] })).toBe(7);
    const c = cov(list.map((i) => [i.key, { lastAt: daysAgo(10), verdicts: i.key === 'topic:ember-1' ? [true, true] : [] }]));
    c.set(list[1].key, { lastAt: daysAgo(2), verdicts: [] });
    c.set(list[2].key, { lastAt: daysAgo(2), verdicts: [] });
    expect(pickInterest(list, c, now)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  PLAN_SUBJECT,
  decideOnSubject,
  figuresIn,
  modelSubjectKey,
  namedInCards,
  newFigures,
  readSeenAgain,
  subjectFor,
  subjectLabel,
  subjectOf,
  withSeenAgain,
  type EarlierNote,
} from './subjects';

const now = new Date('2026-10-16T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function earlier(over: Partial<EarlierNote> = {}): EarlierNote {
  return { id: 'e1', title: 'Sky TV monthly charge increased by £1.69', text: 'Sky TV monthly charge increased by £1.69\nFrom £38.00 to £39.69 on 10 October.', createdAt: hoursAgo(120), answered: false, open: true, ...over };
}

describe('the subject key', () => {
  it('keeps a model subject only when a cited card names it', () => {
    const cards = [{ tool: 'spend', args: {}, text: '2026-10-15 SKY DIGITAL £39.69 [bank]' }];
    expect(subjectFor({ outcome: 'money_analysis', modelSubject: 'merchant:Sky', cited: cards })).toBe('merchant:sky');
    expect(subjectFor({ outcome: 'money_analysis', modelSubject: 'merchant:Netflix', cited: cards })).toBeNull();
  });

  it('refuses a type outside the closed list, and a name too short to mean anything', () => {
    expect(modelSubjectKey('vibe:Sky')).toBeNull();
    expect(modelSubjectKey('merchant:X')).toBeNull();
    expect(modelSubjectKey('Device : Front door camera')).toEqual({ key: 'device:front-door-camera', type: 'device', name: 'Front door camera' });
  });

  it('files every plan under one living key, whatever the model calls it', () => {
    expect(subjectFor({ outcome: 'health_plan', modelSubject: 'event:Oct 6–12 week', cited: [] })).toBe(PLAN_SUBJECT);
  });

  it('keys a correlation by its cited pair, order-free', () => {
    const cited = [{ tool: 'correlate', args: { a: 'sleepMinutes', b: 'recoveryScore' }, text: '…' }];
    const swapped = [{ tool: 'correlate', args: { a: 'recoveryScore', b: 'sleepMinutes' }, text: '…' }];
    expect(subjectFor({ outcome: 'correlate', modelSubject: null, cited })).toBe('correlate:recoveryScore~sleepMinutes');
    expect(subjectFor({ outcome: 'correlate', modelSubject: null, cited: swapped })).toBe('correlate:recoveryScore~sleepMinutes');
  });

  it('files a research note under the interest code gave it, not the model', () => {
    expect(subjectFor({ outcome: 'research', modelSubject: 'thing:GPS-Bench', cited: [], researchTopic: 'Ember-1' })).toBe('topic:ember-1');
  });

  it('matches names through punctuation and case', () => {
    expect(namedInCards('Postcode Lottery', [{ text: 'POSTCODE-LOTTERY £12.50' }])).toBe(true);
  });

  it('reads back off the stored evidence', () => {
    expect(subjectOf([{ kind: 'think-card', id: 'x' }, { kind: 'think-subject', id: 'merchant:sky' }])).toBe('merchant:sky');
    expect(subjectOf(null)).toBeNull();
    expect(subjectLabel('correlate:recoveryScore~sleepMinutes')).toBe('the test of recoveryScore and sleepMinutes');
  });
});

describe('what changed', () => {
  it('finds the figures in a text', () => {
    expect([...figuresIn('Rose 20%, from £4.99 to £5.99 on 2026-10-11.')]).toEqual(['20%', '£4.99', '£5.99', '2026-10-11']);
  });

  it('counts only figures the earlier note lacked and the cards hold', () => {
    expect(newFigures('it went up again by £1.69', 'Sky increased by £1.69', 'SKY £39.69 £1.69')).toEqual([]);
    expect(newFigures('now £41.50, a second rise', 'Sky increased by £1.69 to £39.69', 'SKY £41.50')).toEqual(['£41.50']);
    // A "new" figure the evidence does not carry is invented.
    expect(newFigures('now £45', 'Sky increased by £1.69', 'SKY £41.50')).toEqual([]);
  });
});

describe('the decision', () => {
  it('lets the first note on a subject through', () => {
    expect(decideOnSubject({ key: 'merchant:sky', changed: null, citedText: '', earlier: [], now })).toEqual({ action: 'new' });
  });

  it('folds the second Sky £1.69 note into the first', () => {
    // 10 and 15 October 2026 on prod: the same rise, said twice.
    const d = decideOnSubject({ key: 'merchant:sky', changed: null, citedText: 'SKY £39.69', earlier: [earlier()], now });
    expect(d).toMatchObject({ action: 'fold', into: 'e1' });
  });

  it('folds an expired note too — expiring is not forgetting', () => {
    const d = decideOnSubject({ key: 'merchant:sky', changed: null, citedText: '', earlier: [earlier({ open: false })], now });
    expect(d.action).toBe('fold');
  });

  it('revises when the change has a new figure, archiving only unanswered open notes', () => {
    const d = decideOnSubject({
      key: 'merchant:sky',
      changed: 'a second rise, to £41.50',
      citedText: 'SKY DIGITAL £41.50 2026-11-10',
      earlier: [earlier(), earlier({ id: 'e2', answered: true }), earlier({ id: 'e3', open: false })],
      now,
    });
    expect(d).toEqual({ action: 'revise', figures: ['£41.50'], supersede: ['e1'] });
  });

  it('ignores notes older than the window', () => {
    const d = decideOnSubject({ key: 'merchant:sky', changed: null, citedText: '', earlier: [earlier({ createdAt: hoursAgo(31 * 24) })], now });
    expect(d.action).toBe('new');
  });

  describe('the living plan', () => {
    const plan = (h: number, id = 'p1') => earlier({ id, title: 'Recovery-first week', text: 'Recovery-first week\nrecovery 34%', createdAt: hoursAgo(h) });

    it('is not rewritten within two days, however much changed', () => {
      const d = decideOnSubject({ key: PLAN_SUBJECT, changed: 'recovery is 71% now', citedText: 'recovery 71%', earlier: [plan(20)], now });
      expect(d).toMatchObject({ action: 'fold', into: 'p1' });
    });

    it('is revised after two days when something changed', () => {
      const d = decideOnSubject({ key: PLAN_SUBJECT, changed: 'recovery is 71% now', citedText: 'recovery 71%', earlier: [plan(60)], now });
      expect(d).toEqual({ action: 'revise', figures: ['71%'], supersede: ['p1'] });
    });

    it('folds after two days when nothing did', () => {
      expect(decideOnSubject({ key: PLAN_SUBJECT, changed: null, citedText: '', earlier: [plan(60)], now }).action).toBe('fold');
    });

    it('starts fresh when the last plan is a week old', () => {
      expect(decideOnSubject({ key: PLAN_SUBJECT, changed: null, citedText: '', earlier: [plan(8 * 24)], now }).action).toBe('revise');
    });
  });
});

describe('seen again', () => {
  it('appends a day and keeps the entry done, so a re-proposal keeps it', () => {
    const once = withSeenAgain([{ kind: 'calendar_event', label: 'x', payload: '{}' }], '2026-10-15', now);
    const twice = withSeenAgain(once, '2026-10-16', now);
    expect(readSeenAgain(twice)).toEqual(['2026-10-15', '2026-10-16']);
    expect(twice.filter((a) => a.kind === 'seen_again')).toHaveLength(1);
    expect(twice.find((a) => a.kind === 'seen_again')).toMatchObject({ label: 'Found again 2 times', done: { at: now.toISOString() } });
    expect(twice[0]).toMatchObject({ kind: 'calendar_event' });
  });
});

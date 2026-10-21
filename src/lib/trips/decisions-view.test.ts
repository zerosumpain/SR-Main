import { describe, expect, it } from 'vitest';
import wire from './fixtures/decisions-wire.json';
import type { BriefItem, JobStage, PackPlace, Proposal } from './decisions';
import type { PlanOption } from './options';
import type { PlannedDay } from './model';
import {
  affectedDates,
  affectedStops,
  bestDayFor,
  briefChip,
  changeCard,
  changeDays,
  changeLines,
  changeRow,
  clock,
  compareRows,
  creditLine,
  deadlineText,
  distanceText,
  filterPlaces,
  ghostDays,
  groupHeading,
  groupProposals,
  isOptionCard,
  listText,
  mapDayOf,
  matchesFilter,
  mergeProposals,
  neighbourhoodsOf,
  optionAsProposal,
  placeFacts,
  progressOf,
  startProblem,
  tradeoffChips,
  tripStartFrom,
  versionRows,
  walkDeltaText,
  walkMinText,
} from './decisions-view';

// The shared wire fixture: the same file the server's tests and the app decode.
const proposals = wire.decisions.proposals as unknown as Proposal[];
const swap = proposals.find((p) => p.kind === 'swap')!;
const shape = proposals.find((p) => p.kind === 'shape')!;
const brief = wire.decisions.brief.items as unknown as BriefItem[];
const packPlace = wire.packPlace as unknown as PackPlace;
const stages = wire.job.stages as unknown as JobStage[];

const variant = (over: Omit<Partial<Proposal>, 'tradeoffs'> & { tradeoffs?: Partial<Proposal['tradeoffs']> }): Proposal => ({
  ...swap,
  ...over,
  tradeoffs: { ...swap.tradeoffs, ...(over.tradeoffs ?? {}) },
});

describe('words and numbers', () => {
  it('writes 24-hour clock times and lists as a person would', () => {
    expect(clock(910)).toBe('15:10');
    expect(clock(0)).toBe('00:00');
    expect(clock(1440 + 75)).toBe('01:15');
    expect(clock(null)).toBe('');
    expect(listText(['a'])).toBe('a');
    expect(listText(['a', 'b'])).toBe('a and b');
    expect(listText(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('says walking differences plainly', () => {
    expect(distanceText(850)).toBe('850 m');
    expect(distanceText(-1240)).toBe('1.2 km');
    expect(walkDeltaText(-850)).toBe('850 m less walking');
    expect(walkDeltaText(1200)).toBe('1.2 km more walking');
    expect(walkDeltaText(40)).toBe('About the same walking');
    expect(walkDeltaText(null)).toBeNull();
    expect(walkMinText(-11)).toBe('11 min less walking');
    expect(walkMinText(5)).toBe('5 min more walking');
    expect(walkMinText(0)).toBe('Same walking');
  });

  it('credits a Commons photo with its author and licence', () => {
    expect(creditLine({ credit: 'Jane Smith', license: 'CC BY-SA 4.0' })).toBe('Photo: Jane Smith · CC BY-SA 4.0 · Wikimedia Commons');
    expect(creditLine({ credit: null, license: null })).toBe('Photo · Wikimedia Commons');
  });
});

describe('what changed, before → after', () => {
  it('writes each kind of change as a ledger row', () => {
    const [added, removed] = swap.diff.changes;
    expect(changeRow(added)).toEqual({ kind: 'added', verb: 'Added', title: 'Palazzo Altemps', before: null, after: 'Tue 27 Oct 15:10', reason: null });
    expect(changeRow(removed)).toMatchObject({ verb: 'Taken out', before: 'Tue 27 Oct 15:00', after: 'Taken out' });
    expect(changeRow({ kind: 'moved', wishId: 'w', title: 'Trevi', date: '2026-10-29', fromDate: '2026-10-27', fromMin: 600, toMin: 705, reason: null })).toMatchObject({
      verb: 'Moved',
      before: 'Tue 27 Oct 10:00',
      after: 'Thu 29 Oct 11:45',
    });
    expect(changeRow({ kind: 'retimed', wishId: 'w', title: 'Pantheon', date: '2026-10-27', fromDate: null, fromMin: 600, toMin: 705, reason: null })).toMatchObject({ before: '10:00', after: '11:45' });
    expect(changeRow({ kind: 'dropped', wishId: 'w', title: 'Borghese', date: null, fromDate: '2026-10-28', fromMin: null, toMin: null, reason: 'No time left that day' })).toMatchObject({
      verb: 'Left out',
      before: 'Wed 28 Oct',
      after: 'Left out',
      reason: 'No time left that day',
    });
  });

  it('groups changes by the day they land on, in date order, with dayless ones last', () => {
    const days = changeDays({
      changes: [
        { kind: 'added', wishId: 'a', title: 'A', date: '2026-10-29', fromDate: null, fromMin: null, toMin: 600, reason: null },
        { kind: 'dropped', wishId: 'b', title: 'B', date: null, fromDate: null, fromMin: null, toMin: null, reason: null },
        { kind: 'removed', wishId: 'c', title: 'C', date: null, fromDate: '2026-10-27', fromMin: 900, toMin: null, reason: null },
      ],
    });
    expect(days.map((d) => d.label)).toEqual(['Tue 27 Oct', 'Thu 29 Oct', 'Not on a day']);
  });

  it('builds the card for an action, with the undo the server gave', () => {
    const card = changeCard(1, 'Used: Palazzo Altemps', { planVersion: 13, diff: swap.diff, undo: { toVersion: 12 } });
    expect(card.days).toHaveLength(1);
    expect(card.days[0].rows).toHaveLength(2);
    expect(card.lines).toEqual([]);
    expect(card.walk).toBe('850 m less walking');
    expect(card.undoTo).toBe(12);
  });

  it('undoes to the version before when a response does not say, and not at all when it says null', () => {
    expect(changeCard(1, 'Changed directly', { planVersion: 7, changes: ['Trevi moved to Thu.'] }).undoTo).toBe(6);
    expect(changeCard(1, 'Changed directly', { planVersion: 7, changes: ['No change to the schedule.'] }).undoTo).toBeNull();
    expect(changeCard(1, 'Answered: Carry on', { planVersion: 7, changes: [], diff: null, undo: null, remember: 'We never do early starts' })).toMatchObject({
      undoTo: null,
      remember: 'We never do early starts',
    });
    expect(changeCard(1, 'First', { planVersion: 1, changes: ['First plan.'] }).undoTo).toBeNull();
  });

  it('reads change lines whether they come as strings or a diff', () => {
    expect(changeLines(['A moved.', 'No change to the schedule.', 3])).toEqual(['A moved.']);
    expect(changeLines({ lines: ['B added.'] })).toEqual(['B added.']);
    expect(changeLines(null)).toEqual([]);
  });
});

describe('proposal cards', () => {
  it('turns trade-offs into labelled chips, each saying what it means', () => {
    const chips = tradeoffChips(swap.tradeoffs);
    expect(chips.map((c) => c.label)).toEqual(['15:10–16:25, 12 min walk in', '11 min less walking', '€10 each', 'Indoors', 'Good for children', 'Less visited']);
    expect(chips.find((c) => c.key === 'walk')!.tone).toBe('good');
    const shapeChips = tradeoffChips(shape.tradeoffs).map((c) => c.label);
    expect(shapeChips).toEqual(['6.1 km a day', '2 early starts', '2 to book', 'Good for children', 'Less visited']);
    const costly = tradeoffChips({ ...swap.tradeoffs, fits: false, fitText: null, pushesOut: ['Trevi', 'Pantheon'], moves: [{ title: 'Borghese', from: '2026-10-27', to: '2026-10-29' }] });
    expect(costly.filter((c) => c.tone === 'warn').map((c) => c.label)).toEqual(['Does not fit as the day stands', 'Pushes out Trevi and Pantheon', 'Moves Borghese to Thu 29 Oct']);
  });

  it('compares two proposals and marks only what differs', () => {
    const other = variant({ id: 'x', title: 'Museo Barracco', tradeoffs: { costText: 'Free', walkMin: 4, lessVisited: true } });
    const rows = compareRows(swap, other);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.cost).toMatchObject({ a: '€10 each', b: 'Free', differs: true });
    expect(by.walk).toMatchObject({ a: '11 min less walking', b: '4 min more walking', differs: true });
    expect(by.quiet.differs).toBe(false);
    expect(by.kids.differs).toBe(false);
    // Nothing either side knows is left out; one side missing reads "—".
    expect(by.km).toBeUndefined();
    const leaves = compareRows(shape, variant({ ...shape, id: 'y', shape: { ...shape.shape!, leavesOut: [] } })).find((r) => r.key === 'leaves')!;
    expect(leaves).toMatchObject({ a: 'Borghese Gallery', b: 'Nothing', differs: true });
  });

  it('groups open proposals, keeps shapes apart, and heads each group by what it is for', () => {
    const g = groupProposals([...proposals, variant({ id: 'z', status: 'accepted' })]);
    expect(g.shapes.map((p) => p.id)).toEqual([shape.id]);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].heading).toBe('Instead of Capitoline Museums, Tue 27 Oct');
    expect(groupHeading(variant({ kind: 'fill', scope: { ...swap.scope, stage: 'afternoon' } }))).toBe('For Tue 27 Oct, afternoon');
    expect(groupHeading(variant({ kind: 'day' }))).toBe('Tue 27 Oct, another way');
    expect(groupHeading(variant({ kind: 'change' }))).toBe('Ready for you to approve');
  });

  it('merges by id: local copies win, settled ones and their groups leave', () => {
    const fresh = variant({ title: 'Palazzo Altemps (re-checked)' });
    const extra = variant({ id: 'new', groupId: 'nudge:1' });
    expect(mergeProposals(proposals, [fresh, extra], new Set()).map((p) => p.title)).toEqual(['Palazzo Altemps (re-checked)', shape.title, 'Palazzo Altemps']);
    expect(mergeProposals(proposals, [extra], new Set([`group:${swap.groupId}`])).map((p) => p.id)).toEqual([shape.id, 'new']);
    expect(mergeProposals(proposals, [], new Set([shape.id])).map((p) => p.id)).toEqual([swap.id]);
  });

  it('marks the stops and days a preview touches, and draws a ghost even without solved days', () => {
    expect([...affectedStops(swap)]).toEqual(['b1c2d3e4-0000-4000-8000-000000000301']);
    expect(affectedDates(swap)).toEqual(['2026-10-27']);
    expect(affectedDates(shape)).toHaveLength(5);
    const ghost = ghostDays(swap);
    expect(ghost).toHaveLength(1);
    expect(ghost[0].stops[0]).toMatchObject({ title: 'Palazzo Altemps', n: 1 });
    expect(ghostDays(shape)).toEqual([]);
  });

  it('draws a solved day as the map does: placed wish stops, numbered, legs between placed points', () => {
    const day: PlannedDay = {
      date: '2026-10-27',
      stayId: null,
      warnings: [],
      stops: [
        { id: 'stay:s', kind: 'stay', wishId: null, title: 'Flat', location: { lat: 41.9, lng: 12.47 }, arriveMin: 540, departMin: 540, waitSec: 0, locked: false, bookingId: null, warnings: [] },
        { id: 'w1', kind: 'wish', wishId: 'w1', title: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, arriveMin: 560, departMin: 620, waitSec: 0, locked: false, bookingId: null, warnings: [] },
        { id: 'w2', kind: 'wish', wishId: 'w2', title: 'Nowhere yet', location: null, arriveMin: 640, departMin: 700, waitSec: 0, locked: false, bookingId: null, warnings: [] },
      ],
      legs: [
        { fromStopId: 'stay:s', toStopId: 'w1', mode: 'walk', durationSec: 600, distanceM: 700, line: null, estimated: true } as PlannedDay['legs'][number],
        { fromStopId: 'w1', toStopId: 'w2', mode: 'walk', durationSec: 600, distanceM: 700, line: null, estimated: true } as PlannedDay['legs'][number],
      ],
    };
    const m = mapDayOf(day);
    expect(m.label).toBe('Tue 27 Oct');
    expect(m.stops.map((s) => `${s.n}:${s.title}`)).toEqual(['1:Pantheon']);
    expect(m.legs).toHaveLength(1);
  });

  it('turns a legacy option into a card that adds its wish', () => {
    const o: PlanOption = {
      id: 'o1',
      date: '2026-10-28',
      stage: 'evening',
      title: 'Da Enzo',
      why: 'Trattoria near the flat',
      fit: '19:30–21:00 · 9 min walk in',
      indoor: true,
      kidFriendly: true,
      costText: '€€',
      wish: { title: 'Da Enzo', placeQuery: 'Da Enzo al 29', priority: 'nice', durationMin: 90, partOfDay: 'evening', fixedDate: '2026-10-28', fixedStartMin: null, note: null },
      verdict: { fits: true, arriveMin: 1170, departMin: 1260, landedStage: 'evening', legInMin: 9, legOutMin: 9, legInMode: 'walk', legOutMode: 'walk', pushesOut: [], moves: [], reason: null },
    };
    const p = optionAsProposal(o);
    expect(isOptionCard(p)).toBe(true);
    expect(p).toMatchObject({ kind: 'fill', status: 'open', groupId: 'options:2026-10-28:evening', scope: { date: '2026-10-28', stage: 'evening' } });
    expect(tradeoffChips(p.tradeoffs).map((c) => c.label)).toEqual(['19:30–21:00 · 9 min walk in', '€€', 'Indoors', 'Good for children']);
    expect(groupHeading(p)).toBe('For Wed 28 Oct, evening');
  });
});

describe('the brief', () => {
  it('labels each chip by where it came from, and offers Right / Change on an assumption', () => {
    const by = Object.fromEntries(brief.map((i) => [i.key, briefChip(i)]));
    expect(by.dates).toMatchObject({ originLabel: 'You said', assumed: false, editor: 'dates', canConfirm: false });
    expect(by.travellers).toMatchObject({ originLabel: 'From your notes', editor: 'travellers', canConfirm: true });
    expect(by['meal-times']).toMatchObject({ originLabel: 'Assumed', assumed: true, editor: null, canConfirm: true });
    const stayKey = brief.find((i) => i.kind === 'stay')!.key;
    expect(by[stayKey].editor).toBe('stay');
    // A journey is not edited from the brief; a remembered preference can be taken off.
    expect(briefChip(brief.find((i) => i.kind === 'transport')!).editor).toBeNull();
    expect(briefChip({ ...brief[0], kind: 'preference', origin: 'notes' }).canRemove).toBe(true);
  });
});

describe('questions', () => {
  it('writes a deadline against today, urgent when close', () => {
    expect(deadlineText(null, '2026-10-21')).toBeNull();
    expect(deadlineText('2026-10-30', '2026-10-21')).toEqual({ text: 'Answer by Fri 30 Oct', urgent: false });
    expect(deadlineText('2026-10-23', '2026-10-21')).toEqual({ text: 'Answer by Fri 23 Oct', urgent: true });
    expect(deadlineText('2026-10-22', '2026-10-21')).toEqual({ text: 'Answer by tomorrow', urgent: true });
    expect(deadlineText('2026-10-21', '2026-10-21')).toEqual({ text: 'Answer today', urgent: true });
    expect(deadlineText('2026-10-15', '2026-10-21')).toEqual({ text: 'The deadline was Thu 15 Oct', urgent: true });
  });
});

describe('research progress', () => {
  it('counts what is done and names what is being worked on', () => {
    const p = progressOf(stages);
    expect(p).toMatchObject({ done: 3, total: 5, failed: false });
    expect(p.current?.key).toBe('hours');
    expect(p.summary).toBe('3 of 5 done — checking opening hours on your dates');
    expect(progressOf([]).summary).toBe('Starting');
    const failed = progressOf([{ key: 'a', label: 'A', state: 'failed', detail: null }, { key: 'b', label: 'B', state: 'skipped', detail: null }]);
    expect(failed).toMatchObject({ failed: true, done: 1, current: null, summary: '1 of 2 done' });
  });
});

describe('the research pack browser', () => {
  const places: PackPlace[] = [
    packPlace,
    { ...packPlace, id: 'p2', name: 'Roscioli', kind: 'food', tags: ['lunch'], indoor: true, kidFriendly: null, lessVisited: false, bookingRequired: true, bookAheadDays: 3, neighbourhood: 'Regola' },
    { ...packPlace, id: 'p3', name: 'Villa Borghese', kind: 'park', tags: [], indoor: false, kidFriendly: true, lessVisited: false, status: 'rejected', rejectReason: 'too-far', neighbourhood: 'Pinciano' },
    { ...packPlace, id: 'p4', name: 'Pantheon', kind: 'church', tags: [], indoor: true, kidFriendly: true, lessVisited: false, status: 'planned', neighbourhood: 'Pigna' },
  ];

  it('matches each filter on what it says', () => {
    expect(matchesFilter(places[1], 'food')).toBe(true);
    expect(matchesFilter(places[0], 'rainy')).toBe(true);
    expect(matchesFilter(places[2], 'rainy')).toBe(false);
    expect(matchesFilter(places[1], 'booking')).toBe(true);
    expect(matchesFilter(places[0], 'quiet')).toBe(true);
    expect(matchesFilter(places[1], 'children')).toBe(false);
  });

  it('filters on every chosen filter, puts candidates first, and hides what was turned down', () => {
    expect(filterPlaces(places, { on: [], neighbourhood: null, showRejected: false }).map((p) => p.id)).toEqual([packPlace.id, 'p2', 'p4']);
    expect(filterPlaces(places, { on: ['rainy', 'children'], neighbourhood: null, showRejected: false }).map((p) => p.id)).toEqual([packPlace.id, 'p4']);
    expect(filterPlaces(places, { on: [], neighbourhood: 'Pinciano', showRejected: true }).map((p) => p.id)).toEqual(['p3']);
    expect(filterPlaces(places, { on: [], neighbourhood: null, showRejected: false, hidden: new Set(['p2']) }).map((p) => p.id)).toEqual([packPlace.id, 'p4']);
    expect(neighbourhoodsOf(places)).toEqual(['Parione', 'Pigna', 'Pinciano', 'Regola']);
  });

  it('writes a place’s facts in a line of chips', () => {
    expect(placeFacts(packPlace)).toEqual(['About 75 min', '€10 each', 'Indoors', 'Good for children', 'No booking needed', 'Less visited']);
    expect(placeFacts({ ...places[1], durationMin: 150 })).toContain('About 2.5 hours');
    expect(placeFacts(places[1])).toContain('Book about 3 days ahead');
  });

  it('picks the day whose stops come nearest, a little against full days', () => {
    const at = (lat: number, lng: number) => ({ kind: 'wish' as const, location: { lat, lng } });
    const days = [
      { date: '2026-10-26', stops: [at(41.89, 12.49), at(41.89, 12.492)] },
      { date: '2026-10-27', stops: [at(41.9008, 12.4729)] },
      { date: '2026-10-28', stops: [] },
    ];
    expect(bestDayFor(packPlace.place.location, days)).toBe('2026-10-27');
    expect(bestDayFor(packPlace.place.location, [])).toBeNull();
  });
});

describe('version history', () => {
  it('reads the versions list newest first, with changes as lines and restorable when said', () => {
    const rows = versionRows({
      versions: [
        { version: 11, source: 'site', createdAt: '2026-10-21T12:00:00Z', changes: ['A moved.'], restorable: false },
        { version: 12, source: 'undo', createdAt: '2026-10-21T13:00:00Z', changes: { lines: ['Undone: A moved back.'] }, restorable: true },
        { nonsense: true },
      ],
    });
    expect(rows.map((r) => [r.version, r.restorable, r.lines])).toEqual([
      [12, true, ['Undone: A moved back.']],
      [11, false, ['A moved.']],
    ]);
    expect(versionRows([{ version: 3, source: 'site', createdAt: '', changes: [] }])[0].restorable).toBeNull();
  });
});

describe('the guided start', () => {
  const form = { destination: ' Rome ', startDate: '2026-10-26', endDate: '2026-10-30', travellers: [{ name: ' Sam ', age: 9, personId: 'sam' }, { name: '  ', age: null, personId: null }], pace: 'normal' as const, text: '  ' };

  it('says what is missing before a trip can start', () => {
    expect(startProblem(form)).toBeNull();
    expect(startProblem({ ...form, destination: ' ' })).toBe('Say where you’re going.');
    expect(startProblem({ ...form, endDate: '' })).toBe('Pick the first and the last day.');
    expect(startProblem({ ...form, endDate: '2026-10-25' })).toBe('The last day must be on or after the first.');
    expect(startProblem({ ...form, endDate: '2026-12-30' })).toBe('A trip can be at most 31 days.');
  });

  it('sends the wire’s TripStart: trimmed, empty rows dropped, the ticked notes by id', () => {
    expect(tripStartFrom(form, ['note:stay:1'])).toEqual({
      destination: 'Rome',
      startDate: '2026-10-26',
      endDate: '2026-10-30',
      travellers: [{ name: 'Sam', age: 9, personId: 'sam' }],
      pace: 'normal',
      confirmNotes: ['note:stay:1'],
      text: null,
    });
  });
});

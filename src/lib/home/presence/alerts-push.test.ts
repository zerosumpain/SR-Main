import { describe, it, expect, vi } from 'vitest';

// The departure push: planning is pure, nothing here reaches a database or Apple.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async () => ({ reached: new Set(), sent: 0, failed: 0, muted: 0 }) }));

const { planCrossingPushes, buildPilotEvents, crossingEventPayload, crossedAlongside, DELIVERY_WINDOW_MS } = await import('./alerts');
type AlertEvent = import('./alerts').AlertEvent;
type AlertPlace = import('./alerts').AlertPlace;
type HouseholdMember = import('./members').HouseholdMember;

function member(subject: string, extra: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    subject,
    email: `${subject}@example.test`,
    displayName: subject[0].toUpperCase() + subject.slice(1),
    source: 'companion',
    haPersonEntity: null,
    whatsapp: null,
    alerts: {},
    ...extra,
  };
}

const AT = new Date('2026-09-26T16:52:00Z'); // 17:52 in London (BST)
const NOW = new Date(AT.getTime() + 60_000);

function ev(id: string, extra: Partial<AlertEvent> = {}): AlertEvent {
  return { id, subject: 'sam', placeId: 'school', kind: 'leave', at: AT, forwardedAt: null, whatsappSent: [], ...extra };
}

const PLACES = new Map<string, AlertPlace>([
  ['school', { id: 'school', lat: 51, lon: -1, radiusM: 100, label: 'School', whatsappAlerts: false, isHome: false }],
  ['gym', { id: 'gym', lat: 51.1, lon: -1, radiusM: 100, label: 'Gym', whatsappAlerts: false, isHome: false, alertLeave: false }],
  ['off', { id: 'off', lat: 51.2, lon: -1, radiusM: 100, label: 'Off', whatsappAlerts: false, isHome: false, alerts: false }],
]);
const MEMBERS = [member('sam'), member('alex')];

describe('planCrossingPushes', () => {
  it('pushes a departure from a flagged place to the followers on the app, time-sensitive', () => {
    const [plan, ...rest] = planCrossingPushes([ev('e1')], PLACES, MEMBERS, NOW);
    expect(rest).toEqual([]);
    expect(plan.eventId).toBe('e1');
    expect(plan.recipients).toEqual(['alex@example.test']);
    expect(plan.message).toMatchObject({
      title: 'Sam left School',
      body: 'at 17:52',
      category: 'household',
      level: 'time-sensitive',
      userInfo: { id: 'e1', category: 'household', kind: 'leave', subject: 'sam', url: '/home/people?person=sam' },
    });
  });

  it('pushes an arrival too, as an ordinary (active) alert', () => {
    const [plan, ...rest] = planCrossingPushes([ev('a', { kind: 'arrive' })], PLACES, MEMBERS, NOW);
    expect(rest).toEqual([]);
    expect(plan.recipients).toEqual(['alex@example.test']);
    expect(plan.message).toMatchObject({ title: 'Sam arrived at School', level: 'active', userInfo: { kind: 'arrive', subject: 'sam' } });
  });

  it('never pushes for a place switched off, or a direction switched off', () => {
    const events = [ev('g', { placeId: 'gym' }), ev('o', { placeId: 'off' })];
    expect(planCrossingPushes(events, PLACES, MEMBERS, NOW)).toEqual([]);
  });

  it('skips a quiet mover, an event already delivered, and one past the window', () => {
    expect(planCrossingPushes([ev('e1')], PLACES, MEMBERS, NOW, new Set(['sam']))).toEqual([]);
    expect(planCrossingPushes([ev('e1', { forwardedAt: NOW })], PLACES, MEMBERS, NOW)).toEqual([]);
    const late = new Date(AT.getTime() + DELIVERY_WINDOW_MS + 1);
    expect(planCrossingPushes([ev('e1')], PLACES, MEMBERS, late)).toEqual([]);
  });

  it('does not push anybody twice', () => {
    expect(planCrossingPushes([ev('e1', { pushedTo: ['alex@example.test'] })], PLACES, MEMBERS, NOW)).toEqual([]);
  });

  it('keeps a long crossing id inside Apple\'s 64-byte collapse id', () => {
    const id = `sam:${'p'.repeat(80)}:leave:1790000000`;
    const [plan] = planCrossingPushes([ev(id)], PLACES, MEMBERS, NOW);
    expect(plan.message.collapseId!.length).toBeLessThanOrEqual(64);
  });
});

describe('the pilot after a push', () => {
  it('leaves out whoever a push reached, and marks the event done when that was everyone', () => {
    const pushed = ev('e1', { pushedTo: ['alex@example.test'] });
    const { send, nobody } = buildPilotEvents([pushed], PLACES, MEMBERS);
    expect(send).toEqual([]);
    expect(nobody).toEqual(['e1']);
  });

  it('still queues the followers a push did not reach', () => {
    const members = [...MEMBERS, member('robin')];
    const { send } = buildPilotEvents([ev('e1', { pushedTo: ['alex@example.test'] })], PLACES, members);
    expect(send[0].recipients).toEqual(['robin@example.test']);
  });
});

describe('people who crossed together', () => {
  const members = [...MEMBERS, member('robin')];
  const pair = [ev('e1'), ev('e2', { subject: 'alex', at: new Date(AT.getTime() + 2 * 60_000) })];

  it('finds a follower who made the same crossing within five minutes, and only that crossing', () => {
    expect([...crossedAlongside(pair[0], pair, members)]).toEqual(['alex@example.test']);
    expect(crossedAlongside(pair[0], [pair[0], ev('e2', { subject: 'alex', kind: 'arrive' })], members).size).toBe(0);
    expect(crossedAlongside(pair[0], [pair[0], ev('e2', { subject: 'alex', placeId: 'gym' })], members).size).toBe(0);
    expect(crossedAlongside(pair[0], [pair[0], ev('e2', { subject: 'alex', at: new Date(AT.getTime() + 6 * 60_000) })], members).size).toBe(0);
  });
  it('does not push either of them about the other, and still tells whoever was not there', () => {
    const plans = planCrossingPushes(pair, PLACES, members, NOW);
    expect(plans.map((p) => p.recipients)).toEqual([['robin@example.test'], ['robin@example.test']]);
  });
  it('keeps them out of the pull queue too', () => {
    const { send } = buildPilotEvents(pair, PLACES, members);
    expect(send.map((e) => e.recipients)).toEqual([['robin@example.test'], ['robin@example.test']]);
  });
});

describe('crossingEventPayload', () => {
  it('says who crossed which named place, and nothing of where it is', () => {
    const [plan] = planCrossingPushes([ev('e1')], PLACES, MEMBERS, NOW);
    const payload = crossingEventPayload(ev('e1'), PLACES.get('school'), MEMBERS, plan.message.title);
    expect(payload).toEqual({ kind: 'leave', person: 'Sam', place: 'School', title: 'Sam left School' });
    expect(JSON.stringify(payload)).not.toMatch(/51|-1|radius|example\.test/);
  });

  it('leaves out a place with no name', () => {
    const payload = crossingEventPayload(ev('e2', { kind: 'arrive' }), { label: null as never, isHome: false }, MEMBERS, 'Sam arrived at a place');
    expect(payload).toEqual({ kind: 'arrive', person: 'Sam', title: 'Sam arrived at a place' });
  });
});

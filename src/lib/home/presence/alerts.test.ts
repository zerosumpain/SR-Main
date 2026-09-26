import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pure pieces and the pilot POST only. Nothing here reaches a database.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));

const {
  executeWhatsApp,
  silencedMovers,
  alertText,
  buildPilotEvents,
  isDeliverable,
  maskNumber,
  pilotRecipients,
  planWhatsApp,
  postToPilot,
  whatsappFollowers,
  DELIVERY_WINDOW_MS,
} = await import('./alerts');
type AlertEvent = import('./alerts').AlertEvent;
type AlertPlace = import('./alerts').AlertPlace;
type HouseholdMember = import('./members').HouseholdMember;

// Obviously fake numbers and addresses.
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
const NOW = new Date(AT.getTime() + 5 * 60_000);

function ev(id: string, extra: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id,
    subject: 'sam',
    placeId: 'school',
    kind: 'arrive',
    at: AT,
    forwardedAt: null,
    whatsappSent: [],
    ...extra,
  };
}

const PLACES = new Map<string, AlertPlace>([
  ['school', { id: 'school', lat: 51, lon: -1, radiusM: 100, label: 'School', whatsappAlerts: true, isHome: false }],
  ['club', { id: 'club', lat: 51.1, lon: -1, radiusM: 100, label: 'Club', whatsappAlerts: false, isHome: false }],
  ['home', { id: 'home', lat: 51.2, lon: -1, radiusM: 100, label: null, whatsappAlerts: false, isHome: true }],
]);

describe('alert text', () => {
  it('names the person and place, and says when on the London clock', () => {
    expect(alertText('Sam', 'arrive', 'School', AT)).toEqual({ title: 'Sam arrived at School', body: 'at 17:52' });
    expect(alertText('Sam', 'leave', 'School', AT).title).toBe('Sam left School');
  });

  it('calls an unlabelled home "home"', () => {
    const { send } = buildPilotEvents([ev('e1', { placeId: 'home' })], PLACES, [member('sam'), member('alex')]);
    expect(send[0].title).toBe('Sam arrived at home');
  });
});

describe('recipients', () => {
  const members = [
    member('sam'),
    member('alex'),
    member('robin', { alerts: { follow: ['alex'] } }),
    member('kit', { source: 'life360', email: 'kit@example.test' }),
    member('lee', { email: null }),
  ];

  it('never includes the mover', () => {
    expect(pilotRecipients(members, 'sam')).not.toContain('sam@example.test');
  });

  it('honours follow lists', () => {
    expect(pilotRecipients(members, 'sam')).toEqual(['alex@example.test']);
    expect(pilotRecipients(members, 'alex')).toEqual(['sam@example.test', 'robin@example.test']);
  });

  it('sends app alerts only to members on the app with an email', () => {
    expect(pilotRecipients(members, 'sam')).not.toContain('kit@example.test');
  });

  it('marks events that nobody on the app follows instead of sending them', () => {
    const { send, nobody } = buildPilotEvents([ev('e1')], PLACES, [member('sam')]);
    expect(send).toEqual([]);
    expect(nobody).toEqual(['e1']);
  });
});

describe('WhatsApp', () => {
  const members = [
    member('sam', { whatsapp: '+440000000001', alerts: { whatsapp: true } }),
    member('alex', { whatsapp: '+440000000002', alerts: { whatsapp: true } }),
    member('robin', { whatsapp: '+440000000003' }),
    member('kit', { alerts: { whatsapp: true } }),
    member('lee', { whatsapp: '+440000000005', alerts: { whatsapp: true, follow: ['alex'] } }),
  ];

  it('goes only to followers who switched it on and have a number, never the mover', () => {
    expect(whatsappFollowers(members, 'sam').map((m) => m.subject)).toEqual(['alex']);
  });

  it('is sent only for places flagged for WhatsApp', () => {
    const sends = planWhatsApp([ev('e1'), ev('e2', { placeId: 'club' })], PLACES, members, NOW);
    expect(sends).toEqual([
      { eventId: 'e1', recipient: 'alex', number: '+440000000002', text: 'Sam arrived at School at 17:52' },
    ]);
  });

  it('sends one message per recipient, mover, place and kind in 30 minutes', () => {
    const again = ev('e2', { at: new Date(AT.getTime() + 20 * 60_000) });
    const later = ev('e3', { at: new Date(AT.getTime() + 45 * 60_000) });
    const now = new Date(AT.getTime() + 50 * 60_000);
    // One run sees all three: the second arrival falls inside the first's floor.
    expect(planWhatsApp([ev('e1'), again, later], PLACES, members, now).map((s) => s.eventId)).toEqual(['e1', 'e3']);
  });

  it('still sends "left" straight after "arrived": the floor is per kind', () => {
    const leave = ev('e2', { kind: 'leave', at: new Date(AT.getTime() + 5 * 60_000) });
    const sends = planWhatsApp([ev('e1', { whatsappSent: ['alex'] }), leave], PLACES, members, NOW);
    expect(sends.map((s) => [s.eventId, s.text])).toEqual([['e2', 'Sam left School at 17:57']]);
  });

  it('takes the floor from what was already sent on an earlier run', () => {
    const again = ev('e2', { at: new Date(AT.getTime() + 20 * 60_000) });
    const sent = ev('e1', { whatsappSent: ['alex'] });
    expect(planWhatsApp([sent, again], PLACES, members, NOW)).toEqual([]);
  });

  it('counts an attempt with no recorded outcome as possibly delivered, for the floor too', () => {
    const again = ev('e2', { at: new Date(AT.getTime() + 20 * 60_000) });
    const unsure = ev('e1', { whatsappTried: { alex: { attempts: 1, failed: 0 } } });
    expect(planWhatsApp([unsure, again], PLACES, members, NOW)).toEqual([]);
  });

  it('allows a retry after one definite failure, never after two attempts', () => {
    expect(planWhatsApp([ev('e1', { whatsappTried: { alex: { attempts: 1, failed: 1 } } })], PLACES, members, NOW)).toHaveLength(1);
    expect(planWhatsApp([ev('e1', { whatsappTried: { alex: { attempts: 2, failed: 2 } } })], PLACES, members, NOW)).toEqual([]);
  });

  it('sends nothing about a mover who is silenced', () => {
    expect(planWhatsApp([ev('e1')], PLACES, members, NOW, new Set(['sam']))).toEqual([]);
  });

  it('retries a failed send, but not one already made', () => {
    expect(planWhatsApp([ev('e1')], PLACES, members, NOW)).toHaveLength(1);
    expect(planWhatsApp([ev('e1', { whatsappSent: ['alex'] })], PLACES, members, NOW)).toEqual([]);
  });

  it('does not send a crossing older than the delivery window', () => {
    const late = new Date(AT.getTime() + DELIVERY_WINDOW_MS + 60_000);
    expect(planWhatsApp([ev('e1')], PLACES, members, late)).toEqual([]);
  });

  it('masks a number to its last three digits', () => {
    expect(maskNumber('+440000000123')).toBe('…123');
  });
});

describe('delivery window', () => {
  it('retries an undelivered event under two hours old', () => {
    expect(isDeliverable({ at: AT, forwardedAt: null }, new Date(AT.getTime() + 119 * 60_000))).toBe(true);
  });

  it('leaves an undelivered event older than two hours', () => {
    expect(isDeliverable({ at: AT, forwardedAt: null }, new Date(AT.getTime() + 121 * 60_000))).toBe(false);
  });

  it('never re-sends a delivered event', () => {
    expect(isDeliverable({ at: AT, forwardedAt: NOW }, NOW)).toBe(false);
  });
});

describe('postToPilot', () => {
  const saved = process.env.COMPANION_HOUSEHOLD_TOKEN;
  beforeEach(() => {
    process.env.COMPANION_HOUSEHOLD_TOKEN = 'test-token';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.COMPANION_HOUSEHOLD_TOKEN;
    else process.env.COMPANION_HOUSEHOLD_TOKEN = saved;
  });

  const pilotEv = (id: string) => ({ id, recipients: ['alex@example.test'], title: 't', body: 'b', at: AT.toISOString() });

  it('makes no request without a token', async () => {
    delete process.env.COMPANION_HOUSEHOLD_TOKEN;
    const f = vi.fn();
    expect(await postToPilot([pilotEv('e1')], f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('posts batches of 200 with the bearer token and reports what was accepted', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    const events = Array.from({ length: 201 }, (_, i) => pilotEv(`e${i}`));
    const res = await postToPilot(events, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/apple\/household\/events$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(init.body)).events).toHaveLength(200);
    expect(res?.accepted).toHaveLength(201);
    expect(res?.error).toBeUndefined();
  });

  it('reports a refusal without throwing, so the events stay owed', async () => {
    const f = vi.fn(async () => new Response('no', { status: 503 }));
    const res = await postToPilot([pilotEv('e1')], f as unknown as typeof fetch);
    expect(res).toEqual({ accepted: [], error: 'alert queue answered 503' });
  });

  it('reports an unreachable pilot without throwing', async () => {
    const f = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const res = await postToPilot([pilotEv('e1')], f as unknown as typeof fetch);
    expect(res?.accepted).toEqual([]);
    expect(res?.error).toContain('ECONNREFUSED');
  });
});

describe('WhatsApp attempts across runs', () => {
  const members = [
    member('sam'),
    member('alex', { whatsapp: '+440000000002', alerts: { whatsapp: true } }),
  ];

  /** An in-memory event row the store writes to, the way the database would. */
  function harness(opts: { sentThrows?: boolean } = {}) {
    const row = ev('e1');
    row.whatsappTried = {};
    const bump = (r: string, f: 'attempts' | 'failed') => {
      const t = row.whatsappTried![r] ?? { attempts: 0, failed: 0 };
      row.whatsappTried![r] = { ...t, [f]: t[f] + 1 };
    };
    const store = {
      attempt: async (_: string, r: string) => bump(r, 'attempts'),
      failed: async (_: string, r: string) => bump(r, 'failed'),
      sent: async (_: string, r: string) => {
        if (opts.sentThrows) throw new Error('connection reset');
        row.whatsappSent = [...row.whatsappSent, r];
      },
    };
    const run = (send: (to: string, text: string) => Promise<{ sent: boolean }>) =>
      executeWhatsApp(planWhatsApp([row], PLACES, members, NOW), send, store);
    return { row, run };
  }

  it('stops after two definite failures: no third attempt', async () => {
    const { run } = harness();
    const send = vi.fn(async () => ({ sent: false }));
    await run(send);
    await run(send);
    await run(send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never resends when recording a delivered send fails', async () => {
    const { run } = harness({ sentThrows: true });
    const send = vi.fn(async () => ({ sent: true }));
    const first = await run(send);
    expect(first.sent).toEqual(['…002']);
    await run(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never resends after a send that threw (it may have gone)', async () => {
    const { run } = harness();
    const send = vi.fn(async () => {
      throw new Error('timeout');
    });
    await run(send);
    await run(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send when the attempt cannot be recorded first', async () => {
    const send = vi.fn(async () => ({ sent: true }));
    const store = {
      attempt: async () => {
        throw new Error('db down');
      },
      failed: async () => {},
      sent: async () => {},
    };
    const out = await executeWhatsApp(planWhatsApp([ev('e1')], PLACES, members, NOW), send, store);
    expect(send).not.toHaveBeenCalled();
    expect(out.failed).toEqual(['…002']);
  });
});

describe('silenced movers', () => {
  const members = [
    member('sam'),
    member('alex'),
    member('robin', { source: 'none' }),
    member('kit', { source: 'life360' }),
  ];
  const users = [
    { email: 'sam@example.test', name: 'Sam', sharing: true },
    { email: 'alex@example.test', name: 'Alex', sharing: false },
  ];

  it('silences someone on none, not sharing, or gone from the household', () => {
    const s = silencedMovers([ev('e1', { subject: 'ghost' })], members, users);
    expect([...s].sort()).toEqual(['alex', 'ghost', 'robin']);
  });

  it('fails closed on an unknown users list: every app member is silenced', () => {
    expect(silencedMovers([], members, null).has('sam')).toBe(true);
    expect(silencedMovers([], members, null).has('kit')).toBe(false);
  });

  it('marks a silenced mover\'s events done without sending them to the app', () => {
    const { send, nobody } = buildPilotEvents([ev('e1')], PLACES, [member('sam'), member('alex')], new Set(['sam']));
    expect(send).toEqual([]);
    expect(nobody).toEqual(['e1']);
  });
});

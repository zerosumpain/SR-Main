import { expect, it, vi } from 'vitest';
vi.mock('$lib/db', () => ({ db: {} }));
import { arrivalEvent } from './eta-alerts.server';
import type { HouseholdMember } from './members';
import type { ArrivalInsight } from './insights';
const a: ArrivalInsight = { id: 'alex:12345', subject: 'alex', person: 'Alex', from: 'Sample College', to: 'Home', toId: 'home',
  departedAt: '2026-09-28T07:30Z', observedAt: '2026-09-28T07:35Z', eta: '2026-09-28T07:40Z', earliest: '2026-09-28T07:38Z', latest: '2026-09-28T07:43Z', minutesLeft: 5, samples: 5, confidence: 'emerging', returningHome: true };
const m = (subject: string, follow?: string[]): HouseholdMember => ({ subject, displayName: subject, email: `${subject}@example.test`, source: 'companion', haPersonEntity: null, whatsapp: null, alerts: follow ? { follow } : {} });
it('delivers only to app followers, never the traveller, with a stable journey id', () => {
  const event = arrivalEvent(a, [m('alex'), m('sam'), m('jo', [])]);
  expect(event?.recipients).toEqual(['sam@example.test']);
  expect(event?.title).toContain('likely heading home');
  expect(event?.body).toContain('08:38–08:43');
  expect(event?.body).toContain('5 similar trips');
  expect(arrivalEvent({ ...a, eta: '2026-09-28T07:42Z' }, [m('sam')])?.id).toBe(event?.id);
  expect(arrivalEvent(a, [m('alex'), m('jo', [])])).toBeNull();
});

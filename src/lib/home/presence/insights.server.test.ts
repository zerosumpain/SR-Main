import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseholdMember } from './members';
const h = vi.hoisted(() => ({ users: null as null | Array<{ email: string; sharing: boolean }>, fail: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./members', () => ({ listMembers: async () => [] }));
vi.mock('./companion', async original => ({ ...await original<typeof import('./companion')>(), loadCompanionUsers: async () => { if (h.fail) throw new Error('offline'); return h.users; } }));
const { insightMembers } = await import('./insights.server');
const roster: HouseholdMember[] = ['alex', 'sam', 'jo', 'off'].map(subject => ({ subject, displayName: subject, source: subject === 'off' ? 'none' : subject === 'jo' ? 'life360' : 'companion', email: `${subject}@example.test`, haPersonEntity: null, whatsapp: null, alerts: {} }));
beforeEach(() => { h.users = [{ email: 'alex@example.test', sharing: true }, { email: 'sam@example.test', sharing: false }]; h.fail = false; });
describe('insights scope and sharing', () => {
  it('excludes sharing-off and source-none subjects even for the owner', async () => {
    expect((await insightMembers({ kind: 'owner' }, roster)).map(m => m.subject)).toEqual(['alex', 'jo']);
  });
  it('limits a household viewer to self and wards', async () => {
    expect((await insightMembers({ kind: 'household', subject: 'alex' }, roster)).map(m => m.subject)).toEqual(['alex']);
    expect((await insightMembers({ kind: 'household', subject: 'alex', wards: ['jo'] }, roster)).map(m => m.subject)).toEqual(['alex', 'jo']);
  });
  it('fails closed when sharing cannot be read', async () => {
    h.fail = true;
    expect((await insightMembers({ kind: 'owner' }, roster)).map(m => m.subject)).toEqual(['jo']);
  });
});

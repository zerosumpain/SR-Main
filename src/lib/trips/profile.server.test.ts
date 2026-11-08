import { beforeEach, describe, expect, it, vi } from 'vitest';

// Gathering the profile: owner only, and a member's memories never included.
const h = vi.hoisted(() => ({ saved: [] as unknown[], memberConvs: ['kid-chat'], writes: [] as unknown[] }));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/jkai/memory/retrieve.server', () => ({
  retrieveMemories: async () => [
    { id: 'm1', category: 'preferences', content: 'Prefers walking to taxis', sourceConversationId: 'owner-chat', provenance: { scope: 'personal' } },
    { id: 'm2', category: 'preferences', content: 'Wants to go to Disneyland every holiday', sourceConversationId: 'kid-chat', provenance: { scope: 'personal' } },
  ],
}));
vi.mock('$lib/jkai/memory/service.server', () => ({
  writeMemory: async (input: unknown) => {
    h.writes.push(input);
    return { id: 'new', stored: true };
  },
}));
vi.mock('$lib/knowledge/search', () => ({ searchKnowledge: async () => ({ hits: [] }) }));
vi.mock('$lib/family/roster.server', () => ({ familyRoster: async () => [{ name: 'Sam', email: 'kid@example.test', parent: false }] }));
vi.mock('$lib/db', () => {
  const chain = {
    select: () => chain, from: () => chain,
    where: async () => h.memberConvs.map((id) => ({ id })),
    update: () => chain,
    set: (v: unknown) => ({ where: async () => void h.saved.push(v) }),
  };
  return { db: chain };
});

const { gatherProfile, rememberStated } = await import('./profile.server');
const trip = (ownerEmail: string) => ({ id: 't', ownerEmail, destination: 'Rome', profile: null }) as never;

beforeEach(() => {
  h.saved = [];
  h.writes = [];
});

describe('gatherProfile', () => {
  it('uses the owner’s memories only — never one from a member’s conversation', async () => {
    const p = await gatherProfile(trip('owner@example.test'), { asOwner: true });
    expect(p?.preferences.map((x) => x.text)).toEqual(['Prefers walking to taxis']);
    expect(JSON.stringify(h.saved)).not.toContain('Disneyland');
    expect(p?.travellers.map((t) => t.name)).toEqual(['You', 'Sam']);
  });

  it('refuses a trip whose owner is not the site owner, and any caller who is not the owner', async () => {
    expect(await gatherProfile(trip('kid@example.test'), { asOwner: true })).toBeNull();
    expect(await gatherProfile(trip('owner@example.test'), { asOwner: false })).toBeNull();
    expect(await gatherProfile(trip('owner@example.test'))).toBeNull();
    expect(h.saved).toEqual([]);
  });
});

describe('rememberStated', () => {
  it('writes through writeMemory as a stated user fact sourced to the trip message', async () => {
    await rememberStated({ text: 'We never do early starts', category: 'preferences', messageId: 'msg1', ownerEmail: 'owner@example.test' });
    expect(h.writes).toEqual([
      { category: 'preferences', content: 'We never do early starts', sourceConversationId: null, provenance: { origin: 'user', assertion: 'stated', sourceId: 'trip-message:msg1' } },
    ]);
    await expect(rememberStated({ text: 'x', category: 'preferences', messageId: 'm', ownerEmail: 'kid@example.test' })).rejects.toThrow(/owner/);
  });
});

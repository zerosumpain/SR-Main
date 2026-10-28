import { describe, it, expect } from 'vitest';
import { isAllowedSender, normaliseAllowList, resolveSender } from './sender';

const OWNER = '447700900123';
const allowed = normaliseAllowList([`+44 7700 900123`]);

describe('isAllowedSender', () => {
  it('fails closed on an empty allow-list', () => {
    expect(isAllowedSender(new Set(), OWNER)).toBe(false);
  });

  it('admits a listed number whatever its punctuation', () => {
    expect(isAllowedSender(allowed, OWNER)).toBe(true);
    expect(isAllowedSender(allowed, `+${OWNER}`)).toBe(true);
    expect(isAllowedSender(allowed, `${OWNER}@s.whatsapp.net`)).toBe(true);
  });

  it('refuses an unlisted number, an empty one and a missing one', () => {
    expect(isAllowedSender(allowed, '447700900999')).toBe(false);
    expect(isAllowedSender(allowed, '')).toBe(false);
    expect(isAllowedSender(allowed, null)).toBe(false);
  });
});

describe('resolveSender', () => {
  it('reads a phone JID as its number', async () => {
    expect(await resolveSender({ remoteJid: `${OWNER}@s.whatsapp.net` })).toEqual({ number: OWNER, isLid: false });
  });

  it('resolves a LID through the alternate address WhatsApp sends in the key', async () => {
    const r = await resolveSender({ remoteJid: '123456789012345@lid', remoteJidAlt: `${OWNER}@s.whatsapp.net` });
    expect(r).toEqual({ number: OWNER, isLid: true });
    expect(isAllowedSender(allowed, r.number)).toBe(true);
  });

  it("resolves a LID through the socket's LID map when the key carries no number", async () => {
    const r = await resolveSender({ remoteJid: '123456789012345@lid' }, async () => `${OWNER}@s.whatsapp.net`);
    expect(r.number).toBe(OWNER);
  });

  it('refuses a LID nobody can resolve, instead of waving it through', async () => {
    const r = await resolveSender({ remoteJid: '123456789012345@lid' }, async () => null);
    expect(r).toEqual({ number: null, isLid: true });
    expect(isAllowedSender(allowed, r.number)).toBe(false);
  });

  it('never treats the LID digits themselves as a phone number', async () => {
    // The LID of an allowed sender happens to be in the list as digits: still refused.
    const lidList = normaliseAllowList(['123456789012345']);
    const r = await resolveSender({ remoteJid: '123456789012345@lid' });
    expect(isAllowedSender(lidList, r.number)).toBe(false);
  });

  it('treats a failing LID lookup as unknown', async () => {
    const r = await resolveSender({ remoteJid: '1@lid' }, async () => { throw new Error('store closed'); });
    expect(r.number).toBeNull();
  });
});

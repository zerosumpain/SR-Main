import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  minted: [] as string[],
  live: new Set<string>(),
  ttlMs: 10 * 60_000,
}));

vi.mock('./native-auth', () => {
  const mint = (kind: string) => async (email: string) => {
    const code = `${kind}-${email}-${h.minted.length + 1}`;
    h.minted.push(code);
    h.live.add(code);
    return { code, expiresAt: new Date(NOW.getTime() + h.ttlMs) };
  };
  return {
    createPairingCode: mint('pair'),
    createScanCode: mint('scan'),
    isPairingCodeLive: async (code: string) => h.live.has(code),
  };
});

const NOW = new Date('2026-10-20T09:00:00Z');
const { pairingCode, resetPairingCodes, forgetPairingCode, REUSE_FLOOR_MS } = await import('./pair-codes');

beforeEach(() => {
  h.minted.length = 0;
  h.live.clear();
  h.ttlMs = 10 * 60_000;
  resetPairingCodes();
});

describe('pairingCode', () => {
  it('hands the same live code back to the next asker — the push cannot cancel what the owner just showed', async () => {
    const first = await pairingCode('Rory@Example.test', 'pair', { now: NOW });
    const again = await pairingCode('rory@example.test', 'pair', { now: NOW });
    expect(first.reused).toBe(false);
    expect(again).toEqual({ ...first, reused: true });
    expect(h.minted).toHaveLength(1);
  });

  it('keeps the two kinds apart: a scan code for a person does not replace their pair code', async () => {
    const pair = await pairingCode('rory@example.test', 'pair', { now: NOW });
    const scan = await pairingCode('rory@example.test', 'scan', { now: NOW });
    expect(scan.code).not.toBe(pair.code);
    expect((await pairingCode('rory@example.test', 'pair', { now: NOW })).code).toBe(pair.code);
  });

  it('mints anew once the held code is redeemed or revoked under it', async () => {
    const first = await pairingCode('rory@example.test', 'pair', { now: NOW });
    h.live.delete(first.code);
    const next = await pairingCode('rory@example.test', 'pair', { now: NOW });
    expect(next.reused).toBe(false);
    expect(next.code).not.toBe(first.code);
  });

  it('mints anew when the held code is nearly spent', async () => {
    const first = await pairingCode('rory@example.test', 'pair', { now: NOW });
    const late = new Date(first.expiresAt.getTime() - REUSE_FLOOR_MS + 1);
    expect((await pairingCode('rory@example.test', 'pair', { now: late })).reused).toBe(false);
  });

  it('"New code" means new', async () => {
    const first = await pairingCode('rory@example.test', 'scan', { now: NOW });
    const fresh = await pairingCode('rory@example.test', 'scan', { now: NOW, fresh: true });
    expect(fresh.reused).toBe(false);
    expect(fresh.code).not.toBe(first.code);
  });

  it('forgetting a code stops holding it without touching the database', async () => {
    const first = await pairingCode('rory@example.test', 'pair', { now: NOW });
    forgetPairingCode('rory@example.test', 'pair');
    expect(h.live.has(first.code)).toBe(true);
    expect((await pairingCode('rory@example.test', 'pair', { now: NOW })).reused).toBe(false);
  });

  it('refuses to mint for nobody', async () => {
    await expect(pairingCode('  ', 'pair')).rejects.toThrow();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reply-code step on the real inbound wiring, with the database faked:
 * a bare four-digit message reaches chat untouched unless a code is really
 * open, and the step stands aside entirely where the durable tables are not.
 */
const h = vi.hoisted(() => ({
  tables: true,
  probes: 0,
  gateQueries: 0,
  open: null as Record<string, unknown> | null,
  throwOnGates: false,
}));

vi.mock('$lib/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where']) chain[m] = () => chain;
  chain.limit = async () => [{ id: 'conv-1' }];
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: async () => [] }),
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes('to_regclass')) {
          h.probes++;
          return { rows: [{ present: h.tables }] };
        }
        h.gateQueries++;
        if (h.throwOnGates) throw new Error('relation "jkai_gates" does not exist');
        return { rows: h.open ? [{ payload: h.open }] : [] };
      },
    },
  };
});
vi.mock('$lib/config/owner-number', () => ({ isOwnerNumber: (n: string) => n === '447700900123' }));

const { handleReplyCode, replyCodesAvailable, resetReplyCodeAvailability } = await import('./reply-code.server');

beforeEach(() => {
  Object.assign(h, { tables: true, probes: 0, gateQueries: 0, open: null, throwOnGates: false });
  resetReplyCodeAvailability();
  delete process.env.JKAI_REPLY_CODES;
});

describe('handleReplyCode', () => {
  it('passes a bare 4-digit message through to chat when no code is open', async () => {
    expect(await handleReplyCode('447700900123', '1745')).toEqual({ handled: false });
    expect(h.gateQueries).toBe(1);
  });

  it('stands aside without touching the gates where the durable tables do not exist', async () => {
    h.tables = false;
    h.throwOnGates = true;
    expect(await handleReplyCode('447700900123', '4831')).toEqual({ handled: false });
    expect(h.gateQueries).toBe(0);
  });

  it('caches the table probe', async () => {
    await handleReplyCode('447700900123', 'hello');
    await handleReplyCode('447700900123', '1234');
    expect(h.probes).toBe(1);
    expect(await replyCodesAvailable(Date.now() + 10 * 60_000)).toBe(true);
    expect(h.probes).toBe(2);
  });

  it('stands aside when switched off', async () => {
    process.env.JKAI_REPLY_CODES = 'off';
    expect(await handleReplyCode('447700900123', '4831')).toEqual({ handled: false });
    expect(h.probes).toBe(0);
  });

  it('still holds back a code-shaped message when the tables exist but the lookup fails', async () => {
    h.throwOnGates = true;
    expect(await handleReplyCode('447700900123', '4831')).toMatchObject({ handled: true, reply: expect.stringMatching(/couldn't check/) });
    expect(await handleReplyCode('447700900123', 'what time is it')).toEqual({ handled: false });
  });
});

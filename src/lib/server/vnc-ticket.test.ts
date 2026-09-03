import { describe, expect, it } from 'vitest';
import { issueVncAccessTicket, verifyVncAccessTicket, VNC_ACCESS_TTL_SECONDS } from './vnc-ticket';

describe('VNC access tickets', () => {
  const now = 1_788_472_800_000;

  it('accepts a freshly issued ticket', () => {
    const ticket = issueVncAccessTicket('auth-secret', now);
    expect(verifyVncAccessTicket(ticket, 'auth-secret', now)).toBe(true);
  });

  it('rejects tampering, the wrong key, and expiry', () => {
    const ticket = issueVncAccessTicket('auth-secret', now);
    expect(verifyVncAccessTicket(ticket + '0', 'auth-secret', now)).toBe(false);
    expect(verifyVncAccessTicket(ticket, 'wrong-secret', now)).toBe(false);
    expect(verifyVncAccessTicket(
      ticket,
      'auth-secret',
      now + (VNC_ACCESS_TTL_SECONDS + 1) * 1000,
    )).toBe(false);
  });
});

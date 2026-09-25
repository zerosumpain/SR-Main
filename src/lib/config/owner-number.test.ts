import { describe, expect, it, vi } from 'vitest';

vi.mock('./owner', () => ({ ownerPhone: () => '+447700900123' }));
import { isOwnerNumber } from './owner-number';

describe('isOwnerNumber', () => {
  it('matches the owner however the number is written', () => {
    expect(isOwnerNumber('+447700900123')).toBe(true);
    expect(isOwnerNumber('+44 7700 900123')).toBe(true);
    expect(isOwnerNumber('447700900123@s.whatsapp.net')).toBe(true);
  });

  it('matches nobody else, and not a prefix of the owner', () => {
    expect(isOwnerNumber('+15550001111')).toBe(false);
    expect(isOwnerNumber('+4477009001')).toBe(false);
    expect(isOwnerNumber('')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateApprovalCode,
  parseApprovalReply,
  isApprovalTokenExpired,
  APPROVAL_CODE_ALPHABET,
  APPROVAL_CODE_LENGTH,
  APPROVAL_TOKEN_TTL_MS,
} from './approval-tokens';

describe('generateApprovalCode', () => {
  it('produces a 6-char code drawn only from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateApprovalCode();
      expect(code).toHaveLength(APPROVAL_CODE_LENGTH);
      for (const ch of code) expect(APPROVAL_CODE_ALPHABET).toContain(ch);
    }
  });

  it('excludes the visually confusable characters I, O, 0, 1, L', () => {
    expect(APPROVAL_CODE_ALPHABET).not.toMatch(/[IO01L]/);
  });

  it('is effectively unique across a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateApprovalCode());
    // Collisions in 1000 draws from 31^6 should be vanishingly rare.
    expect(seen.size).toBeGreaterThan(995);
  });
});

describe('parseApprovalReply', () => {
  it('parses APPROVE and its YES alias to the approved verdict', () => {
    expect(parseApprovalReply('approve ABC234')).toEqual({ verdict: 'approved', code: 'ABC234' });
    expect(parseApprovalReply('yes ABC234')).toEqual({ verdict: 'approved', code: 'ABC234' });
  });

  it('parses DENY and its NO alias to the rejected verdict', () => {
    expect(parseApprovalReply('deny XYZ789')).toEqual({ verdict: 'rejected', code: 'XYZ789' });
    expect(parseApprovalReply('no XYZ789')).toEqual({ verdict: 'rejected', code: 'XYZ789' });
  });

  it('is case-insensitive and upper-cases the code', () => {
    expect(parseApprovalReply('APPROVE abc234')).toEqual({ verdict: 'approved', code: 'ABC234' });
    expect(parseApprovalReply('Deny abcdef')).toEqual({ verdict: 'rejected', code: 'ABCDEF' });
  });

  it('tolerates surrounding and internal whitespace', () => {
    expect(parseApprovalReply('   approve    ABC234   ')).toEqual({ verdict: 'approved', code: 'ABC234' });
    expect(parseApprovalReply('\tyes\tABC234\n')).toEqual({ verdict: 'approved', code: 'ABC234' });
  });

  it('returns null for non-approval / malformed messages', () => {
    expect(parseApprovalReply('hello there')).toBeNull();
    expect(parseApprovalReply('approve')).toBeNull();
    expect(parseApprovalReply('approveABC234')).toBeNull(); // no separator
    expect(parseApprovalReply('approve ABC23')).toBeNull(); // 5 chars
    expect(parseApprovalReply('approve ABC2345')).toBeNull(); // 7 chars
    expect(parseApprovalReply('maybe ABC234')).toBeNull(); // unknown verb
    expect(parseApprovalReply('approve ABC-23')).toBeNull(); // non-alnum
    expect(parseApprovalReply('')).toBeNull();
    expect(parseApprovalReply(null)).toBeNull();
    expect(parseApprovalReply(undefined)).toBeNull();
  });
});

describe('isApprovalTokenExpired', () => {
  const now = 1_000_000_000_000;

  it('is false for a future expiry', () => {
    expect(isApprovalTokenExpired(new Date(now + APPROVAL_TOKEN_TTL_MS).toISOString(), now)).toBe(false);
    expect(isApprovalTokenExpired(new Date(now + 1000), now)).toBe(false);
  });

  it('is true for a past or exactly-now expiry', () => {
    expect(isApprovalTokenExpired(new Date(now - 1).toISOString(), now)).toBe(true);
    expect(isApprovalTokenExpired(new Date(now), now)).toBe(true);
  });

  it('fails closed for missing or invalid values', () => {
    expect(isApprovalTokenExpired(undefined, now)).toBe(true);
    expect(isApprovalTokenExpired(null, now)).toBe(true);
    expect(isApprovalTokenExpired('', now)).toBe(true);
    expect(isApprovalTokenExpired('not-a-date', now)).toBe(true);
  });
});

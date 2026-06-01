import { describe, it, expect } from 'vitest';
import { ftsMatchLiteral, isValidSessionId, convIdFromUserId, clampDays } from './hermes-sessions';

describe('hermes-sessions: session id validation (SQL-interp safety)', () => {
  it('accepts the real Hermes id format', () => {
    expect(isValidSessionId('20260601_161404_54636e66')).toBe(true);
  });
  it('rejects anything outside the safe charset', () => {
    expect(isValidSessionId("20260601_161404_54636e66' OR '1'='1")).toBe(false);
    expect(isValidSessionId('../../etc/passwd')).toBe(false);
    expect(isValidSessionId('20260601_161404_ZZZZZZZZ')).toBe(false); // non-hex
    expect(isValidSessionId('20260601_161404_54636e6')).toBe(false); // 7 hex, too short
    expect(isValidSessionId('')).toBe(false);
  });
});

describe('hermes-sessions: conversation correlation', () => {
  it('extracts the jkai conversation id from a session user_id', () => {
    const uid = 'sess_cbeee365-999d-4c0d-aa53-678376576b56_chat_cbeee365-999d-4c0d-aa53-678376576b56';
    expect(convIdFromUserId(uid)).toBe('cbeee365-999d-4c0d-aa53-678376576b56');
  });
  it('returns null for non-jkai / empty user_ids', () => {
    expect(convIdFromUserId(null)).toBeNull();
    expect(convIdFromUserId('')).toBeNull();
    expect(convIdFromUserId('telegram_12345')).toBeNull();
  });
});

describe('hermes-sessions: FTS match literal (injection + FTS safety)', () => {
  it('phrase-wraps a simple query', () => {
    expect(ftsMatchLiteral('calendar')).toBe(`'"calendar"'`);
  });
  it('doubles single-quotes so input can never break out of the SQL literal', () => {
    expect(ftsMatchLiteral("o'brien")).toBe(`'"o''brien"'`);
    expect(ftsMatchLiteral("x' OR 1=1 --")).toBe(`'"x'' OR 1=1 --"'`);
  });
  it('doubles double-quotes so input is a literal FTS phrase, not operators', () => {
    expect(ftsMatchLiteral('say "hi"')).toBe(`'"say ""hi"""'`);
  });
});

describe('hermes-sessions: clampDays (telemetry window)', () => {
  it('clamps to 1..365 and falls back on junk', () => {
    expect(clampDays(30)).toBe(30);
    expect(clampDays('7')).toBe(7);
    expect(clampDays(0)).toBe(30); // falsy → fallback
    expect(clampDays(-5)).toBe(1);
    expect(clampDays(99999)).toBe(365);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays(null)).toBe(30);
    expect(clampDays(undefined)).toBe(30);
  });
});

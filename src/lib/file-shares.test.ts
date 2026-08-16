import { describe, expect, it } from 'vitest';
import {
  SHARE_TTL_DAYS,
  hashShareToken,
  isAgentCreated,
  isLegacyTokenTooOld,
  shareDownloadUrl,
} from './file-shares';

const DAY = 24 * 60 * 60 * 1000;

describe('who may share what', () => {
  // The whole point of the tool restriction: a prompt-injected model must not
  // be able to publish something the owner uploaded.
  it.each([
    'johnkelly.main@gmail.com',
    'john.kelly1@ibca.org.uk',
    'someone@example.com',
  ])('treats the human uploader %s as not agent-created', (uploader) => {
    expect(isAgentCreated(uploader)).toBe(false);
  });

  it.each(['route-export', 'jkai'])('recognises the agent tag %s', (tag) => {
    expect(isAgentCreated(tag)).toBe(true);
  });

  it('fails closed on an unknown or missing uploader', () => {
    expect(isAgentCreated(null)).toBe(false);
    expect(isAgentCreated(undefined)).toBe(false);
    expect(isAgentCreated('')).toBe(false);
    expect(isAgentCreated('webdav')).toBe(false);
  });
});

describe('share links', () => {
  it('points at the public capability endpoint and url-encodes the token', () => {
    expect(shareDownloadUrl('abc-123_x')).toContain('/api/file-shares/abc-123_x/download');
    expect(shareDownloadUrl('a/b')).toContain('/api/file-shares/a%2Fb/download');
  });

  it('never embeds the raw token in its hash', () => {
    const token = 'z'.repeat(43);
    const hash = hashShareToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashShareToken(token)).toBe(hash);
    expect(hashShareToken(`${token}x`)).not.toBe(hash);
  });

  it('defaults to a week', () => {
    expect(SHARE_TTL_DAYS).toBe(7);
  });
});

describe('the legacy immortal-token cap', () => {
  // route_export_token.expires_at is nullable and was never written, so every
  // row in it is a permanent anonymous URL. The cap is applied at read time.
  const now = Date.parse('2026-08-16T17:00:00Z');

  it('still serves a token minted today', () => {
    expect(isLegacyTokenTooOld(new Date(now - 1 * DAY), now)).toBe(false);
  });

  it('stops serving one older than the share lifetime', () => {
    expect(isLegacyTokenTooOld(new Date(now - 8 * DAY), now)).toBe(true);
  });

  it('expires the real production row on schedule', () => {
    // The one live token, created 2026-08-16 16:41:30Z with a null expires_at.
    const created = new Date('2026-08-16T16:41:30Z');
    expect(isLegacyTokenTooOld(created, Date.parse('2026-08-22T00:00:00Z'))).toBe(false);
    expect(isLegacyTokenTooOld(created, Date.parse('2026-08-24T00:00:00Z'))).toBe(true);
  });
});

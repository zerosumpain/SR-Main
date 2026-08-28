import { describe, expect, it } from 'vitest';
import { SHARE_TTL_DAYS, hashShareToken, isAgentCreated, shareDownloadUrl } from './file-shares';

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


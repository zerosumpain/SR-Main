import { describe, expect, it } from 'vitest';
import { redactGitHubSecrets } from './redact';

describe('redactGitHubSecrets', () => {
  it('drops the base64 envelope that redacting the literal string cannot reach', () => {
    const token = 'ghp_secretvalue';
    const envelope = Buffer.from(`git clone https://x-access-token:${token}@github.com/o/r`).toString('base64');
    const message = `Command failed: bash -c "echo '${envelope}' | base64 -d | bash"\nfatal: could not read Username`;
    const safe = redactGitHubSecrets(message, token);
    expect(safe).not.toContain(token);
    expect(safe).not.toContain(envelope);
    expect(safe).toContain('could not read Username');
  });

  it('strips the literal token when it appears on its own', () => {
    expect(redactGitHubSecrets('remote: https://x-access-token:tok123@github.com', 'tok123')).not.toContain('tok123');
  });

  it('scrubs x-access-token credentials without being told the token (the Forge path)', () => {
    expect(redactGitHubSecrets('pushing to https://x-access-token:abc.def@github.com/o/r.git')).toBe(
      'pushing to https://x-access-token:***@github.com/o/r.git',
    );
  });

  it('scrubs anything shaped like a GitHub token (the selfimprove path)', () => {
    const out = redactGitHubSecrets('bad creds ghp_ABCDEFGHIJKLMNOPQRSTUVWX and github_pat_11ABCDEFGHIJKLMNOPQRST_xyz');
    expect(out).not.toMatch(/ghp_|github_pat_/);
    expect(out).toContain('<redacted>');
  });

  it('leaves ordinary git output alone', () => {
    const text = 'error: failed to push some refs to origin\nhint: Updates were rejected (sha 0123456789abcdef0123456789abcdef01234567)';
    expect(redactGitHubSecrets(text)).toBe(text);
  });
});

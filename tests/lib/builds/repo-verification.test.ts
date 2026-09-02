import { describe, expect, it } from 'vitest';
import {
  latestRepoVerification,
  parseRepoVerification,
  verificationIsGreen,
} from '$lib/verification/repo';

const event = (phase: string, status: string, label = phase) =>
  JSON.stringify({ version: 1, phase, status, label });

describe('repo verification events', () => {
  it('accepts the versioned contract and rejects lookalikes', () => {
    expect(parseRepoVerification(event('feedback_gate', 'passed'))?.status).toBe('passed');
    expect(parseRepoVerification(event('feedback_gate', 'reused_failed'))?.status).toBe('reused_failed');
    expect(parseRepoVerification(event('unknown', 'passed'))).toBeNull();
    expect(parseRepoVerification(event('deploy', 'green'))).toBeNull();
    expect(parseRepoVerification('{')).toBeNull();
  });

  it('keeps the newest persisted event per phase', () => {
    const latest = latestRepoVerification([
      { id: 4, type: 'verification', content: event('feedback_gate', 'passed') },
      { id: 2, type: 'verification', content: event('feedback_gate', 'failed') },
      { id: 5, type: 'verification', content: event('release_candidate', 'running') },
      { id: 6, type: 'system', content: event('deploy', 'passed') },
    ]);
    expect(latest.feedback_gate?.status).toBe('passed');
    expect(latest.release_candidate?.status).toBe('running');
    expect(latest.deploy).toBeUndefined();
  });

  it('does not paint a reused failure green', () => {
    expect(verificationIsGreen('passed')).toBe(true);
    expect(verificationIsGreen('reused_passed')).toBe(true);
    expect(verificationIsGreen('failed')).toBe(false);
    expect(verificationIsGreen('reused_failed')).toBe(false);
  });
});

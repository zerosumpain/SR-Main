import { describe, it, expect } from 'vitest';
import { workerRequestAllowed } from './auth';

describe('wa-worker bearer token', () => {
  const token = 'fixture-token-0123456789';

  it.each(['/send', '/send-media', '/qr', '/typing'])('requires the token on %s once it is configured', (path) => {
    expect(workerRequestAllowed(path, undefined, token)).toBe(false);
    expect(workerRequestAllowed(path, 'Bearer wrong', token)).toBe(false);
    expect(workerRequestAllowed(path, token, token)).toBe(false); // scheme is required
    expect(workerRequestAllowed(path, `Bearer ${token}`, token)).toBe(true);
  });

  it('keeps /health open for probes', () => {
    expect(workerRequestAllowed('/health', undefined, token)).toBe(true);
  });

  // Rollout order: callers send the token first, the worker enforces once the
  // variable is set, so merging before it exists cannot stop owner alerts.
  it('does not enforce until WA_WORKER_TOKEN is set', () => {
    expect(workerRequestAllowed('/send', undefined, undefined)).toBe(true);
    expect(workerRequestAllowed('/send', undefined, '')).toBe(true);
  });
});

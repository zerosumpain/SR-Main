import { describe, it, expect, vi } from 'vitest';

// Spy on the real timing-safe comparator so we can assert it is actually used
// (importActual keeps createHash real; only timingSafeEqual is wrapped).
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from 'node:crypto';
import {
  getWebhookSecret,
  secretsMatch,
  isWebhookAuthorized,
  isWebhookSignatureAuthorized,
  webhookSignature,
  WEBHOOK_SECRET_HEADER,
} from './webhook-secret';

describe('getWebhookSecret', () => {
  it('returns "" for null/undefined/non-object triggers', () => {
    expect(getWebhookSecret(null)).toBe('');
    expect(getWebhookSecret(undefined)).toBe('');
    expect(getWebhookSecret({} as any)).toBe('');
  });

  it('reads a top-level secret (trigger PUT route convention)', () => {
    expect(getWebhookSecret({ type: 'webhook', secret: 'abc123' })).toBe('abc123');
  });

  it('reads a nested config.secret (generator deriveTriggerShape convention)', () => {
    expect(getWebhookSecret({ type: 'webhook', config: { secret: 'nested9' } })).toBe('nested9');
  });

  it('prefers the top-level secret when both are present', () => {
    expect(
      getWebhookSecret({ type: 'webhook', secret: 'top', config: { secret: 'nested' } }),
    ).toBe('top');
  });

  it('ignores non-string / empty secrets', () => {
    expect(getWebhookSecret({ type: 'webhook', secret: 42 as any })).toBe('');
    expect(getWebhookSecret({ type: 'webhook', secret: '' })).toBe('');
    expect(getWebhookSecret({ type: 'webhook', config: { secret: '' } })).toBe('');
  });
});

describe('secretsMatch', () => {
  it('matches identical secrets', () => {
    expect(secretsMatch('s3cr3t-value', 's3cr3t-value')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(secretsMatch('aaaaaa', 'bbbbbb')).toBe(false);
  });

  it('rejects a wrong secret of a different length without throwing (length-safe)', () => {
    expect(secretsMatch('short', 'a-considerably-longer-value')).toBe(false);
    expect(secretsMatch('a-considerably-longer-value', 'short')).toBe(false);
  });

  it('rejects null / undefined / empty provided values', () => {
    expect(secretsMatch('configured', null)).toBe(false);
    expect(secretsMatch('configured', undefined)).toBe(false);
    expect(secretsMatch('configured', '')).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    expect(secretsMatch('', 'anything')).toBe(false);
  });

  it('uses a timing-safe comparison (timingSafeEqual invoked)', () => {
    (timingSafeEqual as any).mockClear();
    secretsMatch('abcdef', 'abcdef');
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});

describe('isWebhookAuthorized (route gate matrix)', () => {
  it('no secret configured ⇒ rejected', () => {
    expect(isWebhookAuthorized({ type: 'webhook' }, null)).toBe(false);
    expect(isWebhookAuthorized({ type: 'webhook' }, 'whatever')).toBe(false);
    expect(isWebhookAuthorized({ type: 'webhook', secret: '' }, null)).toBe(false);
  });

  it('secret configured + correct header ⇒ authorised', () => {
    expect(isWebhookAuthorized({ type: 'webhook', secret: 'k3y' }, 'k3y')).toBe(true);
    expect(isWebhookAuthorized({ type: 'webhook', config: { secret: 'k3y' } }, 'k3y')).toBe(true);
  });

  it('secret configured + missing header ⇒ rejected', () => {
    expect(isWebhookAuthorized({ type: 'webhook', secret: 'k3y' }, null)).toBe(false);
    expect(isWebhookAuthorized({ type: 'webhook', secret: 'k3y' }, undefined)).toBe(false);
  });

  it('secret configured + wrong header ⇒ rejected', () => {
    expect(isWebhookAuthorized({ type: 'webhook', secret: 'k3y' }, 'nope')).toBe(false);
  });
});

describe('timestamped webhook signatures', () => {
  const body = '{"payload":true}';
  const timestamp = '1788472800';
  const now = Number(timestamp) * 1000;

  it('accepts an HMAC over timestamp and exact raw body', () => {
    const signature = webhookSignature('k3y', timestamp, body);
    expect(isWebhookSignatureAuthorized(
      { type: 'webhook', secret: 'k3y' }, timestamp, signature, body, now,
    )).toBe(true);
  });

  it('rejects body tampering, stale timestamps, and missing configuration', () => {
    const signature = webhookSignature('k3y', timestamp, body);
    expect(isWebhookSignatureAuthorized(
      { type: 'webhook', secret: 'k3y' }, timestamp, signature, body + ' ', now,
    )).toBe(false);
    expect(isWebhookSignatureAuthorized(
      { type: 'webhook', secret: 'k3y' }, timestamp, signature, body, now + 301_000,
    )).toBe(false);
    expect(isWebhookSignatureAuthorized({ type: 'webhook' }, timestamp, signature, body, now))
      .toBe(false);
  });
});

describe('WEBHOOK_SECRET_HEADER', () => {
  it('is the lower-cased header name', () => {
    expect(WEBHOOK_SECRET_HEADER).toBe('x-webhook-secret');
  });
});

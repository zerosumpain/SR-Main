import { describe, it, expect } from 'vitest';
import { isSecretSettingKey, parseUsageEvent, MAX_USAGE_EVENT_AGE_MS } from './model-service-contract';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const base = {
  id: '3f2a9c1e-8b4d-4e2f-9a1b-0c1d2e3f4a5b',
  occurredAt: '2026-10-02T11:59:00Z',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  tokensInput: 120,
  tokensOutput: 40,
  costUsd: 0.0000196,
};

describe('parseUsageEvent', () => {
  it('accepts a complete event and normalises the time', () => {
    const r = parseUsageEvent({ ...base, source: 'gateway', activity: 'project-chat', ttftMs: 80 }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.occurredAt).toBe('2026-10-02T11:59:00.000Z');
    expect(r.event.activity).toBe('project-chat');
    expect(r.event.cacheReadTokens).toBeNull();
  });

  it('keeps a null cost null — Codex quota is not a measured zero', () => {
    const r = parseUsageEvent({ ...base, provider: 'codex', model: 'gpt-5.6-terra', costUsd: null }, NOW);
    expect(r.ok && r.event.costUsd).toBeNull();
  });

  it('requires cost and token fields to be present, even when null', () => {
    const { costUsd: _c, ...noCost } = base;
    expect(parseUsageEvent(noCost, NOW)).toMatchObject({ ok: false });
    const { tokensOutput: _t, ...noTokens } = base;
    expect(parseUsageEvent(noTokens, NOW)).toMatchObject({ ok: false });
  });

  it.each([
    ['a non-uuid id', { id: 'abc' }],
    ['a negative token count', { tokensInput: -1 }],
    ['a fractional token count', { tokensOutput: 1.5 }],
    ['a string cost', { costUsd: '0.1' }],
    ['a negative cost', { costUsd: -0.01 }],
    ['an empty model', { model: '' }],
    ['a future time', { occurredAt: '2026-10-02T13:00:00Z' }],
    ['an ancient time', { occurredAt: new Date(NOW - MAX_USAGE_EVENT_AGE_MS - 1000).toISOString() }],
    ['an over-long origin', { origin: 'x'.repeat(300) }],
  ])('refuses %s', (_label, patch) => {
    expect(parseUsageEvent({ ...base, ...patch }, NOW).ok).toBe(false);
  });

  it('refuses non-objects', () => {
    expect(parseUsageEvent(null, NOW).ok).toBe(false);
    expect(parseUsageEvent([base], NOW).ok).toBe(false);
  });
});

describe('isSecretSettingKey', () => {
  it('flags credential-shaped keys', () => {
    for (const key of ['openrouter.api_key', 'x.apiKey', 'tavily.secret', 'bridge.token', 'smtp.password']) {
      expect(isSecretSettingKey(key)).toBe(true);
    }
  });
  it('passes model keys', () => {
    for (const key of ['jkai.chat.default_model', 'codex.enabled', 'jkai.routing.assignments']) {
      expect(isSecretSettingKey(key)).toBe(false);
    }
  });
});

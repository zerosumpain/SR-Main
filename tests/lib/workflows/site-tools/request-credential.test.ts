// `request_credential` — the tool that lets jkai ask for a credential it must
// never see.
//
// The assertion that matters is a CANARY test: put a credential-shaped string
// anywhere the model controls, then assert it appears nowhere in what the model
// gets back. Everything else here is scaffolding for that one property.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const outcomes: Array<{ status: string; handle?: string }> = [];
let lastBusKey: string | undefined;
/** Handles already in the registry. Empty by default — this is a CREATE path. */
let existing: Record<string, { handle: string }> = {};

vi.mock('$lib/jkai/tool-step-bus', () => ({
  requestSecretFromUser: vi.fn(async (busKey: string) => {
    lastBusKey = busKey;
    return outcomes.shift() ?? { status: 'unattended' };
  }),
}));

vi.mock('$lib/secrets/registry', () => ({
  getSecretMeta: vi.fn(async (handle: string) => existing[handle] ?? null),
}));

const { handleRequestCredential, specForRequest, looksLikeCredential } = await import(
  '$lib/workflows/site-tools/tools/request-credential'
);

/** Shaped like the TrueLayer secret that actually leaked. */
const CANARY = 'tlcs_live_abcd1234efgh5678ijkl9012mnop3456';

beforeEach(() => {
  outcomes.length = 0;
  lastBusKey = undefined;
  existing = {};
});

describe('argument guard', () => {
  it('REGRESSION: rejects a TrueLayer-shaped secret that hasSensitive would miss', async () => {
    // hasSensitive only knows vendor prefixes (sk-, ghp_, AIza…). This exact
    // shape is the one that leaked on 2026-08-01 and it is NOT in that list —
    // so the local length heuristic is what has to catch it.
    const { hasSensitive } = await import('$lib/security/sensitive');
    expect(hasSensitive(CANARY), 'precondition: hasSensitive misses this').toBe(false);
    expect(looksLikeCredential(CANARY)).toBe(true);

    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: `use this key ${CANARY}` },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(CANARY);
  });

  it('allows an ordinary reason sentence', async () => {
    outcomes.push({ status: 'stored', handle: 'truelayer-oauth' });
    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: 'to read your bank balance for the monthly burn report' },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(true);
  });
});

describe('tool result contains no value-shaped field', () => {
  it('returns only status + binding facts on success', async () => {
    outcomes.push({ status: 'stored', handle: 'truelayer-oauth' });
    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: 'to read your balance' },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    // A fixed allow-list. A new key here is a deliberate decision, not a drift.
    expect(Object.keys(data).sort()).toEqual(
      ['allowedHosts', 'companions', 'handle', 'injection', 'status', 'storeOnly'].sort(),
    );
    // No field that could hold, hint at, or measure the value.
    for (const banned of ['value', 'secret', 'hint', 'length', 'preview', 'last4']) {
      expect(data).not.toHaveProperty(banned);
    }
  });

  it('reports declined / timeout / unattended without inventing detail', async () => {
    for (const status of ['declined', 'timeout', 'unattended'] as const) {
      outcomes.push({ status });
      const res = await handleRequestCredential(
        { provider: 'paypal', reason: 'to list your subscriptions' },
        { emit: () => {}, busKey: 'chat-1' },
      );
      const data = res.data as Record<string, unknown>;
      expect(data.status).toBe(status);
      expect(Object.keys(data).sort()).toEqual(['note', 'status']);
    }
  });
});

describe('provider validation', () => {
  it('refuses an unknown provider rather than passing it through', async () => {
    const res = await handleRequestCredential(
      { provider: 'not-a-real-provider', reason: 'because' },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unknown provider/);
  });

  it('has no parameter that could rebind an existing credential', async () => {
    const mod = await import('$lib/workflows/site-tools/tools/request-credential');
    const params = (mod.default as { parameters: { properties: Record<string, unknown> } }).parameters;
    // upsertSecret rewrites allowedHosts unconditionally, so a handle+hosts
    // parameter pair would let a prompt-injected model re-point an EXISTING
    // credential at a host it controls and read it back via api_call.
    for (const banned of ['handle', 'source', 'refKey', 'allowedHosts', 'injection', 'allowedMethods']) {
      expect(Object.keys(params.properties)).not.toContain(banned);
    }
  });

  it('is not marked destructive — the modal is the human gate', async () => {
    const mod = await import('$lib/workflows/site-tools/tools/request-credential');
    // The MCP destructive gate blocks up to 240s BEFORE the handler runs;
    // stacking it in front of the 180s form wait would exceed Hermes' 300s
    // read timeout and strand the turn before the form appeared.
    expect((mod.default as { destructive?: boolean }).destructive).toBe(false);
  });
});

describe('bindings come from code, not from the model', () => {
  it('truelayer stores a store-only credential set plus a bearer companion', () => {
    const spec = specForRequest({ provider: 'truelayer' })!;
    expect(spec.binding.handle).toBe('truelayer-oauth');
    expect(spec.binding.injection.kind).toBe('none');
    // Must be non-empty: registry.validateHosts rejects an empty host list.
    expect(spec.binding.allowedHosts.length).toBeGreaterThan(0);
    expect(spec.companions?.[0].handle).toBe('truelayer');
    expect(spec.companions?.[0].allowedMethods).toEqual(['GET', 'HEAD']);
  });

  it('sanitises a model-suggested handle instead of trusting it', () => {
    const spec = specForRequest({
      provider: 'custom',
      custom: {
        suggestedHandle: '../../etc/passwd; DROP TABLE',
        suggestedHost: 'api.example.com',
        fields: [{ key: 'api_key', label: 'API key' }],
      },
    })!;
    expect(spec.binding.handle).toMatch(/^[a-z0-9_-]*$/);
    expect(spec.binding.handle).not.toContain('/');
    expect(spec.binding.allowedMethods).toEqual(['GET', 'HEAD']);
  });
});

describe('create only — it cannot overwrite an existing credential', () => {
  it('REGRESSION: a custom handle that collides with a live row is refused, not rebound', async () => {
    // upsertSecret rewrites allowedHosts, allowedMethods and injection
    // unconditionally, and on the `custom` path those come from a MODEL-SUGGESTED
    // host. Before this guard, suggesting a handle that sanitises onto one
    // already in the registry silently re-pointed that credential — the exact
    // attack the tool's no-handle-parameter design exists to prevent, reachable
    // without a handle parameter at all.
    existing['openrouter'] = { handle: 'openrouter' };
    const res = await handleRequestCredential(
      {
        provider: 'custom',
        reason: 'to read your model spend',
        custom: {
          suggestedHandle: 'openrouter',
          suggestedHost: 'evil.example',
          label: 'Model spend',
          fields: [{ key: 'api_key', label: 'API key' }],
        },
      },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already registered/);
    expect(res.error).toMatch(/update_credential/);
    // No form was opened, so the owner was never shown a save button for it.
    expect(lastBusKey).toBeUndefined();
  });

  it('refuses a custom proposal that is really a catalogued provider, by name', async () => {
    // Reaching a live row through a model-suggested handle is not the only way
    // to get this wrong: proposing a service the catalogue already covers means
    // guessing a host and a field list that are already known. Refused before
    // any of that, with the provider to use instead.
    const res = await handleRequestCredential(
      {
        provider: 'custom',
        reason: 'to read your bank balance',
        custom: {
          suggestedHandle: 'tl-bank',
          suggestedHost: 'evil.example',
          label: 'TrueLayer',
          fields: [{ key: 'api_key', label: 'API key' }],
        },
      },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/truelayer/);
    expect(lastBusKey).toBeUndefined();
  });

  it('refuses a catalogued provider whose row already exists', async () => {
    existing['truelayer-oauth'] = { handle: 'truelayer-oauth' };
    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: 'to read your bank balance' },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/update_credential with handle="truelayer-oauth"/);
  });

  it('still creates when the handle is free', async () => {
    outcomes.push({ status: 'stored', handle: 'truelayer-oauth' });
    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: 'to read your bank balance' },
      { emit: () => {}, busKey: 'chat-1' },
    );
    expect(res.success).toBe(true);
    expect((res.data as { status: string }).status).toBe('stored');
  });
});

describe('unattended callers', () => {
  it('reports unattended when no browser is attached', async () => {
    const res = await handleRequestCredential(
      { provider: 'truelayer', reason: 'to read your balance' },
      { emit: () => {} },
    );
    expect((res.data as { status: string }).status).toBe('unattended');
    expect(lastBusKey).toBe('');
  });
});

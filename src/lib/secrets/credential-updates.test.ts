// The logic that decides what a credential UPDATE is allowed to become.
//
// `request_credential` is safe largely by having no dangerous parameters at all.
// An update cannot be built that way — it must name a row, and a rebind must
// name hosts. So the safety lives in these three functions instead, and this
// file is where that is pinned:
//
//   classifyBindingChange    is this proposal reaching somewhere new?
//   buildUpdatePlan          what will actually be written, authored server-side
//   bindingAfterConfirmation what the owner's typing reduces that to

import { describe, it, expect, beforeEach, vi } from 'vitest';

// registry.ts imports $lib/db (postgres) at module load — stub it so the pure
// helpers can be imported without a database.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/secrets/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));

import { classifyBindingChange, type SecretBinding } from './registry';
import { applyBindingDelta, buildUpdatePlan, specByHandle } from './credential-requests';
import {
  bindingAfterConfirmation,
  consumePendingUpdate,
  registerPendingUpdate,
  discardPendingUpdate,
  _resetPendingUpdatesForTests,
  type PendingSecretUpdate,
} from './pending-updates';

const binding = (over: Partial<SecretBinding> = {}): SecretBinding => ({
  allowedHosts: ['api.example.com'],
  allowedMethods: ['GET', 'HEAD'],
  allowedPathPrefixes: [],
  ...over,
});

describe('classifyBindingChange — hosts', () => {
  it('flags a brand-new host as widening', () => {
    const c = classifyBindingChange(binding(), binding({ allowedHosts: ['api.example.com', 'evil.example'] }));
    expect(c.addedHosts).toEqual(['evil.example']);
    expect(c.widensHosts).toBe(true);
    expect(c.widens).toBe(true);
  });

  it('does NOT flag removing a host', () => {
    const c = classifyBindingChange(
      binding({ allowedHosts: ['api.example.com', 'old.example.com'] }),
      binding({ allowedHosts: ['api.example.com'] }),
    );
    expect(c.removedHosts).toEqual(['old.example.com']);
    expect(c.widensHosts).toBe(false);
    expect(c.widens).toBe(false);
  });

  it('treats a host already covered by an existing wildcard as no change', () => {
    const c = classifyBindingChange(
      binding({ allowedHosts: ['*.example.com'] }),
      binding({ allowedHosts: ['*.example.com', 'api.example.com'] }),
    );
    expect(c.addedHosts).toEqual([]);
    expect(c.widensHosts).toBe(false);
  });

  it('REGRESSION: a wildcard is never covered by a concrete host', () => {
    // `*.example.com` reaches strictly more than `api.example.com`, so proposing
    // one where only the other exists MUST require the owner to type it.
    // Getting this backwards would let a model widen a credential to an entire
    // domain with no confirmation.
    const c = classifyBindingChange(
      binding({ allowedHosts: ['api.example.com'] }),
      binding({ allowedHosts: ['*.example.com'] }),
    );
    expect(c.addedHosts).toEqual(['*.example.com']);
    expect(c.widensHosts).toBe(true);
  });

  it('is case- and trailing-dot-insensitive', () => {
    const c = classifyBindingChange(
      binding({ allowedHosts: ['API.Example.com'] }),
      binding({ allowedHosts: ['api.example.com'] }),
    );
    expect(c.addedHosts).toEqual([]);
    expect(c.removedHosts).toEqual([]);
  });
});

describe('classifyBindingChange — methods and paths', () => {
  it('flags an added method as widening, but not as a host widening', () => {
    const c = classifyBindingChange(binding(), binding({ allowedMethods: ['GET', 'HEAD', 'POST'] }));
    expect(c.addedMethods).toEqual(['POST']);
    expect(c.widens).toBe(true);
    expect(c.widensHosts).toBe(false);
  });

  it('treats an empty method list as the GET+HEAD default rather than "none"', () => {
    const c = classifyBindingChange(binding({ allowedMethods: [] }), binding({ allowedMethods: ['GET', 'HEAD'] }));
    expect(c.addedMethods).toEqual([]);
    expect(c.widens).toBe(false);
  });

  it('REGRESSION: dropping every path prefix widens to the whole host', () => {
    // An EMPTY prefix list means "any path". Reading it as "no paths" would
    // score the most permissive possible binding as a narrowing.
    const c = classifyBindingChange(
      binding({ allowedPathPrefixes: ['/v1/reporting'] }),
      binding({ allowedPathPrefixes: [] }),
    );
    expect(c.widens).toBe(true);
    expect(c.removedPathPrefixes).toEqual(['/v1/reporting']);
  });

  it('adding a first path prefix NARROWS, because unscoped meant any path', () => {
    const c = classifyBindingChange(
      binding({ allowedPathPrefixes: [] }),
      binding({ allowedPathPrefixes: ['/v1/reporting'] }),
    );
    expect(c.widens).toBe(false);
  });

  it('a prefix underneath an allowed one narrows; a parent of it widens', () => {
    expect(
      classifyBindingChange(
        binding({ allowedPathPrefixes: ['/data/v1'] }),
        binding({ allowedPathPrefixes: ['/data/v1/accounts'] }),
      ).widens,
    ).toBe(false);
    expect(
      classifyBindingChange(
        binding({ allowedPathPrefixes: ['/data/v1'] }),
        binding({ allowedPathPrefixes: ['/data'] }),
      ).widens,
    ).toBe(true);
  });
});

describe('applyBindingDelta', () => {
  it('adds and removes without disturbing the rest', () => {
    const out = applyBindingDelta(
      binding({ allowedHosts: ['a.example.com', 'b.example.com'], allowedMethods: ['GET'] }),
      { removeHosts: ['b.example.com'], addMethods: ['post'] },
    );
    expect(out.allowedHosts).toEqual(['a.example.com']);
    expect(out.allowedMethods).toEqual(['GET', 'POST']);
  });

  it('normalises case and leading slashes so the diff is honest', () => {
    const out = applyBindingDelta(binding(), {
      addHosts: ['API-V2.Example.com'],
      addPathPrefixes: ['v1/reporting'],
    });
    expect(out.allowedHosts).toContain('api-v2.example.com');
    expect(out.allowedPathPrefixes).toEqual(['/v1/reporting']);
  });

  it('a delta that removes everything leaves an empty host list, which the registry rejects', () => {
    // Fails CLOSED: validateHosts throws on an empty list, so this cannot
    // produce an unbound credential.
    const out = applyBindingDelta(binding(), { removeHosts: ['api.example.com'] });
    expect(out.allowedHosts).toEqual([]);
  });
});

describe('buildUpdatePlan', () => {
  const existing = {
    handle: 'companies-house',
    label: 'Companies House',
    source: 'vault' as const,
    injectionKind: 'header',
    allowedHosts: ['api.company-information.service.gov.uk'],
    allowedMethods: ['GET', 'HEAD'],
    allowedPathPrefixes: [],
  };

  it('a value change on an uncatalogued handle is a single-field rotate', () => {
    const { event, write } = buildUpdatePlan({
      requestId: 'r1',
      existing,
      change: 'value',
      reason: 'the key expired',
    });
    expect(event.mode).toBe('rotate');
    expect(event.fields).toHaveLength(1);
    expect(event.fields[0].required).toBe(true);
    expect(write.requiresTypedHosts).toEqual([]);
    expect(write.binding).toBeUndefined();
  });

  it('a value change on a catalogued credential SET is an amend, every field optional', () => {
    const tl = specByHandle('truelayer-oauth');
    expect(tl, 'precondition: truelayer is catalogued under its vault handle').toBeTruthy();

    const { event, write } = buildUpdatePlan({
      requestId: 'r2',
      existing: { ...existing, handle: 'truelayer-oauth', label: 'TrueLayer' },
      change: 'value',
      reason: 'the refresh token rolled',
    });
    expect(event.mode).toBe('amend');
    // This is the point of the amend mode: rotating one field must not force
    // the owner to re-enter a client_id and client_secret that never changed.
    expect(event.fields.map((f) => f.key)).toEqual(['client_id', 'client_secret', 'refresh_token']);
    expect(event.fields.every((f) => !f.required)).toBe(true);
    expect(event.fields.every((f) => /leave blank/i.test(f.help ?? ''))).toBe(true);
    expect(write.allowedFieldKeys).toEqual(['client_id', 'client_secret', 'refresh_token']);
  });

  it('a rebind carries no value fields at all', () => {
    const { event } = buildUpdatePlan({
      requestId: 'r3',
      existing,
      change: 'binding',
      reason: 'narrowing to reads',
      delta: { removeMethods: ['HEAD'] },
    });
    expect(event.mode).toBe('rebind');
    expect(event.fields).toEqual([]);
    expect(event.requiresTypedHosts).toEqual([]);
  });

  it('a rebind that reaches a new host demands the owner type it', () => {
    const { event, write } = buildUpdatePlan({
      requestId: 'r4',
      existing,
      change: 'binding',
      reason: 'the vendor moved domains',
      delta: { addHosts: ['evil.example'] },
    });
    expect(event.change?.widensHosts).toBe(true);
    expect(event.requiresTypedHosts).toEqual(['evil.example']);
    expect(write.requiresTypedHosts).toEqual(['evil.example']);
    // The proposal is carried so the owner can see it — but the write is gated.
    expect(write.binding?.allowedHosts).toContain('evil.example');
  });

  it('the published event has no field that could hold or measure a value', () => {
    const { event } = buildUpdatePlan({ requestId: 'r5', existing, change: 'value', reason: 'expired' });
    // A fixed allow-list on the payload the browser receives. `fields` describes
    // the INPUTS to render (a key, a label, a type) and carries no data — a new
    // key at this level is a deliberate decision, not drift.
    expect(Object.keys(event).sort()).toEqual(
      ['assemble', 'current', 'fields', 'handle', 'helpUrl', 'kind', 'mode', 'reason', 'requestId', 'requiresTypedHosts', 'title'].sort(),
    );
    for (const banned of ['value', 'secret', 'hint', 'length', 'preview', 'last4', 'payload']) {
      expect(event).not.toHaveProperty(banned);
    }
    const permitted = new Set(['key', 'label', 'type', 'required', 'placeholder', 'help']);
    for (const f of event.fields) {
      expect(Object.keys(f).filter((k) => !permitted.has(k))).toEqual([]);
    }
  });
});

describe('bindingAfterConfirmation — the typed-host gate', () => {
  const plan = (over: Partial<PendingSecretUpdate> = {}): PendingSecretUpdate => ({
    requestId: 'r1',
    handle: 'companies-house',
    mode: 'rebind',
    allowedFieldKeys: [],
    binding: binding({ allowedHosts: ['api.example.com', 'api-v2.example.com'] }),
    requiresTypedHosts: ['api-v2.example.com'],
    expiresAt: Date.now() + 60_000,
    ...over,
  });

  it('keeps a proposed host the owner typed', () => {
    const out = bindingAfterConfirmation(plan(), ['api-v2.example.com']);
    expect(out.allowedHosts).toEqual(['api.example.com', 'api-v2.example.com']);
  });

  it('DROPS a proposed host the owner did not type', () => {
    const out = bindingAfterConfirmation(plan(), []);
    expect(out.allowedHosts).toEqual(['api.example.com']);
  });

  it('REGRESSION: a host the plan never proposed cannot be added by typing it', () => {
    // The result is built from the plan's own binding and only ever filtered, so
    // the browser cannot introduce a destination. This is the property that lets
    // the endpoint accept a request id instead of a host list.
    const out = bindingAfterConfirmation(plan(), ['attacker.example', 'api-v2.example.com']);
    expect(out.allowedHosts).not.toContain('attacker.example');
  });

  it('leaves hosts the credential could already reach alone', () => {
    const out = bindingAfterConfirmation(plan(), []);
    expect(out.allowedHosts).toContain('api.example.com');
  });

  it('accepts a typed host with stray case, spacing or a trailing dot', () => {
    const out = bindingAfterConfirmation(plan(), ['  API-V2.Example.com. ']);
    expect(out.allowedHosts).toContain('api-v2.example.com');
  });

  it('ignores a non-array confirmedHosts instead of trusting it', () => {
    const out = bindingAfterConfirmation(plan(), 'api-v2.example.com');
    expect(out.allowedHosts).toEqual(['api.example.com']);
  });
});

describe('pending plans are single-use and expire', () => {
  beforeEach(() => _resetPendingUpdatesForTests());

  const base = {
    requestId: 'r1',
    handle: 'companies-house',
    mode: 'rotate' as const,
    allowedFieldKeys: ['value'],
    requiresTypedHosts: [],
  };

  it('a second POST with the same request id gets nothing', () => {
    registerPendingUpdate(base, 60_000);
    expect(consumePendingUpdate('r1')).toBeTruthy();
    expect(consumePendingUpdate('r1')).toBeNull();
  });

  it('an unknown request id gets nothing', () => {
    expect(consumePendingUpdate('never-issued')).toBeNull();
  });

  it('an expired plan is not usable', () => {
    registerPendingUpdate(base, -1);
    expect(consumePendingUpdate('r1')).toBeNull();
  });

  it('a declined form leaves no usable write behind', () => {
    registerPendingUpdate(base, 60_000);
    discardPendingUpdate('r1');
    expect(consumePendingUpdate('r1')).toBeNull();
  });
});

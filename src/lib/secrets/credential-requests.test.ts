// What jkai is allowed to ASK the owner for, and what the server writes when
// they answer.
//
// The regression these exist for: `customSpec` had no test at all, and every
// `custom` credential request was unusable in two separate ways — it asked for
// "an API key / token" whatever the service actually needed, and the modal
// posted no host back, so `upsertSecret` refused the save with "a secret must be
// bound to at least one allowed host". Both are covered here.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// credential-requests imports registry.ts for its types AND for
// classifyBindingChange, and registry.ts pulls in $lib/db at module load.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/secrets/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));

import {
  CREDENTIAL_REQUEST_SPECS,
  buildCreatePlan,
  catalogueClaims,
  credentialProviderKeys,
  customSpec,
  describeInjection,
  hostFromEndpoint,
  CredentialSpecError,
} from './credential-requests';
import { composeInjection } from './registry';
import {
  consumePendingCreate,
  registerPendingCreate,
  discardPendingCreate,
  resolveCreateInput,
  _resetPendingCreatesForTests,
} from './pending-creates';

describe('customSpec — asking for what the service actually needs', () => {
  it('refuses to guess when the model does not say what the service issues', () => {
    // The old fallback — one box labelled "API key / token" — is the original
    // bug. A service issuing a key and a secret got asked for a key.
    expect(() => customSpec({ label: 'Some API', suggestedHost: 'api.example.com' })).toThrow(
      /custom\.fields/,
    );
  });

  it('takes a single proposed field as a plain single value', () => {
    const spec = customSpec({
      label: 'Some API',
      suggestedHost: 'api.example.com',
      fields: [{ key: 'api_key', label: 'API key' }],
    });
    expect(spec.fields).toHaveLength(1);
    expect(spec.assemble).toBe('single');
    expect(spec.binding.injection).toEqual({ kind: 'bearer' });
  });

  it('asks for every proposed field, as a set', () => {
    const spec = customSpec({
      label: 'Darwin pub/sub',
      suggestedHost: 'broker.example.com',
      fields: [
        { key: 'group_id', label: 'Consumer group', secret: false },
        { key: 'consumer_key', label: 'Consumer username', secret: false },
        { key: 'consumer_secret', label: 'Consumer password' },
      ],
    });
    expect(spec.fields.map((f) => f.key)).toEqual(['group_id', 'consumer_key', 'consumer_secret']);
    expect(spec.fields.map((f) => f.type)).toEqual(['text', 'text', 'password']);
    expect(spec.assemble).toBe('json');
  });

  it('always leaves the host for the owner to confirm or correct', () => {
    // The whole reason the old path could not save: nothing carried the host
    // back to the server. It is now an editable box on the form.
    const spec = customSpec({ suggestedHost: 'API.Example.COM ', fields: [{ key: 'api_key', label: 'API key' }] });
    expect(spec.binding.hostEditable).toBe(true);
    expect(spec.binding.allowedHosts).toEqual(['api.example.com']);
  });

  it('sanitises field keys and drops duplicates and empties', () => {
    const spec = customSpec({
      fields: [
        { key: 'Consumer Key!', label: 'a' },
        { key: 'consumer_key', label: 'b' },
        { key: '', label: 'c' },
        { key: 'x'.repeat(60), label: 'd' },
      ],
    });
    expect(spec.fields.map((f) => f.key)).toEqual(['consumer_key', 'x'.repeat(32)]);
  });

  it('caps a runaway proposal at 8 fields', () => {
    const spec = customSpec({
      fields: Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, label: `Field ${i}` })),
    });
    expect(spec.fields).toHaveLength(8);
  });

  it('truncates a long label rather than rendering it whole', () => {
    const spec = customSpec({ fields: [{ key: 'k', label: 'L'.repeat(500) }, { key: 'j', label: 'x' }] });
    expect(spec.fields[0].label.length).toBe(48);
  });

  it('stores a set it is not told how to send, rather than guessing', () => {
    const spec = customSpec({
      fields: [{ key: 'user', label: 'User' }, { key: 'pass', label: 'Pass' }],
    });
    expect(spec.binding.injection).toEqual({ kind: 'none' });
  });

  it('sends the named field of a set as a header', () => {
    const spec = customSpec({
      fields: [{ key: 'token', label: 'Token' }, { key: 'topic', label: 'Topic', secret: false }],
      auth: { style: 'header', name: 'x-apikey', field: 'token' },
    });
    expect(spec.binding.injection).toEqual({ kind: 'header', name: 'x-apikey', field: 'token' });
  });

  it('composes Basic from two named fields', () => {
    const spec = customSpec({
      fields: [{ key: 'username', label: 'User' }, { key: 'password', label: 'Pass' }],
      auth: { style: 'basic' },
    });
    expect(spec.binding.injection).toEqual({ kind: 'basic', usernameField: 'username', passwordField: 'password' });
  });

  describe('proposals that do not describe a workable credential', () => {
    it('refuses a multi-field set sent as a bearer token', () => {
      expect(() =>
        customSpec({
          fields: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
          auth: { style: 'bearer' },
        }),
      ).toThrow(CredentialSpecError);
    });

    it('refuses a header style over a set with no field named', () => {
      expect(() =>
        customSpec({
          fields: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
          auth: { style: 'header', name: 'x-api-key' },
        }),
      ).toThrow(/auth\.field/);
    });

    it('refuses a field that is not one of the proposed ones', () => {
      expect(() =>
        customSpec({
          fields: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
          auth: { style: 'header', name: 'x-api-key', field: 'c' },
        }),
      ).toThrow(/not one of the fields/);
    });

    it('refuses Basic without a password field', () => {
      expect(() =>
        customSpec({ fields: [{ key: 'username', label: 'U' }], auth: { style: 'basic' } }),
      ).toThrow(/username and a password/);
    });

    it('refuses a header style with no name', () => {
      expect(() => customSpec({ fields: [{ key: 'api_key', label: 'API key' }], auth: { style: 'header' } })).toThrow(
        /auth\.name/,
      );
    });

    it('refuses an unknown style rather than falling back to bearer', () => {
      expect(() =>
        customSpec({ fields: [{ key: 'api_key', label: 'API key' }], auth: { style: 'magic' } }),
      ).toThrow(/unknown auth\.style/);
    });
  });
});

describe('a catalogued provider claims its own territory', () => {
  it('refuses the exact custom proposal jkai kept making', () => {
    // Verbatim from the 2026-08-16 trace, six minutes after the two-field
    // darwin-ldbws spec went live. Description guidance did not stop it.
    expect(() =>
      customSpec({
        label: 'National Rail Darwin LDBWS — consumer user and password',
        suggestedHandle: 'national-rail-darwin-basic',
        suggestedHost: 'realtime.nationalrail.co.uk',
        fields: [{ key: 'user', label: 'User' }, { key: 'password', label: 'Password' }],
      }),
    ).toThrow(/darwin-ldbws/);
  });

  it('claims a proposal aimed at a host it is already bound to', () => {
    expect(catalogueClaims({ label: 'Some rail thing', suggestedHost: 'api1.raildata.org.uk' })).toBe('darwin-ldbws');
    expect(catalogueClaims({ label: 'Banking', suggestedHost: 'auth.truelayer.com' })).toBe('truelayer');
  });

  it('needs every word of the key, not just one', () => {
    // "darwin" alone is not enough — the two Darwin products are different
    // credentials, and picking the wrong one is the mistake being prevented.
    expect(catalogueClaims({ label: 'Darwin the evolution API', suggestedHost: 'api.evolution.example' })).toBeNull();
  });

  it('leaves a genuinely uncatalogued service alone', () => {
    expect(
      catalogueClaims({ label: 'Companies House', suggestedHost: 'api.company-information.service.gov.uk' }),
    ).toBeNull();
  });
});

describe('the Darwin catalogue entries', () => {
  it('offers both products by name', () => {
    expect(credentialProviderKeys()).toEqual(expect.arrayContaining(['darwin-ldbws', 'darwin-pubsub', 'custom']));
  });

  it('asks for both halves of an RDM subscription and sends only the key', () => {
    // A subscription issues a Consumer key AND a Consumer secret. Asking for
    // one box when the vendor shows two is the bug this whole change exists for.
    const spec = CREDENTIAL_REQUEST_SPECS['darwin-ldbws'];
    expect(spec.fields.map((f) => f.key)).toEqual(['consumer_key', 'consumer_secret']);
    expect(spec.fields.every((f) => f.required)).toBe(true);
    expect(spec.assemble).toBe('json');
    expect(spec.binding.injection).toEqual({ kind: 'header', name: 'x-apikey', field: 'consumer_key' });
    expect(spec.binding.allowedHosts).toEqual(['api1.raildata.org.uk']);
    expect(spec.binding.allowedMethods).toEqual(['GET', 'HEAD']);
  });

  it('sends the key and never the secret', () => {
    const spec = CREDENTIAL_REQUEST_SPECS['darwin-ldbws'];
    const stored = JSON.stringify({ consumer_key: 'ck-live-1234', consumer_secret: 'cs-live-9999' });
    const out = composeInjection(spec.binding.handle, spec.binding.injection, stored);
    expect(out.headers['x-apikey']).toBe('ck-live-1234');
    expect(JSON.stringify(out)).not.toContain('cs-live-9999');
  });

  it('asks for all five pub/sub values and never attaches them to a request', () => {
    const spec = CREDENTIAL_REQUEST_SPECS['darwin-pubsub'];
    expect(spec.fields.map((f) => f.key)).toEqual([
      'bootstrap_servers',
      'consumer_key',
      'consumer_secret',
      'group_id',
      'topic',
    ]);
    expect(spec.assemble).toBe('json');
    expect(spec.binding.injection).toEqual({ kind: 'none' });
    // No code table can know the broker: it is issued per subscription, so the
    // binding comes from what the owner types.
    expect(spec.binding.hostFromField).toBe('bootstrap_servers');
  });
});

describe('hostFromEndpoint', () => {
  it('pulls the host out of whatever shape the vendor shows', () => {
    expect(hostFromEndpoint('pkc-1.europe-west2.gcp.confluent.cloud:9092')).toBe('pkc-1.europe-west2.gcp.confluent.cloud');
    expect(hostFromEndpoint('https://api1.raildata.org.uk/1010-live/LDBWS')).toBe('api1.raildata.org.uk');
    expect(hostFromEndpoint('SASL_SSL://user@Broker.Example.com:9093')).toBe('broker.example.com');
    expect(hostFromEndpoint('a.example.com:9092,b.example.com:9092')).toBe('a.example.com');
    expect(hostFromEndpoint('  api.example.com.  ')).toBe('api.example.com');
  });

  it('returns nothing for input with no host in it', () => {
    expect(hostFromEndpoint('')).toBe('');
    expect(hostFromEndpoint(undefined)).toBe('');
    expect(hostFromEndpoint('/just/a/path')).toBe('');
  });
});

describe('buildCreatePlan', () => {
  const plan = () =>
    buildCreatePlan({
      requestId: 'req-1',
      spec: CREDENTIAL_REQUEST_SPECS['darwin-pubsub'],
      reason: 'to read live train movements',
    });

  it('publishes the fields and the destination, and no value-shaped anything', () => {
    const { event } = plan();
    expect(event.fields.map((f) => f.key)).toContain('consumer_secret');
    expect(event.destination.storeOnly).toBe(true);
    expect(event.destination.hostField).toBe('bootstrap_servers');
    expect(JSON.stringify(event)).not.toMatch(/payload|value"/);
  });

  it('keeps the field list on the write, so the page cannot add one', () => {
    const { write } = plan();
    expect(write.fieldKeys).toContain('topic');
    expect(write.requiredFieldKeys).toContain('topic');
    expect(write.assemble).toBe('json');
  });

  it('trims a long reason before it reaches the owner', () => {
    const { event } = buildCreatePlan({
      requestId: 'r',
      spec: CREDENTIAL_REQUEST_SPECS['darwin-ldbws'],
      reason: 'x'.repeat(500),
    });
    expect(event.reason.length).toBe(200);
  });
});

describe('describeInjection', () => {
  it('says how a credential travels in plain words', () => {
    expect(describeInjection({ kind: 'bearer' })).toBe('Authorization: Bearer');
    expect(describeInjection({ kind: 'header', name: 'x-apikey' })).toBe('header x-apikey');
    expect(describeInjection({ kind: 'header', name: 'x-apikey', field: 'token' })).toContain('the token field');
    expect(describeInjection({ kind: 'basic' })).toContain('HTTP Basic');
    expect(describeInjection({ kind: 'none' })).toContain('stored only');
  });
});

describe('pending creates', () => {
  beforeEach(() => _resetPendingCreatesForTests());

  const write = () => ({ requestId: 'req-1', ...buildCreatePlan({
    requestId: 'req-1',
    spec: CREDENTIAL_REQUEST_SPECS['darwin-ldbws'],
    reason: '',
  }).write });

  it('hands the plan back once and only once', () => {
    registerPendingCreate(write(), 60_000);
    expect(consumePendingCreate('req-1')?.handle).toBe('darwin-ldbws');
    expect(consumePendingCreate('req-1')).toBeNull();
  });

  it('expires with the form', () => {
    registerPendingCreate(write(), -1);
    expect(consumePendingCreate('req-1')).toBeNull();
  });

  it('is gone after a declined form', () => {
    registerPendingCreate(write(), 60_000);
    discardPendingCreate('req-1');
    expect(consumePendingCreate('req-1')).toBeNull();
  });

  it('does not answer to an unknown id', () => {
    registerPendingCreate(write(), 60_000);
    expect(consumePendingCreate('other')).toBeNull();
  });
});

describe('resolveCreateInput — what actually gets written', () => {
  const planFor = (provider: string) =>
    buildCreatePlan({ requestId: 'r', spec: CREDENTIAL_REQUEST_SPECS[provider], reason: '' }).write;

  // Every catalogued provider now issues more than one value, so the
  // single-value path gets a fixture rather than borrowing one of them.
  const singlePlan = () =>
    buildCreatePlan({
      requestId: 'r',
      spec: {
        provider: 'single-fixture',
        title: 'Single-value API',
        assemble: 'single',
        fields: [{ key: 'value', label: 'API key', type: 'password', required: true }],
        binding: {
          handle: 'single-fixture',
          source: 'vault',
          injection: { kind: 'bearer' },
          allowedHosts: ['api.example.com'],
          allowedMethods: ['GET', 'HEAD'],
        },
      },
      reason: '',
    }).write;

  it('stores a single-value credential and keeps the catalogued host', () => {
    const out = resolveCreateInput(singlePlan(), { fields: { value: ' key-123 ' } });
    expect(out.value).toBe('key-123');
    expect(out.allowedHosts).toEqual(['api.example.com']);
  });

  it('accepts a single value posted as `value` too', () => {
    expect(resolveCreateInput(singlePlan(), { value: 'key-123' }).value).toBe('key-123');
  });

  it('stores an RDM key and secret as one set, bound to the gateway', () => {
    const out = resolveCreateInput(planFor('darwin-ldbws'), {
      fields: { consumer_key: 'ck-1', consumer_secret: 'cs-1' },
    });
    expect(JSON.parse(out.value)).toEqual({ consumer_key: 'ck-1', consumer_secret: 'cs-1' });
    expect(out.allowedHosts).toEqual(['api1.raildata.org.uk']);
  });

  it('will not store an RDM subscription with only half of it filled in', () => {
    expect(() => resolveCreateInput(planFor('darwin-ldbws'), { fields: { consumer_key: 'ck-1' } })).toThrow(
      /consumer_secret/,
    );
  });

  it('assembles a field set from exactly the declared keys', () => {
    const out = resolveCreateInput(planFor('darwin-pubsub'), {
      fields: {
        bootstrap_servers: 'pkc-1.example.confluent.cloud:9092',
        consumer_key: 'ck',
        consumer_secret: 'cs',
        group_id: 'g',
        topic: 't',
        // Not in the catalogue — must not reach the stored set.
        smuggled: 'nope',
      },
    });
    const set = JSON.parse(out.value);
    expect(Object.keys(set).sort()).toEqual(['bootstrap_servers', 'consumer_key', 'consumer_secret', 'group_id', 'topic']);
    expect(out.value).not.toContain('smuggled');
  });

  it('binds a pub/sub credential to the broker the owner pasted', () => {
    const out = resolveCreateInput(planFor('darwin-pubsub'), {
      fields: {
        bootstrap_servers: 'PKC-1.Example.confluent.cloud:9092',
        consumer_key: 'ck',
        consumer_secret: 'cs',
        group_id: 'g',
        topic: 't',
      },
    });
    expect(out.allowedHosts).toEqual(['pkc-1.example.confluent.cloud']);
  });

  it('names the fields still empty rather than storing half a credential', () => {
    expect(() =>
      resolveCreateInput(planFor('darwin-pubsub'), { fields: { bootstrap_servers: 'b.example.com:9092' } }),
    ).toThrow(/consumer_key, consumer_secret, group_id, topic/);
  });

  it('refuses a value with nothing in it', () => {
    expect(() => resolveCreateInput(singlePlan(), { fields: {} })).toThrow(/value is required/);
  });

  describe('the custom path — the one that used to fail every time', () => {
    const customPlan = (over: Record<string, unknown> = {}) =>
      buildCreatePlan({
        requestId: 'r',
        spec: customSpec({
          label: 'Some API',
          suggestedHost: 'api.example.com',
          fields: [{ key: 'value', label: 'API key' }],
          ...over,
        }),
        reason: '',
      }).write;

    it('binds to the host the owner left in the box', () => {
      const out = resolveCreateInput(customPlan(), { fields: { value: 'k' }, host: 'api.example.com' });
      expect(out.allowedHosts).toEqual(['api.example.com']);
    });

    it('takes the owner\'s correction over jkai\'s suggestion', () => {
      const out = resolveCreateInput(customPlan({ suggestedHost: 'evil.example' }), {
        fields: { value: 'k' },
        host: 'api.realvendor.com',
      });
      expect(out.allowedHosts).toEqual(['api.realvendor.com']);
    });

    it('refuses to write an unbound credential', () => {
      // The old failure mode, now caught with a message that says what to do
      // instead of "a secret must be bound to at least one allowed host".
      expect(() => resolveCreateInput(customPlan(), { fields: { value: 'k' }, host: '' })).toThrow(
        /API hostname is required/,
      );
    });
  });
});

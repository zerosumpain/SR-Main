// `update_credential` — changing a credential that already exists.
//
// Two properties carry this file. The first is the same canary as its create
// sibling: a credential-shaped string anywhere the model controls must appear
// nowhere in what the model gets back. The second is new and is the whole reason
// an update tool is allowed to take a handle at all — it can name a row, but it
// cannot widen that row's reach on its own say-so.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const outcomes: Array<{ status: string; handle?: string }> = [];
const requests: Array<Record<string, unknown>> = [];
let secrets: Record<string, Record<string, unknown>> = {};

vi.mock('$lib/jkai/tool-step-bus', () => ({
  requestSecretFromUser: vi.fn(async (_busKey: string, req: Record<string, unknown>) => {
    requests.push(req);
    return outcomes.shift() ?? { status: 'unattended' };
  }),
}));

vi.mock('$lib/secrets/registry', () => ({
  getSecretMeta: vi.fn(async (handle: string) => secrets[handle] ?? null),
}));

const { handleUpdateCredential } = await import('$lib/workflows/site-tools/tools/update-credential');

/** Shaped like the TrueLayer secret that actually leaked on 2026-08-01. */
const CANARY = 'tlcs_live_abcd1234efgh5678ijkl9012mnop3456';

const ctx = { emit: () => {}, busKey: 'chat-1' };

const vaultRow = (over: Record<string, unknown> = {}) => ({
  handle: 'companies-house',
  label: 'Companies House',
  source: 'vault',
  injection: { kind: 'header', name: 'Authorization' },
  allowedHosts: ['api.company-information.service.gov.uk'],
  allowedMethods: ['GET', 'HEAD'],
  allowedPathPrefixes: [],
  ...over,
});

beforeEach(() => {
  outcomes.length = 0;
  requests.length = 0;
  secrets = { 'companies-house': vaultRow() };
});

describe('argument guard', () => {
  it('REGRESSION: refuses a call carrying a credential-shaped string', async () => {
    const res = await handleUpdateCredential(
      { handle: 'companies-house', change: 'value', reason: `the new key is ${CANARY}` },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(CANARY);
    // Nothing reached the human channel, so nothing reached the SSE transcript.
    expect(requests).toHaveLength(0);
  });

  it('REGRESSION: a long but perfectly ordinary handle is NOT mistaken for a secret', async () => {
    // `looksLikeCredential` fires on any unbroken 25-character run of
    // [A-Za-z0-9_-]. `normaliseHandle` permits 64 such characters, so scanning
    // the handle rejected legitimate ones outright and made those credentials
    // permanently un-updatable. Caught by probing the DEPLOYED tool with
    // `definitely-not-registered` — exactly 25 characters.
    const long = 'companies-house-production';
    expect(long.length, 'precondition: long enough to trip the heuristic').toBeGreaterThanOrEqual(25);
    secrets[long] = vaultRow({ handle: long });
    outcomes.push({ status: 'declined' });

    const res = await handleUpdateCredential({ handle: long, change: 'value', reason: 'the key expired' }, ctx);
    expect(res.success).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it('still refuses a credential-shaped string in any OTHER argument', async () => {
    const long = 'companies-house-production';
    secrets[long] = vaultRow({ handle: long });
    const res = await handleUpdateCredential(
      { handle: long, change: 'value', reason: `use ${CANARY}` },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(CANARY);
  });

  it('refuses a handle that is not handle-shaped, so a key smuggled there matches nothing', async () => {
    const res = await handleUpdateCredential(
      { handle: 'sk-Live/Key+Value=', change: 'value', reason: 'probe' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not a registry handle/);
    expect(requests).toHaveLength(0);
  });

  it('refuses a credential smuggled through a proposed hostname', async () => {
    const res = await handleUpdateCredential(
      { handle: 'companies-house', change: 'binding', reason: 'vendor moved', binding: { addHosts: [CANARY] } },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(CANARY);
  });
});

describe('it can only change what already exists', () => {
  it('refuses an unknown handle instead of creating one', async () => {
    const res = await handleUpdateCredential(
      { handle: 'not-registered', change: 'value', reason: 'rotating' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no secret registered/);
    expect(res.error).toMatch(/request_credential/);
    expect(requests).toHaveLength(0);
  });

  it('has no parameter that can change injection, source or refKey', async () => {
    const mod = await import('$lib/workflows/site-tools/tools/update-credential');
    const params = (mod.default as { parameters: { properties: Record<string, unknown> } }).parameters;
    // Flipping a store-only credential SET to {kind:'bearer'} would paste an
    // entire client_id + client_secret + refresh_token blob into an
    // Authorization header. There is deliberately no way to ask for that here.
    for (const banned of ['injection', 'source', 'refKey', 'value', 'secret', 'label']) {
      expect(Object.keys(params.properties)).not.toContain(banned);
    }
  });

  it('is not marked destructive — the modal is the human gate', async () => {
    const mod = await import('$lib/workflows/site-tools/tools/update-credential');
    // Same reasoning as request_credential: the 240s destructive banner stacked
    // in front of the 180s form wait would exceed Hermes' 300s read timeout.
    expect((mod.default as { destructive?: boolean }).destructive).toBe(false);
  });
});

describe('ref rows', () => {
  it('refuses to rotate a value that lives in keys.json or an env var', async () => {
    secrets['tavily'] = vaultRow({ handle: 'tavily', source: 'ref', refKey: 'tavily', label: 'Tavily' });
    const res = await handleUpdateCredential({ handle: 'tavily', change: 'value', reason: 'rotating' }, ctx);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('refused');
    expect(String(data.note)).toMatch(/not stored in the registry/);
    // No form was opened: writing one through would materialise a plaintext
    // keys.json, which is gitignored AND outside the backup set.
    expect(requests).toHaveLength(0);
  });

  it('still allows a ref row s binding to be changed', async () => {
    secrets['tavily'] = vaultRow({ handle: 'tavily', source: 'ref', refKey: 'tavily' });
    outcomes.push({ status: 'declined' });
    await handleUpdateCredential(
      { handle: 'tavily', change: 'binding', reason: 'narrowing', binding: { removeMethods: ['HEAD'] } },
      ctx,
    );
    expect(requests).toHaveLength(1);
  });
});

describe('the binding delta is a proposal, not a write', () => {
  it('passes the delta through as a request and never writes it itself', async () => {
    outcomes.push({ status: 'declined' });
    await handleUpdateCredential(
      {
        handle: 'companies-house',
        change: 'binding',
        reason: 'the vendor moved domains',
        binding: { addHosts: ['api-v2.example.com'] },
      },
      ctx,
    );
    // The tool's whole contribution is asking. The row is re-read and the write
    // authored by the gate; nothing here touches the registry.
    expect(requests[0].update).toMatchObject({
      handle: 'companies-house',
      change: 'binding',
      delta: { addHosts: ['api-v2.example.com'] },
    });
  });

  it('rejects an empty binding change rather than opening a pointless form', async () => {
    const res = await handleUpdateCredential(
      { handle: 'companies-house', change: 'binding', reason: 'tidying', binding: {} },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('rejects an unknown change kind', async () => {
    const res = await handleUpdateCredential(
      { handle: 'companies-house', change: 'delete', reason: 'removing' },
      ctx,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/"value" or "binding"/);
  });
});

describe('the tool result carries no value-shaped field', () => {
  it('reports the binding as it ACTUALLY is after the write, not as proposed', async () => {
    outcomes.push({ status: 'stored', handle: 'companies-house' });
    // The owner declined to type the proposed host, so it was dropped. The model
    // must be told the real binding or it will keep calling a host that 403s.
    const res = await handleUpdateCredential(
      {
        handle: 'companies-house',
        change: 'binding',
        reason: 'the vendor moved domains',
        binding: { addHosts: ['api-v2.example.com'] },
      },
      ctx,
    );
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe('updated');
    expect(data.allowedHosts).toEqual(['api.company-information.service.gov.uk']);
    // A fixed allow-list. A new key here is a deliberate decision, not drift.
    expect(Object.keys(data).sort()).toEqual(
      [
        'allowedHosts',
        'allowedMethods',
        'allowedPathPrefixes',
        'change',
        'handle',
        'injection',
        'status',
        'storeOnly',
      ].sort(),
    );
    for (const banned of ['value', 'secret', 'hint', 'length', 'preview', 'last4']) {
      expect(data).not.toHaveProperty(banned);
    }
  });

  it('reports declined / timeout / unattended without inventing detail', async () => {
    for (const status of ['declined', 'timeout', 'unattended'] as const) {
      outcomes.push({ status });
      const res = await handleUpdateCredential(
        { handle: 'companies-house', change: 'value', reason: 'the key expired' },
        ctx,
      );
      const data = res.data as Record<string, unknown>;
      expect(data.status).toBe(status);
      expect(Object.keys(data).sort()).toEqual(['note', 'status']);
    }
  });
});

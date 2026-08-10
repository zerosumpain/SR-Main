// Integration test for the API secret registry + integration register — hits
// the REAL local DB and the REAL OpenRouter account API. Not part of the default
// suite (it needs DATABASE_URL and a configured OpenRouter key). Run explicitly:
//   set -a; source .env; set +a; npx vitest run tests/lib/apis/registry.integration.test.ts
//
// What it proves, in order:
//   1. a credential can be registered and its VALUE never comes back out;
//   2. the owner-set host/path binding refuses every URL the owner did not allow
//      — including the exact exfiltration path a prompt-injected model would try;
//   3. an authenticated call through the catalogue works and leaks nothing;
//   4. the call can be RECORDED as a reusable integration with named outputs;
//   5. write-method integrations refuse to run without explicit confirmation.
//
// It cleans up the integrations it creates so the jkai acceptance test ("how much
// credit is left on my openrouter account") is genuinely performed by the model.
// It deliberately LEAVES the `openrouter` credential registered: adding that is
// the owner action this whole feature is designed around.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  upsertSecret,
  listSecrets,
  getSecretMeta,
  resolveSecretForUrl,
  assertSecretAllowedForUrl,
  deleteSecret,
} from '$lib/secrets/registry';
import { handleApiRegister, handleApiCall, findApiEntry } from '$lib/workflows/site-tools/tools/apis';
import { saveIntegration, callIntegration, deleteIntegration } from '$lib/apis/integrations';
import { runSeeds } from '$lib/selfimprove/seed-apis';
import { getOpenRouterApiKey } from '$lib/server/models/settings';

// Gate on what this file actually needs, not on what is easiest to check. A
// database alone is not enough: everything below reaches OpenRouter, so without
// a resolvable key the whole file fails rather than skips. That is how these
// tests came to have never run in CI at all — they were excluded "for want of a
// database" while also wanting a key nobody knew about.
const RUN =
	!!process.env.DATABASE_URL &&
	(await (async () => {
		try {
			const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
			return !!(await getOpenRouterApiKey());
		} catch {
			return false;
		}
	})());
const d = RUN ? describe : describe.skip;

const DEMO_KEY = 'test-openrouter-credit';
const WRITE_KEY = 'test-write-guard';

let realKey = '';
let apiKey = ''; // catalogue key for the OpenRouter entry

d('API secret registry + integration register (integration)', () => {
  beforeAll(async () => {
    realKey = (await getOpenRouterApiKey()) ?? '';
    await runSeeds();
    await upsertSecret({
      handle: 'openrouter',
      label: 'OpenRouter API key',
      source: 'ref',
      refKey: 'openrouter',
      injection: { kind: 'bearer' },
      allowedHosts: ['openrouter.ai'],
      // Least privilege: this credential can READ the account, not spend it.
      // /api/v1/auth/key is the legacy account endpoint the existing `openrouter`
      // node uses; including it keeps a researching model off a confusing refusal
      // while staying entirely read-only.
      allowedPathPrefixes: ['/api/v1/credits', '/api/v1/key', '/api/v1/auth/key'],
      notes: 'Read-only account endpoints, so jkai can report credit without being able to spend it.',
    });
  }, 60_000);

  afterAll(async () => {
    await deleteIntegration(DEMO_KEY, 'owner').catch(() => {});
    await deleteIntegration(WRITE_KEY, 'owner').catch(() => {});
  });

  it('registers the credential and reports it as available', async () => {
    expect(realKey.length).toBeGreaterThan(10);
    const meta = await getSecretMeta('openrouter');
    expect(meta).not.toBeNull();
    expect(meta!.available).toBe(true);
    expect(meta!.allowedHosts).toEqual(['openrouter.ai']);
  });

  it('never returns the value through the metadata surface', async () => {
    const list = await listSecrets();
    expect(JSON.stringify(list)).not.toContain(realKey);
    for (const s of list) {
      expect(Object.keys(s)).not.toContain('value');
      expect(Object.keys(s)).not.toContain('payloadEnc');
    }
  });

  it('refuses to send the credential anywhere the owner did not allow', async () => {
    // The documented exfiltration path: point a catalogue entry at your own host
    // but reference a real handle.
    await expect(resolveSecretForUrl('openrouter', 'https://evil.example/collect')).rejects.toThrow(/bound to/);
    await expect(resolveSecretForUrl('openrouter', 'https://openrouter.ai.evil.example/x')).rejects.toThrow(/bound to/);
    await expect(resolveSecretForUrl('openrouter', 'https://openrouter.ai@evil.example/x')).rejects.toThrow(/userinfo|bound to/);
    // Sub-domains are not implied by an apex entry.
    await expect(resolveSecretForUrl('openrouter', 'https://api.openrouter.ai/api/v1/credits')).rejects.toThrow(/bound to/);
    // Path scoping means the read-only key cannot be spent on completions.
    await expect(resolveSecretForUrl('openrouter', 'https://openrouter.ai/api/v1/chat/completions')).rejects.toThrow(/scoped to/);
    await expect(resolveSecretForUrl('nope', 'https://openrouter.ai/api/v1/credits')).rejects.toThrow(/no secret registered/);
  });

  it('resolves for the allowed host and path', async () => {
    const resolved = await resolveSecretForUrl('openrouter', 'https://openrouter.ai/api/v1/credits');
    expect(resolved.headers.Authorization).toBe(`Bearer ${realKey}`);
    expect(resolved.plaintexts).toContain(realKey);
  });

  it('is read-only by default: path scoping limits WHERE, allowedMethods limits WHAT', async () => {
    // Without this, api_call could send DELETE to an in-scope path with a
    // credential the register describes as read-only.
    const meta = await getSecretMeta('openrouter');
    expect(meta!.allowedMethods).toEqual(['GET', 'HEAD']);
    await expect(
      resolveSecretForUrl('openrouter', 'https://openrouter.ai/api/v1/credits', 'DELETE'),
    ).rejects.toThrow(/may only authenticate/);
    await expect(
      resolveSecretForUrl('openrouter', 'https://openrouter.ai/api/v1/credits', 'POST'),
    ).rejects.toThrow(/may only authenticate/);
  });

  it('refuses to put a credential on a cleartext connection', async () => {
    await expect(resolveSecretForUrl('openrouter', 'http://openrouter.ai/api/v1/credits')).rejects.toThrow(
      /only sent over https/,
    );
  });

  it('refuses an encoded path separator, which would defeat segment-boundary scoping', async () => {
    await expect(
      resolveSecretForUrl('openrouter', 'https://openrouter.ai/api/v1/credits%2f..%2fchat/completions'),
    ).rejects.toThrow(/encoded separator/);
  });

  it('re-checks the binding per redirect hop, so path scoping is not a one-hop guarantee', async () => {
    // guardedFetch calls this for every hop that still carries the credential.
    // A same-origin 302 from an in-scope path to an out-of-scope one must fail.
    await expect(
      assertSecretAllowedForUrl('openrouter', 'https://openrouter.ai/api/v1/credits'),
    ).resolves.toBeUndefined();
    await expect(
      assertSecretAllowedForUrl('openrouter', 'https://openrouter.ai/api/v1/chat/completions'),
    ).rejects.toThrow(/scoped to/);
    await expect(
      assertSecretAllowedForUrl('openrouter', 'https://evil.example/api/v1/credits'),
    ).rejects.toThrow(/bound to/);
  });

  it('refuses a catalogue entry that points a real handle at a foreign host', async () => {
    const res = await handleApiRegister({
      entry: {
        name: 'Exfil Test',
        baseUrl: 'https://example.com',
        auth: { kind: 'secret', handle: 'openrouter' },
      },
    });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/cannot be used for example\.com/);
  });

  it('makes an authenticated call through the catalogue without leaking the key', async () => {
    const reg = await handleApiRegister({
      entry: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        docsUrl: 'https://openrouter.ai/docs/api-reference/get-credits',
        description: 'OpenRouter account, usage and model routing API.',
        capabilities: ['account credit balance', 'usage', 'model list'],
        tags: ['llm', 'openrouter', 'billing'],
        auth: { kind: 'secret', handle: 'openrouter' },
      },
    });
    expect(reg.success).toBe(true);

    const entry = await findApiEntry('openrouter');
    expect(entry).not.toBeNull();
    apiKey = entry!.key;

    const call = await handleApiCall({ api: apiKey, url: 'https://openrouter.ai/api/v1/credits' });
    expect(call.success).toBe(true);
    const data = call.data as { status: number; json: { data: { total_credits: number; total_usage: number } } };
    expect(data.status).toBe(200);
    expect(typeof data.json.data.total_credits).toBe('number');
    expect(JSON.stringify(call)).not.toContain(realKey);
  }, 30_000);

  it('records the call as a reusable integration with named outputs', async () => {
    const saved = await saveIntegration(
      {
        name: 'OpenRouter credit balance (test)',
        key: DEMO_KEY,
        description: 'Remaining prepaid credit on the OpenRouter account.',
        api: apiKey,
        method: 'GET',
        path: '/credits',
        outputs: [
          { name: 'total', expr: 'json.data.total_credits', unit: 'USD' },
          { name: 'used', expr: 'json.data.total_usage', unit: 'USD' },
          { name: 'remaining', expr: 'json.data.total_credits - json.data.total_usage', unit: 'USD' },
        ],
      },
      'owner',
    );
    // A fresh save is untested, so it must not claim to be verified.
    expect(saved.status).toBe('draft');

    const run = await callIntegration({ key: DEMO_KEY });
    expect(run.success).toBe(true);
    expect(typeof run.values.remaining).toBe('number');
    expect(run.values.remaining).toBeCloseTo(
      (run.values.total as number) - (run.values.used as number),
      6,
    );
    expect(JSON.stringify(run)).not.toContain(realKey);

    // A passing call records the evidence that the register surfaces.
    const after = await callIntegration({ key: DEMO_KEY });
    expect(after.success).toBe(true);
  }, 30_000);

  it('rejects an output expression that tries to escape the evaluator', async () => {
    await expect(
      saveIntegration(
        {
          name: 'Bad output',
          key: 'test-bad-output',
          api: apiKey,
          method: 'GET',
          path: '/credits',
          outputs: [{ name: 'pwn', expr: 'json.constructor.constructor("return process")()' }],
        },
        'owner',
      ),
    ).rejects.toThrow(/invalid expression|Blocked unsafe/);
  });

  it('refuses a write integration until it is explicitly confirmed', async () => {
    await saveIntegration(
      { name: 'Write guard (test)', key: WRITE_KEY, api: apiKey, method: 'POST', path: '/credits' },
      'owner',
    );
    await expect(callIntegration({ key: WRITE_KEY })).rejects.toThrow(/confirmWrite/);
  });

  it('refuses to inject a store-only credential set, whatever the URL', async () => {
    // A multi-field credential SET (client_id + client_secret + refresh_token)
    // is held for one server module to read, never attached to a request. Before
    // {kind:'none'} existed such a row had to claim some injection, and
    // {kind:'bearer'} would have pasted the entire JSON blob into an
    // Authorization header for any caller that resolved it.
    await upsertSecret({
      handle: 'test-store-only',
      source: 'vault',
      value: JSON.stringify({ client_id: 'a', client_secret: 'b' }),
      injection: { kind: 'none' },
      allowedHosts: ['auth.example.com'],
      allowedMethods: ['POST'],
      allowedPathPrefixes: [],
    });
    // Even on its OWN allowed host and method, it refuses.
    await expect(
      resolveSecretForUrl('test-store-only', 'https://auth.example.com/token', 'POST'),
    ).rejects.toThrow(/store-only/);
    await expect(
      assertSecretAllowedForUrl('test-store-only', 'https://auth.example.com/token', 'POST'),
    ).rejects.toThrow(/store-only/);
    await deleteSecret('test-store-only');
  });

  it('still requires a host binding on a store-only row', async () => {
    // The binding stays mandatory: $lib/secrets/oauth-refresh checks the token
    // endpoint against it before sending the client_secret anywhere.
    await expect(
      upsertSecret({
        handle: 'test-store-only-nohost',
        source: 'vault',
        value: 'x',
        injection: { kind: 'none' },
        allowedHosts: [],
        allowedMethods: [],
        allowedPathPrefixes: [],
      }),
    ).rejects.toThrow(/at least one allowed host/);
  });
});

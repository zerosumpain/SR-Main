/**
 * Live end-to-end check of the SITE's own routing to Codex.
 *
 * Everything else in the Codex test suite is pure — this is the one that proves
 * the link the unit tests cannot: that a `codex/*` ModelContext handed to the
 * real `getLLMClient` comes back pointed at the bridge, and that a completion
 * through it returns a real answer billed to the subscription.
 *
 * Excluded from the merge gate (`*.integration.test.ts`), because it needs a
 * running, logged-in bridge. Run it deliberately:
 *
 *   npx vitest run src/lib/server/models/codex-live.integration.test.ts
 *
 * Skips itself rather than failing when no bridge is reachable, so it is safe
 * to run anywhere.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getLLMClient } from '$lib/llm/client';
import { getCodexBridgeUrl } from '$lib/server/models/settings';
import { coerceModelContext } from '$lib/constants/default-models';

let bridgeReady = false;

/** Is an OpenRouter key resolvable? Separate from the bridge — one case here
 *  needs a key rather than a bridge, and conflating the two is what left it
 *  unguarded. */
async function hasOpenRouterKey(): Promise<boolean> {
  try {
    const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
    return !!(await getOpenRouterApiKey());
  } catch {
    return false;
  }
}

beforeAll(async () => {
  try {
    const res = await fetch(`${getCodexBridgeUrl()}/health`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json();
    bridgeReady = body?.ok === true;
  } catch {
    bridgeReady = false;
  }
});

describe('site → Codex bridge, live', () => {
  it('routes a codex/* context to the bridge, not OpenRouter', async (t) => {
    if (!bridgeReady) return t.skip();
    const ctx = coerceModelContext({ modelId: 'codex/gpt-5.6-luna' });
    expect(ctx.provider).toBe('codex');

    const { client, model } = await getLLMClient(ctx);
    // The bare slug is what the bridge expects; the `codex/` prefix is our own
    // namespacing and must not leak into the request.
    expect(model).toBe('gpt-5.6-luna');
    expect(String(client.baseURL)).toContain('5207');
    expect(String(client.baseURL)).not.toContain('openrouter');
  });

  it('completes a real turn through the site gateway', async (t) => {
    if (!bridgeReady) return t.skip();
    const { client, model } = await getLLMClient(
      coerceModelContext({ modelId: 'codex/gpt-5.6-luna' }),
    );
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Answer with one word only.' },
        { role: 'user', content: 'What colour is a ripe banana?' },
      ],
    });
    const text = res.choices[0]?.message?.content ?? '';
    expect(text.toLowerCase()).toContain('yellow');
    // Usage must survive the translation — it feeds the cost ledger.
    expect(res.usage?.prompt_tokens).toBeGreaterThan(0);
  }, 180_000);

  // This one asserts routing rather than a completion, but it still has to
  // CONSTRUCT an OpenRouter client, which needs a key. It was the only case in
  // this file without a guard, so on a runner with neither a bridge nor a key it
  // failed while its two neighbours skipped — see issue #182.
  it('still routes an OpenRouter id to OpenRouter', async (t) => {
    if (!(await hasOpenRouterKey())) return t.skip();
    const { client } = await getLLMClient(
      coerceModelContext({ modelId: 'deepseek/deepseek-v4-flash' }),
    );
    expect(String(client.baseURL)).toContain('openrouter');
  });
});

/**
 * Discovery's two live dependencies: the model list read as the latest client,
 * and the probe that decides whether a listed model is offered. These are the
 * answers measured by hand on 2026-09-25, so a change in how the API refuses a
 * model shows up here rather than as a model silently never being offered.
 */
describe('Codex model discovery, live', () => {
  it('reads the model list as the latest client', async (t) => {
    const { fetchCodexCatalogue, latestCodexClientVersion } = await import('./codex-discovery');
    const rows = await fetchCodexCatalogue(await latestCodexClientVersion());
    if (!rows) return t.skip();
    // gpt-6-sol needs client 0.155.0; asking as our pinned SDK would hide it.
    expect(rows.map((r) => r.slug)).toContain('gpt-6-sol');
  }, 30_000);

  it('finds max on a model that takes it, xhigh on one that refuses it by name', async (t) => {
    if (!bridgeReady) return t.skip();
    const { probeCodexModel } = await import('./codex-discovery');
    expect(await probeCodexModel('gpt-6-luna')).toEqual({ ok: true, effortCeiling: 'max' });
    expect(await probeCodexModel('gpt-5.5')).toEqual({ ok: true, effortCeiling: 'xhigh' });
  }, 240_000);

  it('rejects a model the subscription cannot run', async (t) => {
    if (!bridgeReady) return t.skip();
    const { probeCodexModel } = await import('./codex-discovery');
    const result = await probeCodexModel('gpt-6-terra');
    expect(result.ok).toBe(false);
  }, 120_000);
});

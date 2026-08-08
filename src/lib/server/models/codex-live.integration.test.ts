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
import { getLLMClient } from '$lib/jkai/llm-client';
import { getCodexBridgeUrl } from '$lib/server/models/settings';
import { coerceModelContext } from '$lib/constants/default-models';

let bridgeReady = false;

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
  it('routes a codex/* context to the bridge, not OpenRouter', async () => {
    if (!bridgeReady) return;
    const ctx = coerceModelContext({ modelId: 'codex/gpt-5.6-luna' });
    expect(ctx.provider).toBe('codex');

    const { client, model } = await getLLMClient(ctx);
    // The bare slug is what the bridge expects; the `codex/` prefix is our own
    // namespacing and must not leak into the request.
    expect(model).toBe('gpt-5.6-luna');
    expect(String(client.baseURL)).toContain('5207');
    expect(String(client.baseURL)).not.toContain('openrouter');
  });

  it('completes a real turn through the site gateway', async () => {
    if (!bridgeReady) return;
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

  it('still routes an OpenRouter id to OpenRouter', async () => {
    const { client } = await getLLMClient(
      coerceModelContext({ modelId: 'deepseek/deepseek-v4-flash' }),
    );
    expect(String(client.baseURL)).toContain('openrouter');
  });
});

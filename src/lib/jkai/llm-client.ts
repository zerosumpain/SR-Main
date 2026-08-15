import OpenAI from 'openai';
import { getOpenRouterApiKey, getCodexBridgeUrl } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { installUsageCapture } from '$lib/jkai/usage-capture';
import { mapLegacyModelId, coerceModelContext } from '$lib/constants/default-models';
import { toCodexSlug } from '$lib/server/models/codex-catalogue';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let openrouterClient: OpenAI | undefined;
let codexClient: OpenAI | undefined;
let groundedCodexClient: OpenAI | undefined;

export function clearLLMClientCache(): void {
  openrouterClient = undefined;
  codexClient = undefined;
}

/**
 * The single choke point every LLM call on the site goes through (~160 call
 * sites). Provider selection happens HERE and nowhere else — callers pass a
 * ModelContext and get back a ready OpenAI-shaped client plus the model string
 * to put in the request.
 *
 * Both providers speak the OpenAI wire format: OpenRouter natively, and Codex
 * because packages/jkai-codex-bridge translates /v1/chat/completions into
 * Codex SDK thread runs. That is the whole reason the bridge exists rather than
 * the SDK being imported here — it keeps the provider difference to a base URL,
 * so no call site has to know which one it is talking to, and it lets Hermes
 * (a separate Python runtime) reach the same subscription by pointing its
 * `base_url` at the same port.
 */
/**
 * A Codex client allowed to consult the live web.
 *
 * A DIFFERENT BASE URL, not a flag. The bridge keeps its agent pinned shut —
 * read-only, no network, no approvals, search off — because prompts reach it
 * from all over the site, much of it text the site did not author, and a prompt
 * injection reaching an agent with web access is a real attack. The one
 * sanctioned relaxation lives behind `/v1/grounded`, so turning it on means
 * deliberately addressing another endpoint rather than setting a field that any
 * caller might set by accident. See `packages/jkai-codex-bridge/src/codex-runner.ts`.
 *
 * Only prompts the site composed from user-typed input should come here.
 */
export function getGroundedCodexClient(): OpenAI {
  if (!groundedCodexClient) {
    groundedCodexClient = installUsageCapture(
      new OpenAI({
        apiKey: 'codex-bridge-local',
        baseURL: `${getCodexBridgeUrl()}/v1/grounded`,
      }),
      'codex',
    );
  }
  return groundedCodexClient;
}

export async function getLLMClient(ctx: ModelContext): Promise<{ client: OpenAI; model: string }> {
  // Persisted contexts arrive in several shapes (legacy provider 'zai' + bare
  // GLM id; a Codex id with no provider field). Normalise before branching, so
  // the decision below reads one canonical value.
  const resolved = coerceModelContext(ctx);

  if (resolved.provider === 'codex') {
    if (!codexClient) {
      codexClient = installUsageCapture(
        new OpenAI({
          // The bridge is loopback-only and unauthenticated at the HTTP layer —
          // the real credential is the Codex OAuth token in ~/.codex/auth.json,
          // held by the bridge process. The SDK requires a non-empty apiKey, so
          // this placeholder satisfies it without meaning anything.
          apiKey: 'codex-bridge-local',
          baseURL: `${getCodexBridgeUrl()}/v1`,
        }),
        'codex',
      );
    }
    // The bridge wants the bare Codex slug; the `codex/` prefix is our own
    // namespacing so a Codex id can never be mistaken for an OpenRouter one.
    return { client: codexClient, model: toCodexSlug(resolved.modelId) };
  }

  if (!openrouterClient) {
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) throw new Error('OpenRouter API key not configured');
    openrouterClient = installUsageCapture(
      new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
      }),
      'openrouter',
    );
  }
  return { client: openrouterClient, model: mapLegacyModelId(resolved.modelId) };
}

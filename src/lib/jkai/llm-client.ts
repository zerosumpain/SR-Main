import OpenAI from 'openai';
import { getOpenRouterApiKey, getCodexBridgeUrl, isCodexEnabled } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { installUsageCapture } from '$lib/jkai/usage-capture';
import {
  mapLegacyModelId,
  coerceModelContext,
  isEmbeddingModelId,
} from '$lib/constants/default-models';
import { toCodexSlug, DEFAULT_CODEX_MODEL_SLUG } from '$lib/server/models/codex-catalogue';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let openrouterClient: OpenAI | undefined;
let codexClient: OpenAI | undefined;
let groundedCodexClient: OpenAI | undefined;

export function clearLLMClientCache(): void {
  openrouterClient = undefined;
  codexClient = undefined;
  openrouterOutageUntil = 0;
}

// ── OpenRouter outage fallback ─────────────────────────────────────────────
//
// One OpenRouter key funds every model on the site that is not Codex, so when
// it runs out of credit or is unset, that is not a degraded service — it is a
// total outage of every OpenRouter-pinned workload at once. Seen live on
// 2026-08-27: entity extraction, the workflow doctor, self-improvement and the
// heartbeat's chat continuation all returned `402 Insufficient credits`
// simultaneously, and the admission path for /jkai/intel/mail could not run at
// all.
//
// Codex is the answer because it is already there: the bridge runs on the VPS,
// `codex.enabled` is on, and the site's own chat default is already a Codex
// model. It costs subscription quota rather than cash, so it degrades in a
// different currency to the one that just ran out.
//
// TWO things this deliberately does NOT do:
//
//   - It never re-routes EMBEDDINGS. The bridge translates chat completions and
//     has no embeddings endpoint, so a fallback there would replace a true
//     "out of credit" with a false 404 (see isEmbeddingModelId).
//   - It never fires when Codex is not enabled. `isCodexEnabled()` is off unless
//     a host has passed a health probe, and routing to a bridge that is not
//     there swaps one outage for a more confusing one.

/** How long a credit failure is believed before OpenRouter is tried again.
 *  Short on purpose: a top-up should be picked up within minutes, and the cost
 *  of being wrong is a single failed call that immediately falls back again. */
const OUTAGE_TTL_MS = 5 * 60_000;

let openrouterOutageUntil = 0;

/** Is OpenRouter currently believed to be unusable? Exported for the tests and
 *  for anything that wants to say so in a UI. */
export function openrouterIsDown(now = Date.now()): boolean {
  return now < openrouterOutageUntil;
}

/** Record that OpenRouter refused on money or credentials. */
export function markOpenrouterDown(now = Date.now()): void {
  openrouterOutageUntil = now + OUTAGE_TTL_MS;
}

/**
 * Failures that mean "this key cannot buy anything", as opposed to a bad
 * request that would fail identically on any provider.
 *
 * 402 is out of credit; 401/403 is a missing, revoked or malformed key. A 429
 * is deliberately NOT here — that is rate limiting, it clears on its own, and
 * treating it as an outage would move steady traffic onto a finite Codex quota
 * for five minutes at a time.
 */
export function isCreditOrAuthFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 402 || status === 401 || status === 403;
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
 * so no call site has to know which one it is talking to, and it lets a client
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
    // The bridge wants the bare Codex slug; the `codex/` prefix is our own
    // namespacing so a Codex id can never be mistaken for an OpenRouter one.
    return { client: getCodexClient(), model: toCodexSlug(resolved.modelId) };
  }

  const openrouterModel = mapLegacyModelId(resolved.modelId);

  // Fast path, and the reason the key is not read here unconditionally: this
  // function is on the hot path of ~160 call sites, and `getOpenRouterApiKey`
  // is a settings read. A live client with no known outage is already the
  // answer, so nothing else needs asking.
  if (openrouterClient && !openrouterIsDown()) {
    return { client: openrouterClient, model: openrouterModel };
  }

  const apiKey = await getOpenRouterApiKey();

  // Fall back BEFORE spending a round trip, when we already know the answer:
  // there is no key at all, or a credit failure in the last few minutes says
  // this key cannot buy anything. Without this the first call after an outage
  // begins pays a guaranteed failure, and so does every call for as long as the
  // outage lasts.
  if ((!apiKey || openrouterIsDown()) && (await codexCanStandIn(openrouterModel))) {
    console.warn(
      `[llm] OpenRouter unavailable (${apiKey ? 'out of credit' : 'no key'}) — "${openrouterModel}" routed to Codex ${DEFAULT_CODEX_MODEL_SLUG}`,
    );
    return { client: getCodexClient(), model: DEFAULT_CODEX_MODEL_SLUG };
  }

  if (!apiKey) throw new Error('OpenRouter API key not configured');

  if (!openrouterClient) {
    openrouterClient = installCodexFallback(
      installUsageCapture(
        new OpenAI({
          apiKey,
          baseURL: OPENROUTER_BASE_URL,
        }),
        'openrouter',
      ),
    );
  }
  return { client: openrouterClient, model: openrouterModel };
}

/** The Codex client, built once. */
function getCodexClient(): OpenAI {
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
  return codexClient;
}

/** May Codex answer for this model? Embeddings never; a disabled bridge never. */
export async function codexCanStandIn(modelId: string): Promise<boolean> {
  if (isEmbeddingModelId(modelId)) return false;
  return await isCodexEnabled();
}

/**
 * Retry a refused call on Codex, once.
 *
 * The pre-emptive branch in `getLLMClient` cannot catch the FIRST failure —
 * nothing knows the credit has run out until OpenRouter says so — so this is
 * what turns that first 402 into an answer rather than an error the caller has
 * to handle. It also latches the outage, which is what makes every subsequent
 * call take the cheap path above.
 *
 * Honest limitation: Codex is text-only. A retried call carrying image or PDF
 * content parts will fail on the bridge. That is no worse than the 402 it is
 * replacing — the caller was getting an error either way — but it means this is
 * a fallback for the text workloads (extraction, doctor, self-improvement,
 * admission), not a general-purpose mirror of OpenRouter.
 */
function installCodexFallback(client: OpenAI): OpenAI {
  type CreateFn = (...args: unknown[]) => Promise<unknown>;
  const completions = client.chat.completions as unknown as { create: CreateFn };
  const original = completions.create.bind(completions);

  completions.create = async function (...args: unknown[]): Promise<unknown> {
    try {
      return await original(...args);
    } catch (err) {
      if (!isCreditOrAuthFailure(err)) throw err;
      // Latch first: even if this particular call cannot be retried, every
      // other call on the site should now skip OpenRouter.
      markOpenrouterDown();

      const params = (args[0] ?? {}) as { model?: string };
      const model = params.model ?? '';
      if (!(await codexCanStandIn(model))) throw err;

      const status = (err as { status?: number }).status;
      console.warn(`[llm] OpenRouter refused ${status} for "${model}" — retrying on Codex ${DEFAULT_CODEX_MODEL_SLUG}`);
      const codex = getCodexClient().chat.completions as unknown as { create: CreateFn };
      return await codex.create({ ...params, model: DEFAULT_CODEX_MODEL_SLUG }, ...args.slice(1));
    }
  } as unknown as typeof completions.create;

  return client;
}

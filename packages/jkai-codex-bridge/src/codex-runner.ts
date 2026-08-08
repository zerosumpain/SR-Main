/**
 * Wraps @openai/codex-sdk so the HTTP layer can stay dumb.
 *
 * The SDK drives the `codex` CLI as a subprocess, which authenticates with the
 * ChatGPT OAuth token in ~/.codex/auth.json. That is the entire reason this
 * sidecar exists: there is no HTTP API that accepts a ChatGPT Pro subscription,
 * so the only way to spend the subscription instead of per-token API credit is
 * to drive OpenAI's own client locally.
 */
import { Codex, type ThreadEvent, type ThreadOptions, type Usage } from '@openai/codex-sdk';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * THE SANDBOX SETTINGS BELOW ARE NOT REQUEST-CONFIGURABLE, DELIBERATELY.
 *
 * Codex is an agent: given the chance it will run shell commands and edit
 * files. The prompts arriving here come from all over the site — chat turns,
 * workflow nodes, scraped page text, Gmail bodies, research documents — much of
 * it text the site did not author. A prompt injection reaching an agent with
 * workspace-write and network access is a remote-code-execution path onto the
 * box, so the bridge pins the agent shut and exposes no override:
 *
 *   read-only      — cannot modify anything, even inside its own workdir
 *   never          — never pauses to ask for approval (nothing is listening)
 *   no network     — no outbound calls from the agent's tools
 *   search off     — no web fetches pulling more untrusted text into context
 *   empty workdir  — nothing of ours to read even within read-only
 *
 * If a future caller genuinely needs an agentic Codex run with tools, that
 * belongs behind its own explicitly-authorised endpoint, not as a flag on the
 * general chat-completions path.
 */
const LOCKED_THREAD_OPTIONS = {
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
  webSearchMode: 'disabled',
  webSearchEnabled: false,
  skipGitRepoCheck: true,
} satisfies Partial<ThreadOptions>;

/** An empty scratch directory, so that even under read-only the agent has
 *  nothing of ours in scope. Recreated on boot; never written to by us. */
const WORKDIR = process.env.CODEX_BRIDGE_WORKDIR || join(tmpdir(), 'jkai-codex-bridge-workdir');

export interface RunRequest {
  model: string;
  prompt: string;
  /** JSON schema when the caller asked for structured output. */
  outputSchema?: unknown;
  reasoningEffort?: ThreadOptions['modelReasoningEffort'];
  signal?: AbortSignal;
  /** URL of the per-request MCP server publishing the caller's tools. When set,
   *  Codex may call them and the run stops at the first dispatch. */
  toolServerUrl?: string;
}

/** A tool the model decided to call, captured from the event stream. */
export interface CapturedToolCall {
  name: string;
  /** Raw arguments as Codex parsed them; serialised for the OpenAI shape. */
  arguments: unknown;
}

/**
 * How long to keep listening after the first tool call, to collect siblings
 * the model dispatched in the same breath.
 *
 * Without this a model that wants three lookups at once gets serialised into
 * three round trips, and each round trip is a fresh Codex start — the single
 * most expensive thing in this path. With it, parallel calls come back in one
 * response the way an OpenAI caller expects.
 */
const PARALLEL_TOOL_GRACE_MS = 400;

export interface RunResult {
  text: string;
  usage: Usage | null;
  /** Present when the model called caller-supplied tools; the HTTP layer turns
   *  these into `finish_reason: "tool_calls"`. */
  toolCalls?: CapturedToolCall[];
}

let codex: Codex | undefined;

function client(): Codex {
  if (!codex) {
    mkdirSync(WORKDIR, { recursive: true });
    codex = new Codex();
  }
  return codex;
}

/**
 * A Codex client wired to this request's tool server.
 *
 * MCP servers are configured at CLIENT construction (`CodexOptions.config`),
 * not per turn, and the tool URL is per request — so a tool-bearing request
 * gets its own short-lived client. The no-tools path keeps the shared cached
 * one, which is the overwhelmingly common case.
 */
function clientFor(toolServerUrl?: string): Codex {
  if (!toolServerUrl) return client();
  mkdirSync(WORKDIR, { recursive: true });
  return new Codex({ config: { mcp_servers: { caller: { url: toolServerUrl } } } });
}

function threadOptions(req: RunRequest): ThreadOptions {
  return {
    ...LOCKED_THREAD_OPTIONS,
    workingDirectory: WORKDIR,
    model: req.model,
    ...(req.reasoningEffort ? { modelReasoningEffort: req.reasoningEffort } : {}),
  };
}

/** One-shot turn. With `toolServerUrl` set it may return tool calls instead of
 *  text, exactly as an OpenAI completion does. */
export async function runOnce(req: RunRequest): Promise<RunResult> {
  if (req.toolServerUrl) return runCapturingToolCalls(req);

  const thread = client().startThread(threadOptions(req));
  const turn = await thread.run(req.prompt, {
    ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  return { text: turn.finalResponse ?? '', usage: turn.usage };
}

/**
 * Run a turn where the caller supplied tools, stopping at the first dispatch.
 *
 * The model may instead just answer — a tool being available is not a promise
 * it gets used — so this returns text when no call happens, and the caller
 * treats it as an ordinary completion.
 */
export async function runCapturingToolCalls(req: RunRequest): Promise<RunResult> {
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  req.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const seen = new Map<string, CapturedToolCall>();
  let text = '';
  let usage: Usage | null = null;
  let failure: string | null = null;
  let graceTimer: NodeJS.Timeout | undefined;

  try {
    const thread = clientFor(req.toolServerUrl).startThread(threadOptions(req));
    const { events } = await thread.runStreamed(req.prompt, {
      ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
      signal: ac.signal,
    });

    for await (const event of events as AsyncGenerator<ThreadEvent>) {
      const item = (event as { item?: Record<string, unknown> }).item;

      if (item?.type === 'mcp_tool_call') {
        const key = String(item.id ?? `${item.tool}`);
        if (!seen.has(key)) {
          seen.set(key, { name: String(item.tool ?? ''), arguments: item.arguments });
          // Give siblings a moment to arrive, then hand the batch back.
          if (!graceTimer) graceTimer = setTimeout(() => ac.abort(), PARALLEL_TOOL_GRACE_MS);
        }
        continue;
      }

      if (item?.type === 'agent_message' && typeof item.text === 'string') text = item.text;
      if (event.type === 'turn.completed') usage = event.usage;
      if (event.type === 'turn.failed') failure = event.error?.message ?? 'Codex turn failed';
      if (event.type === 'error') failure = event.message ?? 'Codex stream error';
    }
  } catch (err) {
    // Our own abort after capturing is the success path, not an error.
    if (!seen.size) throw err;
  } finally {
    if (graceTimer) clearTimeout(graceTimer);
    req.signal?.removeEventListener('abort', onOuterAbort);
  }

  if (failure && !seen.size) throw new Error(failure);
  return { text, usage, toolCalls: seen.size ? [...seen.values()] : undefined };
}

export interface StreamChunk {
  /** Newly-produced assistant text since the last chunk. */
  delta: string;
  /** Present on the final chunk only. */
  usage?: Usage | null;
  done: boolean;
}

/**
 * Streaming turn.
 *
 * Codex emits ITEM-level events, not tokens: an `agent_message` item is
 * repeatedly updated with its full text so far. We diff against what we have
 * already forwarded and emit the difference, which gives the caller normal
 * incremental deltas. Chunk size is therefore whatever Codex's update cadence
 * is — coarser than per-token, but the OpenAI-shaped consumer can't tell the
 * difference.
 *
 * `reasoning` items are intentionally NOT forwarded as content: they'd be
 * interleaved into the assistant message as though they were the answer. Their
 * tokens still show up in usage.reasoning_output_tokens.
 */
export async function* runStreamed(req: RunRequest): AsyncGenerator<StreamChunk> {
  const thread = client().startThread(threadOptions(req));
  const { events } = await thread.runStreamed(req.prompt, {
    ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });

  // Per-item high-water mark of text already emitted. Keyed by item id because
  // a turn can contain more than one agent_message.
  const emitted = new Map<string, number>();
  let usage: Usage | null = null;
  let failure: string | null = null;

  for await (const event of events as AsyncGenerator<ThreadEvent>) {
    switch (event.type) {
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = event.item;
        if (item.type !== 'agent_message') break;
        const seen = emitted.get(item.id) ?? 0;
        const full = item.text ?? '';
        if (full.length > seen) {
          emitted.set(item.id, full.length);
          yield { delta: full.slice(seen), done: false };
        }
        break;
      }
      case 'turn.completed':
        usage = event.usage;
        break;
      case 'turn.failed':
        failure = event.error?.message ?? 'Codex turn failed';
        break;
      case 'error':
        failure = event.message ?? 'Codex stream error';
        break;
      default:
        break;
    }
  }

  // Surface a mid-stream failure as a thrown error rather than a silent short
  // reply — a truncated answer that looks complete is the worse outcome.
  if (failure) throw new Error(failure);
  yield { delta: '', usage, done: true };
}

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
}

export interface RunResult {
  text: string;
  usage: Usage | null;
}

let codex: Codex | undefined;

function client(): Codex {
  if (!codex) {
    mkdirSync(WORKDIR, { recursive: true });
    codex = new Codex();
  }
  return codex;
}

function threadOptions(req: RunRequest): ThreadOptions {
  return {
    ...LOCKED_THREAD_OPTIONS,
    workingDirectory: WORKDIR,
    model: req.model,
    ...(req.reasoningEffort ? { modelReasoningEffort: req.reasoningEffort } : {}),
  };
}

/** One-shot, non-streaming turn. */
export async function runOnce(req: RunRequest): Promise<RunResult> {
  const thread = client().startThread(threadOptions(req));
  const turn = await thread.run(req.prompt, {
    ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  return { text: turn.finalResponse ?? '', usage: turn.usage };
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

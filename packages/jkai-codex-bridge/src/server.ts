/**
 * OpenAI-compatible HTTP face over the Codex CLI.
 *
 * Speaks just enough of /v1 for the site's existing `openai` SDK clients (and
 * a `base_url` setting) to treat the ChatGPT Pro subscription as though
 * it were another provider:
 *
 *   GET  /health              liveness + whether `codex login` has been done
 *   GET  /v1/models           the static Codex catalogue, OpenAI list shape
 *   POST /v1/chat/completions non-streaming and SSE streaming
 *
 * Everything else 404s. This is not a general proxy.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_MODELS, DEFAULT_CODEX_MODEL_SLUG, toCodexSlug } from '$lib/server/models/codex-catalogue';
import { runOnce, runStreamed, activeTransport, type CapturedToolCall } from './codex-runner';
import { toAnnotations, type CapturedSearch } from './web-search';
import type { ChatMessage } from './messages';
import {
  registerTools,
  unregisterTools,
  handleMcpRequest,
  isMcpPath,
  type OpenAiTool,
} from './mcp-tool-server';
import {
  messagesToPrompt,
  extractOutputSchema,
  wantsBareJson,
  BARE_JSON_INSTRUCTION,
  type ChatMessage,
} from './messages';

const execFileAsync = promisify(execFile);

/** Codex runs are minutes-long at the top end (xhigh reasoning on Sol). The
 *  site's own gateways impose tighter per-call deadlines; this is only a
 *  backstop against a wedged subprocess holding a slot forever. */
const REQUEST_TIMEOUT_MS = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 600_000);

/** Each in-flight request spawns a `codex` subprocess, so this caps real
 *  processes, not just sockets. Low by default: the subscription's rate limits
 *  bite long before CPU does, and queueing is friendlier than a burst of 429s. */
const MAX_CONCURRENT = Number(process.env.CODEX_BRIDGE_CONCURRENCY || 3);

let active = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** OpenAI-shaped error body, so the `openai` SDK surfaces the message instead
 *  of a bare "500 Internal Server Error". */
function sendError(res: ServerResponse, status: number, message: string, code: string): void {
  sendJson(res, status, { error: { message, type: 'invalid_request_error', code } });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Prompts on this site get large (whole documents), but not unbounded.
    if (size > 32 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Whether `codex login` has been completed for the user running this process.
 *  Read from disk rather than shelling out, so /health stays cheap enough to
 *  poll. */
async function codexLoginStatus(): Promise<{ loggedIn: boolean; mode: string | null }> {
  try {
    const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8');
    const auth = JSON.parse(raw) as { tokens?: { access_token?: string }; OPENAI_API_KEY?: string };
    if (auth?.tokens?.access_token) return { loggedIn: true, mode: 'chatgpt-subscription' };
    if (auth?.OPENAI_API_KEY) return { loggedIn: true, mode: 'api-key' };
    return { loggedIn: false, mode: null };
  } catch {
    return { loggedIn: false, mode: null };
  }
}

/**
 * `codex --version`, resolved the way the SDK resolves it.
 *
 * NOT a bare `codex` on PATH: @openai/codex-sdk depends on @openai/codex, which
 * vendors the platform binary into node_modules and exposes it as a bin shim.
 * Nothing installs it globally, so probing PATH reported "Codex missing" on a
 * host where the SDK worked perfectly — which in turn made the admin panel
 * refuse to enable a provider that was in fact ready. PATH stays as a fallback
 * for a host with a global install and no local one.
 */
async function codexVersion(): Promise<string | null> {
  const candidates: Array<[string, string[]]> = [];
  try {
    const require = createRequire(import.meta.url);
    candidates.push([process.execPath, [require.resolve('@openai/codex/bin/codex.js'), '--version']]);
  } catch {
    // SDK not installed here; fall through to PATH.
  }
  candidates.push(['codex', ['--version']]);

  for (const [cmd, args] of candidates) {
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 15_000 });
      const v = stdout.trim();
      if (v) return v;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Where Codex should reach this bridge's MCP endpoint.
 *
 * Codex runs as a child process on this host, so loopback is right — and the
 * bridge is loopback-only anyway. Uses the configured port rather than a
 * hostname so it keeps working when the listener is moved.
 */
function selfBaseUrl(): string {
  const port = Number(process.env.CODEX_BRIDGE_PORT || 5207);
  return `http://127.0.0.1:${port}`;
}

/** Captured MCP dispatches → the OpenAI `tool_calls` shape. Arguments are
 *  stringified because that is what the wire format specifies, and every SDK
 *  consumer JSON.parses them. */
let callSeq = 0;
function toOpenAiToolCalls(calls: CapturedToolCall[]) {
  return calls.map((c) => ({
    // Prefer the provider's own id. The synthesised fallback is monotonic
    // rather than index-based: `call_codex_0_<name>` repeats on every round, and
    // a conversation replayed with two identically-named calls cannot pair each
    // `function_call` with its output.
    id: (c.id || `call_codex_${callSeq++}_${c.name}`).slice(0, 64),
    type: 'function' as const,
    function: {
      name: c.name,
      arguments:
        typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
    },
  }));
}

/**
 * Pull a caller-fixable validation message out of a Codex failure.
 *
 * Codex surfaces upstream rejections as the raw JSON error body inside its exit
 * message. Those are 400-class — a bad `reasoning_effort`, an unknown model —
 * and reporting them as our 502 sends the caller debugging the bridge instead
 * of their request. Returns null for genuine bridge/transport failures.
 */
export function extractUpstreamValidationError(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start)) as {
      error?: { type?: string; code?: string; message?: string };
    };
    const e = parsed?.error;
    if (!e?.message) return null;
    const isValidation =
      e.type === 'invalid_request_error' ||
      (typeof e.code === 'string' && /unsupported|invalid|not_found/.test(e.code));
    return isValidation ? e.message : null;
  } catch {
    return null;
  }
}

/** Codex reports usage with its own field names; the OpenAI shape is what every
 *  caller (including $lib/llm/usage-capture) reads. */
function toOpenAiUsage(usage: {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
} | null) {
  if (!usage) return undefined;
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + usage.output_tokens,
    prompt_tokens_details: { cached_tokens: usage.cached_input_tokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoning_output_tokens },
  };
}

interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  response_format?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  reasoning_effort?: string;
}

const REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

interface HandlerOptions {
  /** Set only by the /v1/grounded route. Never read from the request body. */
  webSearch?: boolean;
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  body: ChatCompletionRequest,
  opts: HandlerOptions = {},
): Promise<void> {
  const messages = body.messages ?? [];
  if (!messages.length) {
    sendError(res, 400, 'messages must be a non-empty array', 'missing_messages');
    return;
  }

  const model = toCodexSlug(body.model?.trim() || DEFAULT_CODEX_MODEL_SLUG);

  // Caller-supplied tools are published as a per-request MCP server, which is
  // the only way Codex accepts external tools. See mcp-tool-server.ts. Nothing
  // is executed here — the first dispatch is captured and returned as
  // `tool_calls` for the caller to run, per the chat-completions contract.
  const wantsTools =
    Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== 'none';
  // The per-request MCP server exists ONLY because the SDK has no `tools`
  // parameter. The Responses transport takes function schemas natively, so on
  // that path the whole hop — register, publish, serve, deregister — is skipped.
  const useMcpTools = wantsTools && activeTransport() === 'sdk';
  const registration = useMcpTools ? registerTools(body.tools as OpenAiTool[]) : null;
  const toolServerUrl = registration ? `${selfBaseUrl()}${registration.path}` : undefined;
  const structured = { messages: messages as ChatMessage[], tools: wantsTools ? body.tools : undefined };
  let prompt = messagesToPrompt(messages);
  const outputSchema = extractOutputSchema(body.response_format);
  if (!outputSchema && wantsBareJson(body.response_format)) {
    prompt = `${prompt}\n\n${BARE_JSON_INSTRUCTION}`;
  }

  const reasoningEffort =
    body.reasoning_effort && REASONING_EFFORTS.has(body.reasoning_effort)
      ? (body.reasoning_effort as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh')
      : undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // A caller that hangs up (deploy restart, user navigating away) should kill
  // the Codex subprocess rather than leave it burning quota to nobody.
  req.on('close', () => controller.abort());

  const id = `chatcmpl-codex-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  try {
    if (body.stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const write = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      // One streaming path whether or not tools are attached. It used to fork:
      // a tool-bearing request ran as a single blocking capture and arrived as
      // one block, on the reasoning that the useful output is a tool call which
      // only exists once dispatched. But most tool-bearing turns answer in
      // prose without calling anything, and those turns streamed nothing at
      // all — which is every jkai chat turn, since they all carry tools.
      const frame = (delta: Record<string, unknown>, finish: string | null, usage?: unknown) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage !== undefined ? { usage } : {}),
      });

      await withSlot(async () => {
        // The role belongs on the first delta only, per the OpenAI stream
        // contract — SDK consumers assemble on that assumption.
        let first = true;
        const withRole = (d: Record<string, unknown>) => {
          const out = first ? { role: 'assistant', ...d } : d;
          first = false;
          return out;
        };

        for await (const chunk of runStreamed({
          model,
          prompt,
          outputSchema,
          reasoningEffort,
          signal: controller.signal,
          toolServerUrl,
          webSearch: opts.webSearch,
          ...structured,
        })) {
          if (chunk.done) {
            const calls = chunk.toolCalls?.length ? toOpenAiToolCalls(chunk.toolCalls) : null;
            // Tool calls ride their own delta before the terminator, so a
            // consumer sees them the same way it would from any provider.
            if (calls) write(frame(withRole({ tool_calls: calls }), null));
            // Citations arrive only once the turn is done — Codex reports what
            // it read as it goes, but the set is not final until it stops. They
            // ride the last content-bearing frame rather than the terminator,
            // because a consumer that stops reading on `finish_reason` would
            // otherwise never see them.
            const annotations = toAnnotations(chunk.searches);
            if (annotations.length) {
              write(frame(withRole({ annotations, x_web_searches: chunk.searches }), null));
            }
            write(frame({}, calls ? 'tool_calls' : 'stop', toOpenAiUsage(chunk.usage ?? null)));
            break;
          }
          // `reasoning` is where OpenRouter puts it, so a caller that already
          // renders one renders both. Guarded because a reasoning chunk
          // carries an empty `delta` and an empty content frame reads as the
          // model having said nothing.
          if (chunk.reasoning) write(frame(withRole({ reasoning: chunk.reasoning }), null));
          if (chunk.delta) write(frame(withRole({ content: chunk.delta }), null));
        }
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const result = await withSlot(() =>
      runOnce({
        model,
        prompt,
        outputSchema,
        reasoningEffort,
        signal: controller.signal,
        toolServerUrl,
        webSearch: opts.webSearch,
        ...structured,
      }),
    );
    const calls = result.toolCalls?.length ? toOpenAiToolCalls(result.toolCalls) : null;
    const annotations = toAnnotations(result.searches);
    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          // `content` must be null alongside tool_calls — SDK consumers branch
          // on it, and an empty string reads as "the model replied with
          // nothing" rather than "the model wants a tool run".
          message: calls
            ? { role: 'assistant', content: null, tool_calls: calls }
            : {
                role: 'assistant',
                content: result.text,
                ...(annotations.length
                  ? { annotations, x_web_searches: result.searches }
                  : {}),
              },
          finish_reason: calls ? 'tool_calls' : 'stop',
        },
      ],
      usage: toOpenAiUsage(result.usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Upstream rejected the REQUEST (e.g. reasoning_effort "minimal", which the
    // GPT-5.6 line does not accept). That is the caller's to fix, so give them
    // a 400 with the model's own words rather than a 502 that reads like our
    // bridge fell over.
    const upstream = extractUpstreamValidationError(message);
    if (upstream && !res.headersSent) {
      sendError(res, 400, upstream, 'upstream_invalid_request');
      return;
    }
    if (res.headersSent) {
      // Mid-stream failure: emit an SSE error frame so the consumer sees a
      // failure rather than a truncated-but-well-formed answer.
      res.write(`data: ${JSON.stringify({ error: { message, code: 'codex_stream_failed' } })}\n\n`);
      res.end();
    } else {
      sendError(res, 502, `Codex run failed: ${message}`, 'codex_failed');
    }
  } finally {
    clearTimeout(timeout);
    // The registration only exists for this request; leaving it would let a
    // later Codex run reach a stale tool list.
    if (registration) unregisterTools(registration.id);
  }
}

export function createBridgeServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const [login, version] = await Promise.all([codexLoginStatus(), codexVersion()]);
        sendJson(res, login.loggedIn && version ? 200 : 503, {
          ok: login.loggedIn && Boolean(version),
          loggedIn: login.loggedIn,
          authMode: login.mode,
          codexVersion: version,
          models: CODEX_MODELS.length,
          transport: activeTransport(),
          active,
          queued: queue.length,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: CODEX_MODELS.map((m) => ({
            id: m.slug,
            object: 'model',
            created: 0,
            owned_by: 'openai-codex',
          })),
        });
        return;
      }

      // Codex's own connection back in, to read the caller's tool schemas.
      if (isMcpPath(url.pathname)) {
        await handleMcpRequest(req, res, url.pathname);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = (await readBody(req)) as ChatCompletionRequest;
        await handleChatCompletions(req, res, body);
        return;
      }

      /**
       * The same handler, with the agent allowed to consult the live web.
       *
       * A separate ROUTE rather than a body flag, deliberately. Every prompt on
       * this bridge is composed somewhere in the site, and most of them contain
       * text the site did not author — scraped pages, Gmail bodies, research
       * documents. A flag on the shared path would let any of those callers turn
       * search on by accident; a different URL has to be chosen. `codex-runner`
       * spells out what this does and does not loosen.
       */
      if (req.method === 'POST' && url.pathname === '/v1/grounded/chat/completions') {
        const body = (await readBody(req)) as ChatCompletionRequest;
        await handleChatCompletions(req, res, body, { webSearch: true });
        return;
      }

      sendError(res, 404, `No route for ${req.method} ${url.pathname}`, 'not_found');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendError(res, 500, message, 'bridge_error');
      else res.end();
    }
  });
}

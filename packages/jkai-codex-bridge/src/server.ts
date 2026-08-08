/**
 * OpenAI-compatible HTTP face over the Codex CLI.
 *
 * Speaks just enough of /v1 for the site's existing `openai` SDK clients (and
 * Hermes' `base_url` setting) to treat the ChatGPT Pro subscription as though
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
import { runOnce, runStreamed } from './codex-runner';
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

/** Codex reports usage with its own field names; the OpenAI shape is what every
 *  caller (including $lib/jkai/usage-capture) reads. */
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

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  body: ChatCompletionRequest,
): Promise<void> {
  const messages = body.messages ?? [];
  if (!messages.length) {
    sendError(res, 400, 'messages must be a non-empty array', 'missing_messages');
    return;
  }

  // Fail loudly rather than quietly ignoring tools. A caller that passes tool
  // schemas is expecting tool_calls back; answering in prose instead looks like
  // the model "chose not to" and sends the caller debugging its prompt.
  if (body.tools || body.tool_choice) {
    sendError(
      res,
      400,
      'Codex does not accept caller-supplied tool schemas — it runs its own toolset. Use an OpenRouter model for tool-calling roles.',
      'tools_unsupported',
    );
    return;
  }

  const model = toCodexSlug(body.model?.trim() || DEFAULT_CODEX_MODEL_SLUG);
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

      await withSlot(async () => {
        let first = true;
        for await (const chunk of runStreamed({
          model,
          prompt,
          outputSchema,
          reasoningEffort,
          signal: controller.signal,
        })) {
          if (chunk.done) {
            write({
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: toOpenAiUsage(chunk.usage ?? null),
            });
            break;
          }
          write({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                // The role belongs on the first delta only, per the OpenAI
                // stream contract — SDK consumers assemble on that assumption.
                delta: first ? { role: 'assistant', content: chunk.delta } : { content: chunk.delta },
                finish_reason: null,
              },
            ],
          });
          first = false;
        }
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const result = await withSlot(() =>
      runOnce({ model, prompt, outputSchema, reasoningEffort, signal: controller.signal }),
    );
    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: result.text },
          finish_reason: 'stop',
        },
      ],
      usage: toOpenAiUsage(result.usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = (await readBody(req)) as ChatCompletionRequest;
        await handleChatCompletions(req, res, body);
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

import { spawn } from 'child_process';
import { join } from 'path';
import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { emitLog, emitLive } from './log-emitter';
import { recordBuildUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ActionRecord, BudgetConfig, FailureEnvelope, FailureKind } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { getOpenRouterApiKey } from '$lib/server/models/settings';
import { coerceModelContext } from '$lib/constants/default-models';
import { toCodexSlug } from '$lib/server/models/codex-catalogue';
import { registerActiveChild, clearActiveChild } from './interrupt-registry';
import { stripNulls } from './strip-nulls';
import { describeDbError } from './db-error';

const CONTAINER_NAME = 'jkai-sandbox';
const HOST_MODE = process.env.JKAI_BUILDS_HOSTMODE === '1';

// --- Pi JSON event shape (based on pi 0.68 actual output) ---
//
// message_end events carry the canonical shape:
//   role: "user"       → content: [{type:"text", text}]
//   role: "assistant"  → content: [{type:"thinking", thinking}, {type:"toolCall", id, name, arguments}, {type:"text", text}, ...]
//   role: "toolResult" → toolCallId, toolName, content:[{type:"text", text}], isError

interface PiContent {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface PiMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content?: PiContent[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  usage?: { input: number; output: number; totalTokens: number; cost?: { total: number } };
  errorMessage?: string;
  stopReason?: string;
  httpStatus?: number;
  errorCode?: string;
}

interface PiEvent {
  type: string;
  message?: PiMessage;
  // message_update events carry streaming deltas; we only need a few fields.
  assistantMessageEvent?: {
    type: string; // text_start, text_delta, text_end, thinking_start, thinking_delta, thinking_end, tool_input_start, tool_input_delta, tool_input_end
    contentIndex?: number;
    delta?: string;
    content?: string;
  };
}

// --- Result ---

export interface PiRunResult {
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  finalAssistantText: string;
  tokensUsed: number;
  errorMessage: string | null;
  failure: FailureEnvelope | null;
}

// --- Provider resolution ---

export interface PiInvocation {
  /** Provider name in PI's vocabulary, for `--provider`. */
  provider: 'openrouter' | 'openai-codex';
  /** Model id in PI's vocabulary, for `--model`. */
  modelId: string;
  /** Env var to hand pi the API key in, or null when pi authenticates itself
   *  from its own `~/.pi/agent/auth.json` (that is the Codex case). */
  apiKeyEnv: 'OPENROUTER_API_KEY' | null;
}

/**
 * Translate a stored build model context into the flags pi understands.
 *
 * Pi has its own provider registry and has never heard of our provider names.
 * A build saved from the picker as `{provider: 'codex', modelId:
 * 'codex/gpt-5.6-terra'}` was handed to the CLI verbatim and died on startup
 * with `Unknown provider "codex"` — after the tool bridge had printed its own
 * banner, so the failure read like a mid-run crash rather than a bad flag.
 *
 * Codex maps onto pi's first-class `openai-codex` provider, NOT our
 * `jkai-codex-bridge`. Both can now do tool calls, but the bridge starts a
 * fresh Codex process per turn (~10 s) and carries ~9,700 tokens of the Codex
 * CLI's own instructions on every single call. For chat that is a rounding
 * error; for an agent making hundreds of tool calls per iteration it is the
 * difference between slow and unusable. Pi talks the Codex Responses API
 * directly — the same route Hermes uses for chat, with real function tools.
 *
 * That route authenticates from pi's OWN ChatGPT OAuth in
 * `~/.pi/agent/auth.json` (`pi`, then `/login`), which is a separate login
 * from the bridge's `~/.codex/auth.json`. Deliberately so: both refresh their
 * tokens, and OpenAI rotates the refresh token on each refresh, so sharing one
 * credential between two clients would have them invalidate each other.
 */
export function piInvocation(ctx: { provider?: string | null; modelId: string }): PiInvocation {
  const coerced = coerceModelContext({ provider: ctx.provider ?? undefined, modelId: ctx.modelId });
  if (coerced.provider === 'codex') {
    // Bare slug: pi wants `gpt-5.6-terra`, our ids carry a `codex/` prefix so
    // that provider stays recoverable from a bare persisted string.
    //
    // Pi's bundled model catalogue lags OpenAI (0.72.1 stops at gpt-5.5), so
    // the current 5.6 line comes back as `Model "…" not found for provider
    // "openai-codex". Using custom model id.` — a warning, not an error: pi
    // passes an unknown id straight through to the API, which is what we want.
    return { provider: 'openai-codex', modelId: toCodexSlug(coerced.modelId), apiKeyEnv: null };
  }
  // Everything else runs on OpenRouter, including legacy rows persisted with
  // provider 'zai' from the direct-z.ai era — coerceModelContext remaps those
  // bare GLM ids onto z-ai/* slugs. Passing `--provider zai` through to pi
  // (which has a zai provider of its own) while handing it an OpenRouter key
  // would fail on a credential mismatch.
  return { provider: 'openrouter', modelId: coerced.modelId, apiKeyEnv: 'OPENROUTER_API_KEY' };
}

/**
 * Clamp a thinking level the chosen provider would reject.
 *
 * The GPT-5.6 line 400s on `reasoning_effort: minimal` (found via the bridge,
 * PR #151). The build form offers `minimal` for every model, so without this a
 * Codex build picked with minimal thinking fails every iteration on a
 * validation error that says nothing about thinking levels.
 */
export function piThinkingLevel(provider: PiInvocation['provider'], level: string | undefined): string | undefined {
  if (provider === 'openai-codex' && level === 'minimal') return 'low';
  return level;
}

/**
 * Pin pi's Codex transport to SSE for one workspace.
 *
 * Pi's Codex provider defaults to `transport: "auto"`, which tries a WebSocket
 * to chatgpt.com first and only falls back to SSE if that *errors*. From the
 * VPS it does not error, it hangs (measured 2026-08-09, pi 0.72.1): one turn
 * streamed its whole answer and then left the process alive indefinitely,
 * another produced no events at all for 200s. Both shapes reach us as a silent
 * stream and get killed by the 180s idle watchdog, i.e. every Codex iteration
 * would cost three wasted minutes and be filed as `stalled` — the failure kind
 * that names the watchdog and not the cause. The same prompt over SSE answered
 * in 4s and exited 0.
 *
 * Transport is settable only through pi's settings files — there is no CLI flag
 * and no env var — so this drops a project-level one into the workspace pi runs
 * in. Project settings beat global, so the fix travels with the code instead of
 * living as undocumented host state that a fresh build host would lack. Only
 * the Codex provider reads the setting, so it cannot affect an OpenRouter run.
 *
 * `.git/info/exclude` keeps it out of the build's diff: a change-request build
 * commits its own work, and a stray `.pi/settings.json` in a PR is noise the
 * agent would have to explain.
 */
export async function pinCodexTransport(workdir: string): Promise<void> {
  const { mkdir, writeFile, readFile, appendFile } = await import('fs/promises');
  await mkdir(join(workdir, '.pi'), { recursive: true });
  await writeFile(
    join(workdir, '.pi', 'settings.json'),
    JSON.stringify({ transport: 'sse' }, null, 2) + '\n',
  );
  try {
    const excludePath = join(workdir, '.git', 'info', 'exclude');
    const current = await readFile(excludePath, 'utf8');
    if (!/^\.pi\/$/m.test(current)) {
      await appendFile(excludePath, `${current.endsWith('\n') ? '' : '\n'}.pi/\n`);
    }
  } catch {
    // No git repo, or a worktree whose .git is a file — the settings file is
    // still in place, which is the part that matters.
  }
}

async function resolveApiKey(envVar: 'OPENROUTER_API_KEY'): Promise<{ envVar: string; value: string }> {
  // Legacy build rows persisted with provider 'zai' (direct-z.ai era) also land
  // here and get the OpenRouter key instead of throwing — GLM is served via
  // OpenRouter's z-ai/* slugs.
  const key = await getOpenRouterApiKey();
  if (!key) throw new Error('OpenRouter API key not configured');
  return { envVar, value: key };
}

// --- Shell-escape helper ---

function sh(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// --- Content helpers ---

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const a = args as { command?: string; path?: string; content?: string; pattern?: string; oldString?: string; newString?: string };
  if (typeof a.command === 'string') return a.command;
  if (typeof a.path === 'string') {
    if (typeof a.content === 'string') return `write ${a.path}\n${a.content}`;
    if (typeof a.oldString === 'string') return `edit ${a.path}\n- ${a.oldString}\n+ ${a.newString ?? ''}`;
    return a.path;
  }
  if (typeof a.pattern === 'string') return a.pattern;
  return JSON.stringify(args, null, 2);
}

// --- Main runner ---

export interface PiRunOptions {
  build: JkaiBuild;
  iteration: JkaiIteration;
  workdir: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  /** Optional live-mutable deadline (Unix ms). If set, overrides maxWallClockMs
   *  and allows the orchestrator to extend the deadline mid-run. */
  deadlineRef?: { current: number };
  isStopped: () => boolean;
  /** Paths inside the sandbox to load as pi extensions (`-e <path>`).
   *  When unset, falls back to `--no-extensions`. */
  extensions?: string[];
  /** Paths inside the sandbox to load as pi skills (`--skill <path>`).
   *  When unset, falls back to `--no-skills`. */
  skillDirs?: string[];
  /** Pi thinking level: off | minimal | low | medium | high | xhigh. */
  thinkingLevel?: string;
  /** Extra env vars to inject into the sandbox container for this run. */
  extraEnv?: Record<string, string>;
}

export async function runPi(opts: PiRunOptions): Promise<PiRunResult> {
  const {
    build,
    iteration,
    workdir,
    systemPrompt,
    userPrompt,
    maxWallClockMs = 30 * 60 * 1000,
    deadlineRef,
    isStopped,
  } = opts;
  const deadline = deadlineRef ?? { current: Date.now() + maxWallClockMs };

  const { provider, modelId, apiKeyEnv } = piInvocation({
    provider: build.modelProvider,
    modelId: build.modelId ?? 'anthropic/claude-sonnet-4.5',
  });
  const auth = apiKeyEnv ? await resolveApiKey(apiKeyEnv) : null;
  if (provider === 'openai-codex' && HOST_MODE) {
    // Host mode only: in container mode `workdir` is a path inside the sandbox,
    // not one this process can write to. Codex builds need host mode anyway —
    // the ChatGPT OAuth lives in the host user's ~/.pi/agent/auth.json.
    await pinCodexTransport(workdir);
  }

  const piParts = [
    'pi',
    '--mode', 'json',
    '--no-session',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--tools', 'read,bash,edit,write,grep,find,ls',
  ];
  if (opts.extensions && opts.extensions.length > 0) {
    for (const e of opts.extensions) {
      piParts.push('--extension', sh(e));
    }
  } else {
    piParts.push('--no-extensions');
  }
  if (opts.skillDirs && opts.skillDirs.length > 0) {
    for (const s of opts.skillDirs) {
      piParts.push('--skill', sh(s));
    }
  } else {
    piParts.push('--no-skills');
  }
  const thinkingLevel = piThinkingLevel(provider, opts.thinkingLevel);
  if (thinkingLevel) {
    piParts.push('--thinking', thinkingLevel);
  }
  piParts.push('--provider', provider);
  piParts.push('--model', sh(modelId));
  piParts.push('--append-system-prompt', sh(systemPrompt));
  piParts.push('-p', sh(userPrompt));
  const piCmd = piParts.join(' ');

  // Host-mode: run pi directly on the host shell with cwd=workdir. No
  // docker. The pi binary must be installed on the host (npm install -g
  // @mariozechner/pi-coding-agent). When deploying, deploy.sh ensures this.
  //
  // Container-mode (legacy): docker exec -i -w workdir jkai-sandbox bash -c '<piCmd>'.
  // Workdir lives inside the container's jkai-workspace volume. Pi binary
  // lives at /usr/bin/pi inside the container image. NOTE a Codex build needs
  // pi's ChatGPT OAuth, which lives in the RUNNING USER's ~/.pi/agent/auth.json
  // — present on the VPS build host, absent inside the sandbox image, so a
  // container-mode Codex build fails at startup (classified below).
  let spawnCmd: string;
  let spawnArgs: string[];
  let spawnOpts: Parameters<typeof spawn>[2];
  if (HOST_MODE) {
    spawnCmd = 'bash';
    spawnArgs = ['-c', piCmd];
    spawnOpts = {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workdir,
      env: {
        ...process.env,
        ...(auth ? { [auth.envVar]: auth.value } : {}),
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
        ...Object.fromEntries(
          Object.entries(opts.extraEnv ?? {}).filter(([, v]) => typeof v === 'string') as [string, string][],
        ),
      },
    };
  } else {
    const dockerArgs = [
      'exec',
      '-i',
      '-w', workdir,
      ...(auth ? ['-e', `${auth.envVar}=${auth.value}`] : []),
      '-e', 'PI_OFFLINE=1',
      '-e', 'PI_TELEMETRY=0',
    ];
    for (const [k, v] of Object.entries(opts.extraEnv ?? {})) {
      if (typeof v === 'string') {
        dockerArgs.push('-e', `${k}=${v}`);
      }
    }
    dockerArgs.push(CONTAINER_NAME, 'bash', '-c', piCmd);
    spawnCmd = 'docker';
    spawnArgs = dockerArgs;
    spawnOpts = { stdio: ['ignore', 'pipe', 'pipe'] };
  }

  await emitLog(
    build.id,
    'system',
    `Launching pi agent (${provider}/${modelId})${HOST_MODE ? ' on host' : ' in sandbox'}`,
    iteration.id,
  );

  const actions: ActionRecord[] = [];
  const messages: Array<{ role: string; content: string }> = [];
  let finalAssistantText = '';
  let tokensUsed = 0;
  // Separate accumulator for the cap. `usage.totalTokens` is per API CALL and
  // includes the whole re-sent conversation, so summing it grows roughly
  // quadratically with turn count and the "token cap" was really a turn cap:
  // 461,311 "tokens" in 100 seconds of wall clock is arithmetically impossible
  // as new tokens. Codex holds ~99% prompt-cache hit rates, so those re-counted
  // tokens cost almost nothing — the cap was punishing an accounting artefact.
  // `tokensUsed` stays as-is for reporting and comparability with history.
  let outputTokensUsed = 0;
  let errorMessage: string | null = null;
  let providerHttpStatus: number | undefined;
  let providerErrorCode: string | undefined;
  let wallClockHit = false;
  let tokenCapHit = false;
  const maxTokensPerIteration =
    (build.budgetConfig as BudgetConfig | null)?.maxTokensPerIteration ?? 0;
  // toolCallId → {name, args} captured from the most recent assistant message
  const pendingCalls = new Map<string, { name: string; args: Record<string, unknown> | undefined }>();

  const child = spawn(spawnCmd, spawnArgs, spawnOpts);
  // spawnOpts always uses `stdio: ['ignore', 'pipe', 'pipe']` (both branches),
  // so stdout/stderr are real pipes — this guard narrows the types and would
  // only ever fire if the stdio config above is changed.
  if (!child.stdout || !child.stderr) {
    throw new Error('pi-runner: child process stdout/stderr pipes unavailable');
  }
  // Register so the WebSocket inbound `interrupt` handler can SIGTERM us.
  registerActiveChild(build.id, child);
  child.once('exit', () => clearActiveChild(build.id, child));
  // `docker exec -i` keeps the container's stdin attached to our pipe; if that
  // pipe never closes, pi with `--mode json -p` waits indefinitely for EOF
  // before emitting its first event. Using `stdio: 'ignore'` for stdin closes
  // it at spawn time, so pi sees an EOF immediately and starts work.

  const stopTimer = setInterval(async () => {
    if (isStopped()) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }, 1000);

  // Poll the deadline (mutable) every 5s so user-initiated extensions via the
  // orchestrator's extendDeadline() take effect mid-run.
  const wallClockCheck = setInterval(() => {
    if (Date.now() >= deadline.current) {
      try {
        wallClockHit = true;
        child.kill('SIGTERM');
        emitLog(
          build.id,
          'system',
          `Pi wall-clock deadline reached`,
          iteration.id,
        );
      } catch {}
      clearInterval(wallClockCheck);
    }
  }, 5000);

  // Two-stage watchdog:
  //  - FIRST_EVENT_TIMEOUT_MS (240s) covers time-to-first-token, which can be
  //    slow when upstream (OpenRouter) is under load but still recoverable.
  //  - IDLE_TIMEOUT_MS (180s) applies once streaming has started; if the
  //    stream goes quiet mid-flight for this long, the connection has stalled.
  // A stream that never starts hits the first-event cap; one that starts and
  // then dies hits the idle cap.
  const FIRST_EVENT_TIMEOUT_MS = 240 * 1000;
  const IDLE_TIMEOUT_MS = 180 * 1000;
  // A tool call is pi executing something on our behalf — `npm run gate`,
  // `npm install`, a test suite. pi writes NOTHING to stdout for its whole
  // duration, so the idle timer above would be counting the tool's runtime as
  // upstream silence. The gate takes ~10 minutes here; at a 180s idle cap an
  // agent that runs it is killed every single time, which is precisely what
  // happened to builds #125, #126 and #131 (diagnosed 2026-08-08).
  //
  // So while any tool call is outstanding the idle timer is suspended and this
  // much longer cap applies instead, measured from when the tool started. It
  // sits above the orchestrator's own 600s gate timeout and below the 30-minute
  // wall clock, so a genuinely hung tool is still caught.
  const TOOL_TIMEOUT_MS = 15 * 60 * 1000;
  const startedAt = Date.now();
  let lastOutputAt = Date.now();
  let anyOutput = false;
  let stalled = false;
  let stalledAgeMs = 0;
  /** When the currently-outstanding batch of tool calls began; null when idle. */
  let toolBusySince: number | null = null;
  const idleCheck = setInterval(() => {
    const now = Date.now();

    if (toolBusySince !== null) {
      const toolAge = now - toolBusySince;
      if (toolAge > TOOL_TIMEOUT_MS) {
        stalled = true;
        stalledAgeMs = toolAge;
        try {
          child.kill('SIGTERM');
          emitLog(
            build.id,
            'error',
            `A tool call ran for ${Math.round(toolAge / 1000)}s without returning (cap ${Math.round(TOOL_TIMEOUT_MS / 1000)}s) — killed.`,
            iteration.id,
          );
        } catch {}
      }
      return;
    }

    const idleAge = now - lastOutputAt;
    const sinceStart = now - startedAt;
    const limit = anyOutput ? IDLE_TIMEOUT_MS : FIRST_EVENT_TIMEOUT_MS;
    const age = anyOutput ? idleAge : sinceStart;
    if (age > limit) {
      stalled = true;
      stalledAgeMs = age;
      try {
        child.kill('SIGTERM');
        const reason = anyOutput
          ? `Pi idle for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s mid-stream with no tool running — upstream connection stalled.`
          : `Pi produced no output in ${Math.round(FIRST_EVENT_TIMEOUT_MS / 1000)}s — upstream never responded.`;
        emitLog(build.id, 'error', `${reason} Killed.`, iteration.id);
      } catch {}
    }
  }, 10000);

  let stdoutBuf = '';
  let stderrBuf = '';
  // One log line per iteration for a failing incremental write — see the
  // catch below. A repeat is always the same cause.
  let incrementalWriteFailed = false;

  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  child.stdout.on('data', (chunk: string) => {
    lastOutputAt = Date.now();
    anyOutput = true;
    stdoutBuf += chunk;
    let nlIdx = stdoutBuf.indexOf('\n');
    while (nlIdx !== -1) {
      const line = stdoutBuf.slice(0, nlIdx).trim();
      stdoutBuf = stdoutBuf.slice(nlIdx + 1);
      nlIdx = stdoutBuf.indexOf('\n');
      if (!line) continue;
      void handleLine(line);
    }
  });

  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 16000) stderrBuf = stderrBuf.slice(-8000);
  });

  async function handleLine(line: string): Promise<void> {
    let ev: PiEvent;
    try {
      // Sanitise here and nowhere else. Everything the iteration persists —
      // tool arguments, tool output, assistant text, the incremental messages
      // write below — descends from this object, so one call covers the lot.
      // A U+0000 anywhere in it makes Postgres reject the whole parameter with
      // 22P05 and costs the iteration its evaluation and next steps; see
      // ./strip-nulls for what that did to build 85dac418.
      ev = stripNulls(JSON.parse(line) as PiEvent);
    } catch {
      return;
    }

    // --- Streaming deltas (live, not persisted) ---
    if (ev.type === 'message_update' && ev.assistantMessageEvent) {
      const sub = ev.assistantMessageEvent;
      const streamId = `${iteration.id}:${sub.contentIndex ?? 0}`;
      if (sub.type === 'text_delta' && sub.delta) {
        emitLive(build.id, {
          type: 'stream_text',
          iterationId: iteration.id,
          streamId,
          delta: sub.delta,
        });
      } else if (sub.type === 'thinking_delta' && sub.delta) {
        emitLive(build.id, {
          type: 'stream_thinking',
          iterationId: iteration.id,
          streamId,
          delta: sub.delta,
        });
      } else if (sub.type === 'tool_input_start') {
        emitLive(build.id, {
          type: 'stream_tool_start',
          iterationId: iteration.id,
          streamId,
        });
      } else if (sub.type === 'tool_input_delta' && sub.delta) {
        emitLive(build.id, {
          type: 'stream_tool_delta',
          iterationId: iteration.id,
          streamId,
          delta: sub.delta,
        });
      } else if (sub.type === 'text_end' || sub.type === 'thinking_end' || sub.type === 'tool_input_end') {
        emitLive(build.id, {
          type: sub.type === 'tool_input_end' ? 'stream_tool_end' : 'stream_turn_end',
          iterationId: iteration.id,
          streamId,
          full: sub.content,
        });
      }
      return;
    }

    if (ev.type !== 'message_end' || !ev.message) return;
    const m = ev.message;

    // --- Assistant message ---
    if (m.role === 'assistant') {
      if (m.usage) {
        tokensUsed += m.usage.totalTokens ?? 0;
        outputTokensUsed += m.usage.output ?? 0;
        if (maxTokensPerIteration > 0 && outputTokensUsed >= maxTokensPerIteration && !tokenCapHit) {
          tokenCapHit = true;
          try {
            child.kill('SIGTERM');
            await emitLog(
              build.id,
              'error',
              `Iteration output-token cap hit (${outputTokensUsed}/${maxTokensPerIteration}). Killed. ` +
                `Whatever the agent had written is preserved in the workspace — resume to continue.`,
              iteration.id,
            );
          } catch {}
        }
        await recordBuildUsage(
          build.id,
          {
            promptTokens: m.usage.input ?? 0,
            completionTokens: m.usage.output ?? 0,
          },
          build.priceSnapshot as PriceSnapshot | null,
        );
      }
      if (m.errorMessage) {
        errorMessage = m.errorMessage;
        if (typeof m.httpStatus === 'number') providerHttpStatus = m.httpStatus;
        if (typeof m.errorCode === 'string') providerErrorCode = m.errorCode;
        await emitLog(build.id, 'error', `Pi error: ${m.errorMessage}`, iteration.id);
      }

      const textParts: string[] = [];
      for (const c of m.content ?? []) {
        if (c.type === 'text' && c.text) {
          textParts.push(c.text);
          await emitLog(build.id, 'text', c.text, iteration.id);
        } else if (c.type === 'thinking' && c.thinking) {
          await emitLog(build.id, 'thinking', c.thinking, iteration.id);
        } else if (c.type === 'toolCall') {
          if (c.id) pendingCalls.set(c.id, { name: c.name ?? 'tool', args: c.arguments });
          // Suspend the idle watchdog for the duration of the call — pi goes
          // silent while it runs, and that silence is work, not a stall.
          if (toolBusySince === null) toolBusySince = Date.now();
          const body = summarizeArgs(c.arguments);
          await emitLog(
            build.id,
            'code',
            `\`\`\`${c.name ?? 'tool'}\n${body}\n\`\`\``,
            iteration.id,
          );
        }
      }
      if (textParts.length) finalAssistantText = textParts.join('\n\n');
      const combined = (m.content ?? [])
        .map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'thinking' ? `[thinking] ${c.thinking ?? ''}` : `[${c.type}:${c.name ?? ''}] ${JSON.stringify(c.arguments ?? {})}`))
        .join('\n');
      if (combined.trim()) messages.push({ role: 'assistant', content: combined.slice(0, 32000) });
    }

    // --- Tool result ---
    else if (m.role === 'toolResult') {
      const resultText = (m.content ?? []).map((c) => c.text ?? '').join('\n');
      const call = m.toolCallId ? pendingCalls.get(m.toolCallId) : undefined;
      if (m.toolCallId) pendingCalls.delete(m.toolCallId);
      // Last outstanding call returned: resume the idle watchdog, and restart
      // its clock so a long tool doesn't leave it instantly expired.
      if (pendingCalls.size === 0) {
        toolBusySince = null;
        lastOutputAt = Date.now();
      }

      const name = call?.name ?? m.toolName ?? 'tool';
      const code = summarizeArgs(call?.args);

      actions.push({
        lang: name,
        code,
        stdout: m.isError ? '' : resultText,
        stderr: m.isError ? resultText : '',
        exitCode: m.isError ? 1 : 0,
      });
      await emitLog(
        build.id,
        m.isError ? 'error' : 'output',
        resultText.slice(0, 4000),
        iteration.id,
      );
      messages.push({
        role: 'user',
        content: `[tool:${name}${m.isError ? ' error' : ''}]\n${resultText}`.slice(0, 32000),
      });
    }

    // --- User (just the initial prompt echo — record but don't log) ---
    else if (m.role === 'user') {
      const text = (m.content ?? []).map((c) => c.text ?? '').join('\n');
      if (text) messages.push({ role: 'user', content: text.slice(0, 32000) });
    }

    // Persist incrementally.
    //
    // This used to swallow every error. It was failing on exactly the same
    // NUL bytes as the end-of-iteration write, which turned a hard error into
    // invisible data truncation for a whole build — the transcript simply
    // stopped growing and nothing said so. Log once per iteration: a repeated
    // failure is the same cause, and 400KB of parameter dump per message would
    // bury the build log.
    await db
      .update(jkaiIterations)
      .set({ messages, tokensUsed })
      .where(eq(jkaiIterations.id, iteration.id))
      .catch((err) => {
        if (incrementalWriteFailed) return;
        incrementalWriteFailed = true;
        void emitLog(
          build.id,
          'error',
          `Could not persist the running transcript: ${describeDbError(err)}. ` +
            `The iteration continues; its message history may be incomplete.`,
          iteration.id,
        );
      });
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  clearInterval(stopTimer);
  clearInterval(idleCheck);
  clearInterval(wallClockCheck);

  if (exitCode !== 0 && !errorMessage) {
    errorMessage = stderrBuf.slice(-2000) || `pi exited with code ${exitCode}`;
    await emitLog(build.id, 'error', `Pi exited non-zero (${exitCode}): ${errorMessage}`, iteration.id);
  }

  const failure = classifyFailure({
    stalled,
    stalledAgeMs,
    wallClockHit,
    tokenCapHit,
    exitCode,
    errorMessage,
    providerHttpStatus,
    providerErrorCode,
    stderrTail: stderrBuf.slice(-2000),
    tokensUsed,
    maxWallClockMs,
  });

  return {
    actions,
    messages,
    finalAssistantText,
    tokensUsed,
    errorMessage,
    failure,
  };
}

export interface ClassifyInput {
  stalled: boolean;
  stalledAgeMs: number;
  wallClockHit: boolean;
  tokenCapHit: boolean;
  exitCode: number;
  errorMessage: string | null;
  providerHttpStatus: number | undefined;
  providerErrorCode: string | undefined;
  stderrTail: string;
  tokensUsed: number;
  maxWallClockMs: number;
}

/**
 * Lines pi's own extensions write to stderr. They are not provider output, so
 * an HTTP status inside one says nothing about our API key — matching them as
 * auth failures relabelled two watchdog kills as `auth_failed` on 2026-08-07
 * and sent the diagnosis off in the wrong direction for a day.
 */
const EXTENSION_LOG_LINE = /^\s*\[[\w-]+\]\s/;

function stripExtensionLogs(text: string): string {
  return text
    .split('\n')
    .filter((line) => !EXTENSION_LOG_LINE.test(line))
    .join('\n');
}

const BRIDGE_FAILURE = /\[jkai-tools\][^\n]*manifest fetch (failed|error)/i;

/** Pi's own startup refusal, verbatim: `No API key found for openai-codex.` */
const PI_MISSING_LOGIN = /^No API key found for ([\w-]+)/m;

export function classifyFailure(i: ClassifyInput): FailureEnvelope | null {
  const stderrLc = i.stderrTail.toLowerCase();
  // Classify on what the PROVIDER said, not on everything that reached stderr.
  const errLc = stripExtensionLogs(i.errorMessage ?? '').toLowerCase();

  // Budget stops first. Both are deliberate, both preserve the work, and both
  // are continuable — nothing below may steal them and turn a paused build into
  // an aborted one.
  if (i.tokenCapHit) {
    return base('iteration_token_cap',
      `Iteration hit its token ceiling (${i.tokensUsed}). Work so far is preserved in dev/ — the next iteration continues from it.`,
      i);
  }

  if (i.wallClockHit) {
    return base('wall_clock_timeout',
      `Pi exceeded wall-clock cap (${Math.round(i.maxWallClockMs / 1000)}s).`, i);
  }

  // An explicit provider status beats everything below: it came from the API
  // response itself, not from parsing text.
  if (i.providerHttpStatus === 401 || i.providerHttpStatus === 403) {
    return base('auth_failed', i.errorMessage ?? 'Provider rejected the API key.', i);
  }

  // The tool bridge failing is its own diagnosis, and a far more useful one
  // than whatever killed the run afterwards: the agent had no site tools at
  // all. Checked ahead of the text-matched auth guess and the stall, because a
  // tool-less agent flails and flailing is what trips the watchdog.
  //
  // Guarded on there actually being a failure, though. The extension fetches
  // the manifest ONCE at startup and then lets pi carry on regardless, so a
  // single transient blip leaves that line sitting in stderrTail for the rest
  // of the run. Unguarded, this would fail an iteration that went on to finish
  // perfectly well on read/write/edit/bash alone.
  const reallyFailed =
    i.exitCode !== 0 || i.stalled || Boolean(i.errorMessage);
  if (reallyFailed && BRIDGE_FAILURE.test(i.stderrTail)) {
    return base(
      'tooling_unavailable',
      'The jkai tool bridge did not load — the agent ran with NO site tools. ' +
        'Check JKAI_API_URL is reachable from the builder process (it is read once at start, ' +
        'so restart the service after editing .env) and that /api/jkai/tools/manifest is ' +
        'exempted from the auth gate in hooks.server.ts.',
      i,
    );
  }

  // Pi refusing to start for want of a login. Read off raw stderr rather than
  // errorMessage because pi prints this before it opens the JSON stream, so
  // there is no provider output at all — just exit 1 and this line, which the
  // generic branch below would report as the useless `pi exited with code 1`.
  if (reallyFailed && PI_MISSING_LOGIN.test(i.stderrTail)) {
    const provider = i.stderrTail.match(PI_MISSING_LOGIN)?.[1] ?? 'the provider';
    return base(
      'auth_failed',
      provider === 'openai-codex'
        ? 'Pi has no ChatGPT login, so the Codex build never started. Codex builds run on ' +
            "pi's native openai-codex provider, which authenticates from ~/.pi/agent/auth.json — " +
            "a separate login from the bridge's ~/.codex/auth.json. Fix it on the build host: run " +
            '`pi`, then `/login`, and choose ChatGPT Plus/Pro (Codex).'
        : `Pi has no credentials for ${provider} — set its API key on the build host, or pick another model.`,
      i,
    );
  }

  // Auth failure by text match — only on provider output, once extension
  // chatter has been stripped out. Matching raw stderr here is what relabelled
  // two watchdog kills as `auth_failed` on 2026-08-07.
  if (/401|403|unauthorized|forbidden|invalid[\s-]*api[\s-]*key/.test(errLc)) {
    return base('auth_failed',
      i.errorMessage ?? 'Provider rejected the API key.', i);
  }

  // Rate limited
  if (i.providerHttpStatus === 429 || /429|rate[\s_-]*limit/.test(errLc)) {
    return base('rate_limited',
      i.errorMessage ?? 'Provider rate limit hit.', i);
  }

  if (i.stalled) {
    return base('stalled',
      i.tokensUsed > 0
        ? `Pi stream went quiet for ${Math.round(i.stalledAgeMs / 1000)}s mid-flight — the watchdog killed it. This names the watchdog, not the cause: read stderrTail.`
        : `Pi received no response from upstream within ${Math.round(i.stalledAgeMs / 1000)}s.`,
      i);
  }

  // Container missing — look at stderr (docker's own message)
  if (/no such container/.test(stderrLc)) {
    return base('container_missing',
      'Sandbox container disappeared mid-run.', i);
  }

  // Provider error with an explicit error message but exit 0 (pi reports then exits)
  if (i.errorMessage && i.exitCode === 0) {
    return base('provider_error',
      i.errorMessage, i);
  }

  if (i.exitCode !== 0) {
    return base('nonzero_exit',
      i.errorMessage ?? `pi exited with code ${i.exitCode}`, i);
  }

  // Note: empty_output is NOT classified here — the executor decides that
  // based on actions.length, because pi-runner can't tell "pi did nothing"
  // from "pi legitimately finished with no tool calls".
  return null;
}

function base(kind: FailureKind, message: string, i: ClassifyInput): FailureEnvelope {
  return {
    kind,
    message,
    httpStatus: i.providerHttpStatus,
    providerErrorCode: i.providerErrorCode,
    lastEventAgeMs: i.stalled ? i.stalledAgeMs : undefined,
    tokensBeforeStall: i.stalled ? i.tokensUsed : undefined,
    stderrTail: i.stderrTail || undefined,
    attempts: 1,
  };
}

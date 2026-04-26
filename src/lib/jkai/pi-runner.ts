import { spawn } from 'child_process';
import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { emitLog, emitLive } from './log-emitter';
import { recordBuildUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ActionRecord, FailureEnvelope, FailureKind } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { loadKeys } from '$lib/deepdive/keys';
import { getOpenRouterApiKey } from '$lib/server/models/settings';

const CONTAINER_NAME = 'jkai-sandbox';

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

async function resolveApiKey(provider: string): Promise<{ envVar: string; value: string }> {
  if (provider === 'zai') {
    const keys = loadKeys();
    if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
    return { envVar: 'ZAI_API_KEY', value: keys.zaiApiKey };
  }
  if (provider === 'openrouter') {
    const key = await getOpenRouterApiKey();
    if (!key) throw new Error('OpenRouter API key not configured');
    return { envVar: 'OPENROUTER_API_KEY', value: key };
  }
  throw new Error(`Unsupported provider for pi: ${provider}`);
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

  const provider = (build.modelProvider ?? 'openrouter') as string;
  const modelId = build.modelId ?? 'anthropic/claude-sonnet-4.5';
  const { envVar, value: apiKey } = await resolveApiKey(provider);

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
  if (opts.thinkingLevel) {
    piParts.push('--thinking', opts.thinkingLevel);
  }
  piParts.push('--provider', provider);
  piParts.push('--model', sh(modelId));
  piParts.push('--append-system-prompt', sh(systemPrompt));
  piParts.push('-p', sh(userPrompt));
  const piCmd = piParts.join(' ');

  const dockerArgs = [
    'exec',
    '-i',
    '-w', workdir,
    '-e', `${envVar}=${apiKey}`,
    '-e', 'PI_OFFLINE=1',
    '-e', 'PI_TELEMETRY=0',
  ];
  for (const [k, v] of Object.entries(opts.extraEnv ?? {})) {
    if (typeof v === 'string') {
      dockerArgs.push('-e', `${k}=${v}`);
    }
  }
  dockerArgs.push(CONTAINER_NAME, 'bash', '-c', piCmd);

  await emitLog(
    build.id,
    'system',
    `Launching pi agent (${provider}/${modelId})`,
    iteration.id,
  );

  const actions: ActionRecord[] = [];
  const messages: Array<{ role: string; content: string }> = [];
  let finalAssistantText = '';
  let tokensUsed = 0;
  let errorMessage: string | null = null;
  let providerHttpStatus: number | undefined;
  let providerErrorCode: string | undefined;
  let wallClockHit = false;
  // toolCallId → {name, args} captured from the most recent assistant message
  const pendingCalls = new Map<string, { name: string; args: Record<string, unknown> | undefined }>();

  const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  //    slow when upstream (zai) is under load but still recoverable.
  //  - IDLE_TIMEOUT_MS (180s) applies once streaming has started; if the
  //    stream goes quiet mid-flight for this long, the connection has stalled.
  // A stream that never starts hits the first-event cap; one that starts and
  // then dies hits the idle cap.
  const FIRST_EVENT_TIMEOUT_MS = 240 * 1000;
  const IDLE_TIMEOUT_MS = 180 * 1000;
  const startedAt = Date.now();
  let lastOutputAt = Date.now();
  let anyOutput = false;
  let stalled = false;
  let stalledAgeMs = 0;
  const idleCheck = setInterval(() => {
    const now = Date.now();
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
          ? `Pi idle for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s mid-stream — upstream connection stalled.`
          : `Pi produced no output in ${Math.round(FIRST_EVENT_TIMEOUT_MS / 1000)}s — upstream never responded.`;
        emitLog(build.id, 'error', `${reason} Killed.`, iteration.id);
      } catch {}
    }
  }, 10000);

  let stdoutBuf = '';
  let stderrBuf = '';

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
      ev = JSON.parse(line);
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

    // Persist incrementally
    await db
      .update(jkaiIterations)
      .set({ messages, tokensUsed })
      .where(eq(jkaiIterations.id, iteration.id))
      .catch(() => {});
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

interface ClassifyInput {
  stalled: boolean;
  stalledAgeMs: number;
  wallClockHit: boolean;
  exitCode: number;
  errorMessage: string | null;
  providerHttpStatus: number | undefined;
  providerErrorCode: string | undefined;
  stderrTail: string;
  tokensUsed: number;
  maxWallClockMs: number;
}

function classifyFailure(i: ClassifyInput): FailureEnvelope | null {
  const stderrLc = i.stderrTail.toLowerCase();
  const errLc = (i.errorMessage ?? '').toLowerCase();

  // Auth failure — check first so 401/403 doesn't get misclassified as generic provider_error
  if (i.providerHttpStatus === 401 || i.providerHttpStatus === 403 ||
      /401|403|unauthorized|forbidden|invalid[\s-]*api[\s-]*key/.test(errLc)) {
    return base('auth_failed',
      i.errorMessage ?? 'Provider rejected the API key.', i);
  }

  // Rate limited
  if (i.providerHttpStatus === 429 || /429|rate[\s_-]*limit/.test(errLc)) {
    return base('rate_limited',
      i.errorMessage ?? 'Provider rate limit hit.', i);
  }

  if (i.wallClockHit) {
    return base('wall_clock_timeout',
      `Pi exceeded wall-clock cap (${Math.round(i.maxWallClockMs / 1000)}s).`, i);
  }

  if (i.stalled) {
    return base('stalled',
      i.tokensUsed > 0
        ? `Pi stream went quiet for ${Math.round(i.stalledAgeMs / 1000)}s mid-flight — upstream connection stalled.`
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

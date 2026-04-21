import { spawn } from 'child_process';
import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { emitLog } from './log-emitter';
import { recordBuildUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
import type { ActionRecord } from './types';
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
}

interface PiEvent {
  type: string;
  message?: PiMessage;
}

// --- Result ---

export interface PiRunResult {
  actions: ActionRecord[];
  messages: Array<{ role: string; content: string }>;
  finalAssistantText: string;
  tokensUsed: number;
  errorMessage: string | null;
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
  isStopped: () => boolean;
}

export async function runPi(opts: PiRunOptions): Promise<PiRunResult> {
  const {
    build,
    iteration,
    workdir,
    systemPrompt,
    userPrompt,
    maxWallClockMs = 30 * 60 * 1000,
    isStopped,
  } = opts;

  const provider = (build.modelProvider ?? 'openrouter') as string;
  const modelId = build.modelId ?? 'anthropic/claude-sonnet-4.5';
  const { envVar, value: apiKey } = await resolveApiKey(provider);

  const piCmd = [
    'pi',
    '--mode', 'json',
    '--no-session',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--tools', 'read,bash,edit,write,grep,find,ls',
    '--provider', provider,
    '--model', sh(modelId),
    '--append-system-prompt', sh(systemPrompt),
    '-p', sh(userPrompt),
  ].join(' ');

  const dockerArgs = [
    'exec',
    '-i',
    '-w', workdir,
    '-e', `${envVar}=${apiKey}`,
    '-e', 'PI_OFFLINE=1',
    '-e', 'PI_TELEMETRY=0',
    CONTAINER_NAME,
    'bash', '-c', piCmd,
  ];

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
  // toolCallId → {name, args} captured from the most recent assistant message
  const pendingCalls = new Map<string, { name: string; args: Record<string, unknown> | undefined }>();

  const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

  const stopTimer = setInterval(async () => {
    if (isStopped()) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }, 1000);

  const wallClockTimer = setTimeout(() => {
    try {
      child.kill('SIGTERM');
      emitLog(
        build.id,
        'system',
        `Pi wall-clock timeout reached (${Math.round(maxWallClockMs / 1000)}s)`,
        iteration.id,
      );
    } catch {}
  }, maxWallClockMs);

  let stdoutBuf = '';
  let stderrBuf = '';

  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  child.stdout.on('data', (chunk: string) => {
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
  clearTimeout(wallClockTimer);

  if (exitCode !== 0 && !errorMessage) {
    errorMessage = stderrBuf.slice(-2000) || `pi exited with code ${exitCode}`;
    await emitLog(build.id, 'error', `Pi exited non-zero (${exitCode}): ${errorMessage}`, iteration.id);
  }

  return {
    actions,
    messages,
    finalAssistantText,
    tokensUsed,
    errorMessage,
  };
}

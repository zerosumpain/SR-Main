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

// --- Pi JSON event shape (subset we care about) ---

interface PiContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

interface PiMessage {
  role: 'user' | 'assistant';
  content?: PiContent[];
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost?: { total: number } };
  errorMessage?: string;
}

interface PiEvent {
  type: string;
  message?: PiMessage;
  toolResults?: Array<{ name?: string; content?: PiContent[]; is_error?: boolean }>;
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

function contentToString(content: PiContent[] | undefined): string {
  if (!content) return '';
  return content
    .map((c) => {
      if (c.type === 'text') return c.text ?? '';
      if (c.type === 'thinking') return `[thinking] ${c.text ?? ''}`;
      if (c.type === 'tool_use') return `[tool:${c.name}] ${JSON.stringify(c.input ?? {})}`;
      if (c.type === 'tool_result') {
        const inner = (c.content ?? []).map((x) => x.text ?? '').join('\n');
        return `[tool-result${c.is_error ? ' error' : ''}]\n${inner}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function toolUseToAction(toolUse: PiContent, result?: PiContent): ActionRecord {
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const lang = toolUse.name ?? 'tool';
  const code =
    typeof input.command === 'string'
      ? (input.command as string)
      : typeof input.content === 'string'
        ? `[write ${input.path}]\n${input.content}`
        : typeof input.path === 'string'
          ? `[${lang} ${input.path}]`
          : JSON.stringify(input, null, 2);
  const resultText = (result?.content ?? []).map((x) => x.text ?? '').join('\n');
  const isError = Boolean(result?.is_error);
  return {
    lang,
    code,
    stdout: isError ? '' : resultText,
    stderr: isError ? resultText : '',
    exitCode: isError ? 1 : 0,
  };
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
    maxWallClockMs = 10 * 60 * 1000,
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
  const pendingToolUses = new Map<string, PiContent>();

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
      emitLog(build.id, 'system', `Pi wall-clock timeout reached (${Math.round(maxWallClockMs / 1000)}s)`, iteration.id);
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

    if (ev.type === 'message_end' && ev.message) {
      const m = ev.message;
      const role = m.role;
      const contentStr = contentToString(m.content);

      if (role === 'assistant') {
        // Track tool uses for later matching with tool_result
        for (const c of m.content ?? []) {
          if (c.type === 'tool_use') {
            const id = (c as { id?: string } & PiContent).id;
            if (id) pendingToolUses.set(id, c);
          }
        }
        // Record tokens + cost
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
        // Emit text segments for UI
        for (const c of m.content ?? []) {
          if (c.type === 'text' && c.text) {
            finalAssistantText = c.text;
            await emitLog(build.id, 'text', c.text, iteration.id);
          } else if (c.type === 'thinking' && c.text) {
            await emitLog(build.id, 'thinking', c.text, iteration.id);
          } else if (c.type === 'tool_use') {
            const code =
              typeof c.input?.command === 'string'
                ? (c.input.command as string)
                : JSON.stringify(c.input ?? {}, null, 2);
            await emitLog(
              build.id,
              'code',
              `\`\`\`${c.name}\n${code}\n\`\`\``,
              iteration.id,
            );
          }
        }
      } else if (role === 'user') {
        // Tool results for prior tool_uses
        for (const c of m.content ?? []) {
          if (c.type === 'tool_result') {
            const tuId = (c as { tool_use_id?: string } & PiContent).tool_use_id;
            const tu = tuId ? pendingToolUses.get(tuId) : undefined;
            if (tu) {
              actions.push(toolUseToAction(tu, c));
              pendingToolUses.delete(tuId!);
            } else {
              actions.push(toolUseToAction({ type: 'tool_use', name: 'unknown' }, c));
            }
            const txt = (c.content ?? []).map((x) => x.text ?? '').join('\n');
            await emitLog(
              build.id,
              c.is_error ? 'error' : 'output',
              txt.slice(0, 4000),
              iteration.id,
            );
          }
        }
      }

      if (contentStr) {
        messages.push({ role, content: contentStr.slice(0, 32000) });
        // Persist incrementally
        await db
          .update(jkaiIterations)
          .set({ messages, tokensUsed })
          .where(eq(jkaiIterations.id, iteration.id))
          .catch(() => {});
      }
    }
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

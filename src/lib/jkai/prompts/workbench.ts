// Prompt workbench model — one place that answers "which prompt actually runs
// where, and what is in it right now".
//
// Two independent stacks feed jkai, and until this existed the UI showed only
// the second while claiming to be the first:
//
//   chat    → Hermes runtime on homeserv (~/.hermes-jkai/*.md). Shaped every
//             /jkai reply, WhatsApp reply, and delegated agent turn while
//             Hermes answered chat. Since 2026-08-24 it does not, so this
//             stack is dormant and read-only — kept because flipping
//             `jkai.chat.hermes_enabled` back is the rollback.
//   builder → this repo's data/prompts/*.md, compiled into prompt_cache and
//             prepended to the canvas workflow generator's system prompt
//             (generateWorkflow / modifyWorkflow) and the dormant in-process
//             general-chat fallback.
import { getPromptFiles, savePromptFile, syncPrompts, compilePromptFiles } from '$lib/workflows/prompts/loader';
import {
  listHermesPrompts,
  saveHermesPrompt,
  hermesPromptsReachable,
  isHermesPromptFile,
  type PromptFileEntry,
} from './hermes-store';
import { ensureCollection, queryRecords, upsertRecord } from '$lib/datastore';
import { hermesWillAnswerChat } from '$lib/resilience/hermes-reach';
import { isHermesChatEnabled } from '$lib/server/models/settings';
import { env } from '$env/dynamic/private';

export type StackId = 'chat' | 'builder';

export interface PromptStack {
  id: StackId;
  label: string;
  /** What executes this prompt. */
  runtime: string;
  /** Which product surfaces it reaches. */
  surfaces: string[];
  /** Whether this stack is in the live request path on this deployment. */
  live: boolean;
  editable: boolean;
  /** Why it is or is not live — shown verbatim in the UI. */
  note: string;
  files: PromptFileEntry[];
  error?: string;
}

export const VERSIONS_COLLECTION = 'prompt-versions';
const OWNER = 'owner';

/**
 * Token estimate. Deliberately an estimate, labelled as one in the UI: the real
 * count depends on the model's tokenizer and we are not shipping one just to
 * put a number on a page. ~4 chars/token holds well enough for English prose.
 */
export function approxTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

export function stackTokens(files: PromptFileEntry[]): number {
  return files.reduce((n, f) => n + approxTokens(f.content), 0);
}

/**
 * Does Hermes actually answer chat right now?
 *
 * This used to read `JKAI_HERMES_CANVAS_CHAT` alone, which stopped being the
 * answer when the engine moved behind a settings row. On 2026-08-24 the env var
 * still said `1` while `jkai.chat.hermes_enabled` was false, so this page had
 * both stacks exactly backwards — it labelled the dead `~/.hermes-jkai` files
 * "Live. Every /jkai reply is composed from these files" and told you the
 * `data/prompts` stack, which is the one actually running, did not shape chat.
 * Editing the "live" stack then wrote files over Tailscale to a stopped engine
 * and reported success.
 *
 * So ask the same question the chat route asks, the same way, and the two
 * cannot disagree again. The env var stays as the fallback argument, which is
 * exactly the role it has at every other call site.
 */
async function chatIsLive(): Promise<boolean> {
  return hermesWillAnswerChat(
    isHermesChatEnabled,
    env.JKAI_HERMES_CANVAS_CHAT === '1',
    env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790',
  );
}

/** Both stacks with their current contents. Never throws — a stack that can't be read reports `error`. */
export async function loadStacks(): Promise<PromptStack[]> {
  const hermesLive = await chatIsLive();

  let hermesFiles: PromptFileEntry[] = [];
  let hermesError: string | undefined;
  try {
    hermesFiles = hermesPromptsReachable()
      ? await listHermesPrompts()
      : [];
    if (!hermesPromptsReachable()) {
      hermesError = 'Hermes runs on homeserv and this host has no route to it (set HOMESERV_SITE_URL).';
    }
  } catch (err) {
    hermesError = err instanceof Error ? err.message : 'could not read the Hermes prompt stack';
  }

  const builderFiles = getPromptFiles();

  return [
    {
      id: 'chat',
      label: 'Chat personality',
      runtime: 'Hermes runtime (homeserv)',
      // Surfaces follow the engine. With Hermes off these files shape nothing
      // at all, and listing WhatsApp here was the most misleading of the four —
      // WhatsApp now runs from the VPS worker against the in-process loop.
      surfaces: hermesLive ? ['/jkai chat', 'WhatsApp', 'delegated agents', '/jkai/builds'] : [],
      live: hermesLive,
      // Never offer to write to an engine that is not running. Saving reached
      // homeserv over Tailscale and reported success while changing nothing
      // about any reply.
      editable: hermesLive && !hermesError,
      note: hermesLive
        ? 'Live. Every /jkai reply is composed from these files. Hermes also appends its skills and tool schemas at runtime, which are not shown here.'
        : 'Not live. Hermes does not answer chat, so nothing reads these files — they are kept as the rollback. Read-only until the engine is switched back.',
      files: hermesFiles,
      error: hermesError,
    },
    {
      id: 'builder',
      label: 'Canvas builder',
      runtime: 'In-process orchestrator (this app)',
      surfaces: hermesLive
        ? ['/jkai/canvas workflow generation', 'workflow modification']
        : ['/jkai chat', 'WhatsApp', 'delegated agents', '/jkai/canvas workflow generation', 'workflow modification'],
      live: true,
      editable: true,
      note: hermesLive
        ? 'Live for canvas workflow generation only. These files are prepended to the workflow generator system prompt — they do NOT shape /jkai chat replies while Hermes is on.'
        : 'Live, and this is the stack that answers chat. #437 merged the chat soul in here, so these files shape every /jkai and WhatsApp reply as well as canvas generation.',
      files: builderFiles,
    },
  ];
}

/**
 * The assembled prompt for a stack — what the files add up to before the
 * runtime appends its own scaffolding.
 */
export async function resolveStack(id: StackId): Promise<{ text: string; approxTokens: number; caveat: string }> {
  if (id === 'builder') {
    const { compiled } = compilePromptFiles();
    return {
      text: compiled,
      approxTokens: approxTokens(compiled),
      caveat:
        'Files joined with "---" separators, then prepended to the workflow-generator system prompt (tool schemas, node catalogue and workspace grounding are added after this).',
    };
  }

  const files = await listHermesPrompts();
  const text = files
    .filter((f) => f.content.trim())
    .map((f) => `# ── ${f.name} ──\n\n${f.content.trim()}`)
    .join('\n\n');
  return {
    text,
    approxTokens: approxTokens(text),
    caveat:
      'The parts Hermes composes from. Hermes adds the active skill, tool schemas and conversation memory on top at request time, so the live prompt is larger than this.',
  };
}

export interface PromptVersion {
  stack: StackId;
  file: string;
  content: string;
  savedAt: string;
  approxTokens: number;
}

async function ensureVersions(): Promise<void> {
  await ensureCollection(
    VERSIONS_COLLECTION,
    {
      name: 'Prompt versions',
      description: 'Every save made through the /jkai/prompts workbench, for diff + restore',
      isSystem: true,
      defaultPermissions: { read: ['owner', 'jkai'], write: ['owner'], delete: ['owner'] },
    },
    OWNER,
  );
}

/**
 * Save a prompt file and snapshot the previous content so an edit is always
 * reversible. The snapshot is taken BEFORE the write, so history holds what the
 * file used to be.
 */
export async function savePrompt(stack: StackId, file: string, content: string): Promise<void> {
  const stacks = await loadStacks();
  const target = stacks.find((s) => s.id === stack);
  if (!target) throw new Error(`unknown stack: ${stack}`);
  // `editable` now also goes false when the stack's engine is not running, so
  // say which of the two it is — "not editable from this host" sent you looking
  // for a routing problem when the answer was that nothing reads the file.
  if (!target.editable) {
    throw new Error(
      target.error ??
        (target.live
          ? `${stack} prompts are not editable from this host`
          : `${stack} prompts are read-only because that engine is not running — nothing would read the change`),
    );
  }

  const previous = target.files.find((f) => f.name === file);
  if (!previous) throw new Error(`unknown prompt file: ${file}`);

  await snapshot({ stack, file, content: previous.content, savedAt: new Date().toISOString(), approxTokens: approxTokens(previous.content) });

  if (stack === 'chat') {
    if (!isHermesPromptFile(file)) throw new Error(`unknown prompt file: ${file}`);
    await saveHermesPrompt(file, content);
  } else {
    savePromptFile(file, content);
    // The orchestrator reads the compiled prompt from prompt_cache, not from
    // disk — without this re-sync the edit would not take effect.
    await syncPrompts();
  }
}

async function snapshot(v: PromptVersion): Promise<void> {
  try {
    await ensureVersions();
    await upsertRecord(
      VERSIONS_COLLECTION,
      { key: `${v.stack}:${v.file}:${v.savedAt}`, data: v as unknown as Record<string, unknown> },
      OWNER,
    );
  } catch (err) {
    // History is a convenience; never block a save on it.
    console.warn('[prompts] version snapshot failed:', err instanceof Error ? err.message : err);
  }
}

/** Past versions of one file, newest first. */
export async function listVersions(stack: StackId, file: string, limit = 20): Promise<PromptVersion[]> {
  try {
    await ensureVersions();
    const { records } = await queryRecords(
      VERSIONS_COLLECTION,
      { sort: { field: 'createdAt', dir: 'desc' }, limit: 200 },
      OWNER,
    );
    return records
      .map((r) => r.data as unknown as PromptVersion)
      .filter((v) => v.stack === stack && v.file === file)
      .slice(0, limit);
  } catch {
    return [];
  }
}

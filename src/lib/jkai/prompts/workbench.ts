// Prompt workbench model — one place that answers "which prompt actually runs
// where, and what is in it right now".
//
// Two independent stacks feed jkai, and until this existed the UI showed only
// the second while claiming to be the first:
//
//   chat    → Hermes runtime on homeserv (~/.hermes-jkai/*.md). Shapes every
//             /jkai reply, WhatsApp reply, and delegated agent turn whenever
//             JKAI_HERMES_CANVAS_CHAT=1 (it is, on both hosts).
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

function chatIsLive(): boolean {
  // $env/dynamic/private, not process.env — the flag lives in .env and only the
  // dynamic module sees it in dev.
  return env.JKAI_HERMES_CANVAS_CHAT === '1';
}

/** Both stacks with their current contents. Never throws — a stack that can't be read reports `error`. */
export async function loadStacks(): Promise<PromptStack[]> {
  const hermesLive = chatIsLive();

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
      surfaces: ['/jkai chat', 'WhatsApp', 'delegated agents', '/jkai/builds'],
      live: hermesLive,
      editable: !hermesError,
      note: hermesLive
        ? 'Live. Every /jkai reply is composed from these files. Hermes also appends its skills and tool schemas at runtime, which are not shown here.'
        : 'Not currently live — JKAI_HERMES_CANVAS_CHAT is off on this host, so chat falls back to the in-process loop below.',
      files: hermesFiles,
      error: hermesError,
    },
    {
      id: 'builder',
      label: 'Canvas builder',
      runtime: 'In-process orchestrator (this app)',
      surfaces: ['/jkai/canvas workflow generation', 'workflow modification', 'general-chat fallback'],
      live: true,
      editable: true,
      note: hermesLive
        ? 'Live for canvas workflow generation only. These files are prepended to the workflow generator system prompt — they do NOT shape /jkai chat replies while Hermes is on.'
        : 'Live for canvas workflow generation and, with Hermes off, for chat replies too.',
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
  if (!target.editable) throw new Error(target.error ?? `${stack} prompts are not editable from this host`);

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

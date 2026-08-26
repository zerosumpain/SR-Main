// Prompt workbench model — one place that answers "which prompt actually runs
// where, and what is in it right now".
//
// One stack now: this repo's `data/prompts/*.md`, compiled into `prompt_cache`.
// It shapes every /jkai and WhatsApp reply as well as canvas workflow
// generation. There used to be a second — the Hermes runtime's own `.md` files
// on homeserv — and the page's whole reason for existing was that the UI showed
// one while claiming to be the other. With Hermes gone there is nothing left to
// confuse it with.
import { getPromptFiles, savePromptFile, syncPrompts, compilePromptFiles } from '$lib/workflows/prompts/loader';
import type { PromptFileEntry } from '$lib/workflows/prompts/loader';
import { ensureCollection, queryRecords, upsertRecord } from '$lib/datastore';

export type StackId = 'builder';

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

/** Every stack with its current contents. Never throws — a stack that can't be read reports `error`. */
export async function loadStacks(): Promise<PromptStack[]> {
  return [
    {
      id: 'builder',
      label: 'Canvas builder',
      runtime: 'In-process orchestrator (this app)',
      surfaces: ['/jkai chat', 'WhatsApp', 'delegated agents', '/jkai/canvas workflow generation', 'workflow modification'],
      live: true,
      editable: true,
      note: 'Live, and this is the stack that answers chat. #437 merged the chat soul in here, so these files shape every /jkai and WhatsApp reply as well as canvas generation.',
      files: getPromptFiles(),
    },
  ];
}

/**
 * The assembled prompt for a stack — what the files add up to before the
 * runtime appends its own scaffolding.
 */
export async function resolveStack(_id: StackId): Promise<{ text: string; approxTokens: number; caveat: string }> {
  const { compiled } = compilePromptFiles();
  return {
    text: compiled,
    approxTokens: approxTokens(compiled),
    caveat:
      'Files joined with "---" separators, then prepended to the workflow-generator system prompt (tool schemas, node catalogue and workspace grounding are added after this).',
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
  if (!target.editable) {
    throw new Error(target.error ?? `${stack} prompts are not editable from this host`);
  }

  const previous = target.files.find((f) => f.name === file);
  if (!previous) throw new Error(`unknown prompt file: ${file}`);

  await snapshot({ stack, file, content: previous.content, savedAt: new Date().toISOString(), approxTokens: approxTokens(previous.content) });

  savePromptFile(file, content);
  // The orchestrator reads the compiled prompt from prompt_cache, not from
  // disk — without this re-sync the edit would not take effect.
  await syncPrompts();
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

// Request-time query classification — zero extra LLM call. Reuses the existing
// keyword classifier (inferToolsets) plus request signals. Runs once per
// conversation (first message); the success loop corrects misroutes over time.
import { inferToolsets } from '$lib/workflows/site-tools/keyword-classifier';
import type { ModelProfile } from './types';

/** Toolsets that mean "this turn will fan out to real actions" → tool-heavy. */
const ACTION_TOOLSETS = new Set([
  'home',
  'gmail',
  'workflows',
  'monitors',
  'scraper',
  'web',
  'apis',
  'datastore',
  'builds',
  'node-builder',
  'media',
  'blog',
]);

/** Toolsets that mean "retrieve then answer" → RAG-fast. */
const RAG_TOOLSETS = new Set(['files', 'knowledge', 'research']);

export interface ClassifyInput {
  message: string;
  workflowId?: string | null;
  mode?: string | null;
  hasAttachments?: boolean;
}

export interface ClassifyResult {
  profile: ModelProfile;
  reason: string;
}

export function classifyQuery(input: ClassifyInput): ClassifyResult {
  // Canvas / workflow context is inherently agentic.
  if (input.workflowId || input.mode === 'generate' || input.mode === 'modify') {
    return { profile: 'agentic', reason: 'workflow/canvas context' };
  }

  const inferred = new Set(inferToolsets(input.message ?? ''));
  const actionCount = [...inferred].filter((t) => ACTION_TOOLSETS.has(t)).length;
  const ragCount = [...inferred].filter((t) => RAG_TOOLSETS.has(t)).length;

  // Explicit delegation, or a broad multi-tool ask → agentic.
  if (inferred.has('agents') || actionCount >= 3) {
    return { profile: 'agentic', reason: inferred.has('agents') ? 'delegation requested' : `${actionCount} action toolsets` };
  }
  // Retrieval-led (and not simultaneously action-heavy) → RAG-fast.
  if ((ragCount > 0 || input.hasAttachments) && actionCount <= 1) {
    return { profile: 'rag', reason: ragCount > 0 ? 'retrieval mentions' : 'attachment present' };
  }
  // At least one action → tool-heavy.
  if (actionCount >= 1) {
    return { profile: 'tool', reason: `${actionCount} action toolset(s)` };
  }
  return { profile: 'general', reason: 'conversational' };
}

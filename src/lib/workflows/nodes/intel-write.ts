import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { createNote, processNote } from '$lib/jkai/intel/ingest';

export { intelWriteDef } from './intel-write.def';

type IntelFormat = 'text' | 'summary' | 'email' | 'meeting_transcript';
const ALLOWED_FORMATS: IntelFormat[] = ['text', 'summary', 'email', 'meeting_transcript'];

export const intelWriteExecutor: NodeExecutor = {
  type: 'intel-write',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const content = interpolateTemplate((config.content as string) || '', input).trim();
    if (!content) {
      return { output: { success: false, error: 'intel-write: content is required' }, rowCount: 1 };
    }

    const rawTitle = interpolateTemplate((config.title as string) || '', input).trim();
    const title = rawTitle || undefined;

    const formatRaw = (config.format as string) || 'summary';
    const format: IntelFormat = (ALLOWED_FORMATS as string[]).includes(formatRaw)
      ? (formatRaw as IntelFormat)
      : 'summary';

    const sourceTag = interpolateTemplate((config.sourceTag as string) || '', input).trim();
    const sourceUrl = interpolateTemplate((config.sourceUrl as string) || '', input).trim();

    const extraRaw = interpolateTemplate((config.extraMetadata as string) || '', input).trim();
    let extra: Record<string, unknown> = {};
    if (extraRaw) {
      try {
        const parsed = JSON.parse(extraRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extra = parsed as Record<string, unknown>;
        }
      } catch (err) {
        // Non-fatal: we keep going with an empty extras object but record the
        // problem so callers can see why their metadata didn't land.
        extra = { _extraMetadataParseError: String((err as Error).message) };
      }
    }

    const metadata: Record<string, unknown> = {
      ...extra,
      workflowId: context.workflowId,
      workflowRunId: context.runId,
    };
    if (sourceTag) metadata.sourceTag = sourceTag;
    if (sourceUrl) metadata.sourceUrl = sourceUrl;

    const noteId = await createNote({
      title,
      rawContent: content,
      source: 'workflow',
      format,
      metadata,
    });

    // Fire-and-forget: extraction + embedding + graph persistence run async so
    // the workflow doesn't block on LLM extraction for each note.
    processNote(noteId).catch((err) => {
      console.error(`[intel-write] Background processing failed for note ${noteId}:`, err);
    });

    return {
      output: {
        success: true,
        noteId,
        status: 'processing',
        sourceTag: sourceTag || null,
        sourceUrl: sourceUrl || null,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields (title, content, sourceTag, sourceUrl, extraMetadata).' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        noteId: { type: 'string', description: 'ID of the created intel note.' },
        status: { type: 'string', description: 'Processing status at return time (usually "processing" — extraction + embedding run async).' },
        sourceTag: { type: 'string', description: 'Echoed source tag (null if not set).' },
        sourceUrl: { type: 'string', description: 'Echoed source URL (null if not set).' },
        error: { type: 'string' },
      },
    };
  },
};

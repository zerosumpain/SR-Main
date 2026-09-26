// file-build — synthesise a new file (docx/pdf/html/xlsx/csv) from input
// content. Replaces file-extract's "synthesize" mode so the orchestrator
// picks one node with a simple config instead of fighting a discriminated
// union.
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';
import { fileBuildDef } from './file-build.def';
import { getPath as resolvePath } from '../expressions';
import { isReservedForOwnerLane } from '$lib/drive/namespace';
export { fileBuildDef } from './file-build.def';

function coerceContent(raw: unknown, source: SynthesizeSource): string | Buffer {
  if (source === 'xlsx') {
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    if (typeof raw === 'string') return Buffer.from(raw, 'base64');
    throw new ExtractError('E_INVALID_INPUT', 'xlsx source requires Buffer or base64 string');
  }
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw === null || raw === undefined) return '';
  return JSON.stringify(raw);
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return false;
}

async function writeWorkflowFile(name: string, buffer: Buffer, mimeType: string): Promise<{ id: string; name: string }> {
  const cleanName = name.replace(/^\/+/, '').slice(0, 200);
  // Workflows write the owner's files only; members/<id>/ is theirs ($lib/drive/namespace).
  if (isReservedForOwnerLane(cleanName)) throw new Error(`file-build: "${cleanName}" is in the members' area of the drive, which workflows cannot touch`);
  const owner = eq(workflowFiles.principalId, 'owner');
  const [existing] = await db.select().from(workflowFiles).where(and(owner, eq(workflowFiles.name, cleanName)));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(and(owner, eq(workflowFiles.id, existing.id)));
    return { id: existing.id, name: existing.name };
  }
  const diskPath = newDiskPath(cleanName);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name: cleanName,
    mimeType,
    sizeBytes: buffer.byteLength,
    diskPath,
    permissions: { read: true, write: true, append: false, delete: false },
  }).returning();
  return { id: inserted.id, name: inserted.name };
}

export const fileBuildExecutor: NodeExecutor = {
  type: 'file-build',
  async execute(input, config, _context: ExecutionContext): Promise<NodeResult> {
    const format = config.format as SynthesizeFormat | undefined;
    const source = config.source as SynthesizeSource | undefined;
    if (!format) throw new Error('file-build: format is required (docx | pdf | html | xlsx | csv)');
    if (!source) throw new Error('file-build: source is required (markdown | text | json | csv | xlsx)');

    const contentPath = (config.contentPath as string) || 'input.content';
    const raw = resolvePath({ input } as Record<string, unknown>, contentPath);
    const content = coerceContent(raw, source);
    const title = (config.title as string) || undefined;

    try {
      const result = await synthesize({ format, source, content, title });
      let persisted: { id: string; name: string } | undefined;
      if (toBool(config.persist)) {
        const outputName = interpolateTemplate((config.outputName as string) || '', input).trim();
        if (!outputName) throw new Error('file-build: outputName is required when persist=true');
        persisted = await writeWorkflowFile(outputName, result.buffer, result.mimeType);
      }
      return {
        output: {
          base64: result.buffer.toString('base64'),
          mimeType: result.mimeType,
          sizeBytes: result.buffer.length,
          suggestedExtension: result.suggestedExtension,
          file: persisted,
        },
        rowCount: 1,
      };
    } catch (err) {
      if (err instanceof ExtractError) {
        throw new Error(`file-build: ${err.code}: ${err.message}`);
      }
      throw err;
    }
  },
  getInputSchema(): JsonSchema {
    return { type: 'object', description: 'Provide content via the path named in `contentPath` (default `input.content`).' };
  },
  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        base64: { type: 'string' } as const,
        mimeType: { type: 'string' } as const,
        sizeBytes: { type: 'number' } as const,
        suggestedExtension: { type: 'string' } as const,
        file: { type: 'object' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

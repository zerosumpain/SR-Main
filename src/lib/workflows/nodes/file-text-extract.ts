// file-text-extract — pull plain text + structured metadata from a file in
// the workflow file store. Replaces file-extract's "extract" mode so the
// orchestrator picks one node with a simple config instead of fighting a
// discriminated union.
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, ExtractError } from '$lib/jkai/extract';
import { fileTextExtractDef } from './file-text-extract.def';
export { fileTextExtractDef } from './file-text-extract.def';

function permissionsFor(raw: unknown): WorkflowFilePermissions {
  const p = (raw ?? {}) as Partial<WorkflowFilePermissions>;
  return {
    read: p.read !== false,
    write: !!p.write,
    append: !!p.append,
    delete: !!p.delete,
  };
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return false;
}

async function writeWorkflowFile(name: string, buffer: Buffer, mimeType: string): Promise<{ id: string; name: string }> {
  const cleanName = name.replace(/^\/+/, '').slice(0, 200);
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, cleanName));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id));
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

export const fileTextExtractExecutor: NodeExecutor = {
  type: 'file-text-extract',
  async execute(input, config, _context: ExecutionContext): Promise<NodeResult> {
    const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
    if (!fileName) throw new Error('file-text-extract: fileName is required');

    const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
    if (!existing) throw new Error(`file-text-extract: file not found: ${fileName}`);
    const perms = permissionsFor(existing.permissions);
    if (!perms.read) throw new Error(`file-text-extract: read permission denied on ${fileName}`);

    const buf = await readBuffer(existing.diskPath);
    const pageFrom = config.pageFrom ? Number(config.pageFrom) : undefined;
    const pageTo = config.pageTo ? Number(config.pageTo) : undefined;
    const language = (config.language as string) || undefined;

    try {
      const result = await extractText(buf, existing.mimeType, existing.name, {
        pages: pageFrom ? { from: pageFrom, to: pageTo ?? pageFrom } : undefined,
        language,
      });

      let persisted: { id: string; name: string } | undefined;
      if (toBool(config.persist)) {
        const outputName = interpolateTemplate((config.outputName as string) || '', input).trim()
          || `${existing.name}.extracted.txt`;
        persisted = await writeWorkflowFile(outputName, Buffer.from(result.text, 'utf8'), 'text/plain');
      }

      return {
        output: {
          text: result.text,
          meta: result.meta,
          sourceFile: { id: existing.id, name: existing.name, mimeType: existing.mimeType },
          file: persisted,
        },
        rowCount: 1,
      };
    } catch (err) {
      if (err instanceof ExtractError) {
        throw new Error(`file-text-extract: ${err.code}: ${err.message}`);
      }
      throw err;
    }
  },
  getInputSchema(): JsonSchema {
    return { type: 'object', description: 'No required input — the file is loaded by name from the file store.' };
  },
  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        text: { type: 'string' } as const,
        meta: { type: 'object' } as const,
        sourceFile: { type: 'object' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

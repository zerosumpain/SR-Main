// src/lib/workflows/nodes/file-extract.ts
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';

export { fileExtractDef } from './file-extract.def';

function permissionsFor(raw: unknown): WorkflowFilePermissions {
  const p = (raw ?? {}) as Partial<WorkflowFilePermissions>;
  return {
    read: p.read !== false,
    write: !!p.write,
    append: !!p.append,
    delete: !!p.delete,
  };
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

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

export const fileExtractExecutor: NodeExecutor = {
  type: 'file-extract',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as 'extract' | 'synthesize') || 'extract';

    if (mode === 'extract') {
      const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
      if (!fileName) throw new Error('file-extract: fileName is required for extract mode');

      const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
      if (!existing) throw new Error(`file-extract: file not found: ${fileName}`);
      const perms = permissionsFor(existing.permissions);
      if (!perms.read) throw new Error(`file-extract: read permission denied on ${fileName}`);

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
          const outBuf = Buffer.from(result.text, 'utf8');
          persisted = await writeWorkflowFile(outputName, outBuf, 'text/plain');
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
          throw new Error(`file-extract: ${err.code}: ${err.message}`);
        }
        throw err;
      }
    }

    // synthesize
    const format = config.format as SynthesizeFormat | undefined;
    const source = config.source as SynthesizeSource | undefined;
    if (!format || !source) throw new Error('file-extract: format and source are required for synthesize mode');

    const contentPath = (config.contentPath as string) || 'input.content';
    const raw = resolvePath({ input } as Record<string, unknown>, contentPath);
    const content = coerceContent(raw, source);
    const title = (config.title as string) || undefined;

    try {
      const result = await synthesize({ format, source, content, title });
      let persisted: { id: string; name: string } | undefined;
      if (toBool(config.persist)) {
        const outputName = interpolateTemplate((config.outputName as string) || '', input).trim();
        if (!outputName) throw new Error('file-extract: outputName is required when persist=true');
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
        throw new Error(`file-extract: ${err.code}: ${err.message}`);
      }
      throw err;
    }
  },

  getInputSchema(_config): JsonSchema {
    return { type: 'object', description: 'Extract: needs no input (file is loaded by name). Synthesise: input.content (or contentPath) supplies the content.' };
  },

  getOutputSchema(config): JsonSchema {
    const mode = config.mode as 'extract' | 'synthesize';
    if (mode === 'synthesize') {
      return {
        type: 'object',
        properties: {
          base64: { type: 'string' } as const,
          mimeType: { type: 'string' } as const,
          sizeBytes: { type: 'number' } as const,
          suggestedExtension: { type: 'string' } as const,
        } as Record<string, JsonSchema>,
      };
    }
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

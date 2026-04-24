import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { and, eq, like } from 'drizzle-orm';
import {
  readBuffer,
  saveBuffer,
  appendBuffer,
  deleteFile,
  newDiskPath,
} from '$lib/file-store/storage';

export { fileStoreDef } from './file-store.def';

type Operation = 'read' | 'write' | 'append' | 'delete' | 'list';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function permissionsFor(raw: unknown): WorkflowFilePermissions {
  const p = (raw ?? {}) as Partial<WorkflowFilePermissions>;
  return {
    read: p.read !== false,
    write: !!p.write,
    append: !!p.append,
    delete: !!p.delete,
  };
}

function coerceToBuffer(value: unknown, encoding: 'utf8' | 'base64'): Buffer {
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    return Buffer.from(value, encoding);
  }
  // Objects / arrays: JSON-stringify
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

export const fileStoreExecutor: NodeExecutor = {
  type: 'file-store',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as Operation) || 'read';
    const encoding = (config.encoding as 'utf8' | 'base64') || 'utf8';

    if (operation === 'list') {
      const prefix = (config.prefix as string | undefined) || '';
      const rows = prefix
        ? await db
            .select()
            .from(workflowFiles)
            .where(like(workflowFiles.name, `${prefix}%`))
        : await db.select().from(workflowFiles);
      const files = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        permissions: permissionsFor(r.permissions),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
      return { output: { files, count: files.length } };
    }

    const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
    if (!fileName) {
      throw new Error('file-store: fileName is required for ' + operation);
    }

    const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
    const perms = existing ? permissionsFor(existing.permissions) : null;

    if (operation === 'read') {
      if (!existing) throw new Error(`file-store: file not found: ${fileName}`);
      if (!perms || !perms.read) {
        throw new Error(`file-store: read permission denied on ${fileName}`);
      }
      const buf = await readBuffer(existing.diskPath);
      const content = encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8');
      return {
        output: {
          name: existing.name,
          mimeType: existing.mimeType,
          sizeBytes: existing.sizeBytes,
          encoding,
          content,
        },
      };
    }

    if (operation === 'delete') {
      if (!existing) {
        return { output: { ok: true, deleted: false, reason: 'not-found' } };
      }
      if (!perms || !perms.delete) {
        throw new Error(`file-store: delete permission denied on ${fileName}`);
      }
      await deleteFile(existing.diskPath);
      await db.delete(workflowFiles).where(eq(workflowFiles.id, existing.id));
      return { output: { ok: true, deleted: true, name: fileName } };
    }

    if (operation === 'write') {
      if (existing && (!perms || !perms.write)) {
        throw new Error(`file-store: write permission denied on ${fileName}`);
      }
      const contentPath = config.contentPath as string | undefined;
      const raw = contentPath
        ? resolvePath(input, contentPath)
        : input.content !== undefined
          ? input.content
          : input;
      const buf = coerceToBuffer(raw, encoding);

      if (existing) {
        await saveBuffer(existing.diskPath, buf);
        await db
          .update(workflowFiles)
          .set({ sizeBytes: buf.byteLength, updatedAt: new Date() })
          .where(eq(workflowFiles.id, existing.id));
        return { output: { ok: true, name: fileName, sizeBytes: buf.byteLength, created: false } };
      }

      const diskPath = newDiskPath(fileName);
      await saveBuffer(diskPath, buf);
      const [inserted] = await db
        .insert(workflowFiles)
        .values({
          name: fileName,
          mimeType: guessMime(fileName),
          sizeBytes: buf.byteLength,
          diskPath,
          permissions: { read: true, write: true, append: true, delete: false },
        })
        .returning();
      return { output: { ok: true, name: fileName, sizeBytes: buf.byteLength, created: true, id: inserted.id } };
    }

    if (operation === 'append') {
      if (!existing) throw new Error(`file-store: file not found: ${fileName} (append requires an existing file; use write to create)`);
      if (!perms || !perms.append) {
        throw new Error(`file-store: append permission denied on ${fileName}`);
      }
      const contentPath = config.contentPath as string | undefined;
      const raw = contentPath
        ? resolvePath(input, contentPath)
        : input.content !== undefined
          ? input.content
          : input;
      const buf = coerceToBuffer(raw, encoding);
      const newSize = await appendBuffer(existing.diskPath, buf);
      await db
        .update(workflowFiles)
        .set({ sizeBytes: newSize, updatedAt: new Date() })
        .where(eq(workflowFiles.id, existing.id));
      return { output: { ok: true, name: fileName, sizeBytes: newSize, appendedBytes: buf.byteLength } };
    }

    throw new Error(`file-store: unknown operation: ${operation}`);
  },

  getInputSchema(_config: Record<string, unknown>): JsonSchema {
    return {
      type: 'object',
      description:
        'For write/append: input.content (or the whole input) is written. For read/delete: only fileName is needed. fileName supports {{input.field}} templates.',
    };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    const op = config.operation as Operation;
    if (op === 'read') {
      return {
        type: 'object',
        properties: {
          name: { type: 'string' } as const,
          mimeType: { type: 'string' } as const,
          sizeBytes: { type: 'number' } as const,
          encoding: { type: 'string' } as const,
          content: { type: 'string' } as const,
        } as Record<string, JsonSchema>,
      };
    }
    if (op === 'list') {
      return {
        type: 'object',
        properties: {
          files: { type: 'array' } as const,
          count: { type: 'number' } as const,
        } as Record<string, JsonSchema>,
      };
    }
    return {
      type: 'object',
      properties: {
        ok: { type: 'boolean' } as const,
        name: { type: 'string' } as const,
        sizeBytes: { type: 'number' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

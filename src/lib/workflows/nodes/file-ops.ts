// Per-operation file-store nodes — replace the multi-mode `file-store`
// node with one node per operation so the orchestrator picks one node and
// fills in only the fields that operation actually needs.
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq, like } from 'drizzle-orm';
import { readBuffer, saveBuffer, appendBuffer, deleteFile, newDiskPath } from '$lib/file-store/storage';
import { queueDerivedIntelDelete } from '$lib/jkai/intel/auto-extract';

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
  if (typeof value === 'string') return Buffer.from(value, encoding);
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

// ───────────────────── file-read ─────────────────────

export const fileReadExecutor: NodeExecutor = {
  type: 'file-read',
  async execute(input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
    if (!fileName) throw new Error('file-read: fileName is required');
    const encoding = (config.encoding as 'utf8' | 'base64') || 'utf8';
    const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
    if (!existing) throw new Error(`file-read: file not found: ${fileName}`);
    const perms = permissionsFor(existing.permissions);
    if (!perms.read) throw new Error(`file-read: read permission denied on ${fileName}`);
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
      rowCount: 1,
    };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Only fileName is needed; supports {{input.field}} templates.' }; },
  getOutputSchema(): JsonSchema {
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
  },
};

export const fileReadDef: NodeDefinition = {
  type: 'file-read',
  label: 'Read file',
  category: 'integration',
  description: 'Load a file from the workflow file store. Returns content as utf8 (default) or base64.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file in the store. Supports {{input.field}}.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 for text, base64 for binary.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { encoding: 'utf8' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'File content' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', placeholder: 'reports/daily.csv', description: 'Supports {{input.field}}.' },
    {
      key: 'encoding', label: 'Encoding', type: 'dropdown', description: 'utf8 for text, base64 for binary.',
      options: [
        { value: 'utf8', label: 'utf8 (text)' },
        { value: 'base64', label: 'base64 (binary)' },
      ],
    },
  ],
  llmDescription: 'Read content of an existing file in the workflow store. Output: { name, mimeType, sizeBytes, encoding, content }.',
  llmExamples: [
    { fileName: 'config.json' },
    { fileName: '{{input.attachment.name}}', encoding: 'base64' },
  ],
};

// ───────────────────── file-write ─────────────────────

export const fileWriteExecutor: NodeExecutor = {
  type: 'file-write',
  async execute(input, config, ctx: ExecutionContext): Promise<NodeResult> {
    const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
    if (!fileName) throw new Error('file-write: fileName is required');
    const encoding = (config.encoding as 'utf8' | 'base64') || 'utf8';
    const append = !!config.append;
    if (ctx.dryRun) {
      return { output: { ok: true, dryRun: true, name: fileName, mode: append ? 'append' : 'write' }, rowCount: 1 };
    }
    const contentPath = config.contentPath as string | undefined;
    const raw = contentPath
      ? resolvePath(input, contentPath)
      : input.content !== undefined ? input.content : input;
    const buf = coerceToBuffer(raw, encoding);

    const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
    const perms = existing ? permissionsFor(existing.permissions) : null;

    if (append) {
      if (!existing) throw new Error(`file-write (append): file not found: ${fileName}. Use append=false to create.`);
      if (!perms || !perms.append) throw new Error(`file-write: append permission denied on ${fileName}`);
      const newSize = await appendBuffer(existing.diskPath, buf);
      await db.update(workflowFiles)
        .set({ sizeBytes: newSize, updatedAt: new Date() })
        .where(eq(workflowFiles.id, existing.id));
      return { output: { ok: true, name: fileName, sizeBytes: newSize, appendedBytes: buf.byteLength, mode: 'append' }, rowCount: 1 };
    }

    if (existing) {
      if (!perms || !perms.write) throw new Error(`file-write: write permission denied on ${fileName}`);
      await saveBuffer(existing.diskPath, buf);
      await db.update(workflowFiles)
        .set({ sizeBytes: buf.byteLength, updatedAt: new Date() })
        .where(eq(workflowFiles.id, existing.id));
      return { output: { ok: true, name: fileName, sizeBytes: buf.byteLength, created: false }, rowCount: 1 };
    }

    const diskPath = newDiskPath(fileName);
    await saveBuffer(diskPath, buf);
    const [inserted] = await db.insert(workflowFiles).values({
      name: fileName,
      mimeType: guessMime(fileName),
      sizeBytes: buf.byteLength,
      diskPath,
      permissions: { read: true, write: true, append: true, delete: false },
    }).returning();
    return { output: { ok: true, name: fileName, sizeBytes: buf.byteLength, created: true, id: inserted.id }, rowCount: 1 };
  },
  getInputSchema(): JsonSchema {
    return { type: 'object', description: 'Content comes from `contentPath` if set, else `input.content`, else the whole input.' };
  },
  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        ok: { type: 'boolean' } as const,
        name: { type: 'string' } as const,
        sizeBytes: { type: 'number' } as const,
        created: { type: 'boolean' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

export const fileWriteDef: NodeDefinition = {
  type: 'file-write',
  label: 'Write file',
  category: 'integration',
  description: 'Create or overwrite a file in the workflow store. Set `append: true` to append to an existing file instead.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file. Supports {{input.field}}.' },
      append: { type: 'boolean', description: 'When true, append to an existing file instead of overwriting. File must already exist.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 for text, base64 for binary.' },
      contentPath: { type: 'string', description: 'Dot-path into input. Defaults to `input.content`, then the whole input.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { append: false, encoding: 'utf8' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', placeholder: 'logs/{{input.id}}.txt', description: 'Supports {{input.field}}.' },
    { key: 'append', label: 'Append mode', type: 'toggle', description: 'When on, append to an existing file (does not create).' },
    {
      key: 'encoding', label: 'Encoding', type: 'dropdown', description: 'utf8 for text, base64 for binary.',
      options: [
        { value: 'utf8', label: 'utf8 (text)' },
        { value: 'base64', label: 'base64 (binary)' },
      ],
    },
    { key: 'contentPath', label: 'Content path', type: 'text', placeholder: 'data.body', description: 'Dot-path into input.' },
  ],
  llmDescription: 'Persist content to the workflow file store. Default behaviour overwrites or creates. Set `append: true` to append (file must already exist). To delete, use `file-delete`.',
  llmExamples: [
    { fileName: 'out.txt', contentPath: 'result.text' },
    { fileName: 'logs/{{input.id}}.json', contentPath: 'payload' },
    { fileName: 'log.txt', append: true, contentPath: 'line' },
  ],
};

// ───────────────────── file-delete ─────────────────────

export const fileDeleteExecutor: NodeExecutor = {
  type: 'file-delete',
  async execute(input, config, ctx: ExecutionContext): Promise<NodeResult> {
    const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
    if (!fileName) throw new Error('file-delete: fileName is required');
    if (ctx.dryRun) {
      return { output: { ok: true, dryRun: true, deleted: false, name: fileName }, rowCount: 1 };
    }
    const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
    if (!existing) return { output: { ok: true, deleted: false, reason: 'not-found', name: fileName }, rowCount: 1 };
    const perms = permissionsFor(existing.permissions);
    if (!perms.delete) throw new Error(`file-delete: delete permission denied on ${fileName}`);
    await deleteFile(existing.diskPath);
    await db.delete(workflowFiles).where(eq(workflowFiles.id, existing.id));
    // Derived intel has no FK to the file — remove what this document put in
    // the graph, or the entities outlive their only source.
    queueDerivedIntelDelete('file', existing.id);
    return { output: { ok: true, deleted: true, name: fileName }, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'Only fileName is needed.' }; },
  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        ok: { type: 'boolean' } as const,
        deleted: { type: 'boolean' } as const,
        name: { type: 'string' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

export const fileDeleteDef: NodeDefinition = {
  type: 'file-delete',
  label: 'Delete file',
  category: 'integration',
  description: 'Remove a file from the workflow file store. Idempotent — silently succeeds if the file is already gone.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file. Supports {{input.field}}.' },
    },
    required: ['fileName'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Delete a workflow file by name. Output: { ok, deleted, name }.',
  llmExamples: [{ fileName: 'tmp/{{input.id}}.csv' }],
};

// ───────────────────── file-list ─────────────────────

export const fileListExecutor: NodeExecutor = {
  type: 'file-list',
  async execute(_input, config, _ctx: ExecutionContext): Promise<NodeResult> {
    const prefix = (config.prefix as string | undefined) || '';
    const rows = prefix
      ? await db.select().from(workflowFiles).where(like(workflowFiles.name, `${prefix}%`))
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
    return { output: { files, count: files.length }, rowCount: files.length };
  },
  getInputSchema(): JsonSchema { return { type: 'object', description: 'No input needed.' }; },
  getOutputSchema(): JsonSchema {
    return {
      type: 'object',
      properties: {
        files: { type: 'array' } as const,
        count: { type: 'number' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

export const fileListDef: NodeDefinition = {
  type: 'file-list',
  label: 'List files',
  category: 'integration',
  description: 'List every file in the workflow store, optionally filtered by name prefix.',
  configSchema: {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: 'Only return files whose name starts with this prefix. Empty = list all.' },
    },
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Listing' }],
  basicConfig: [
    { key: 'prefix', label: 'Name prefix', type: 'text', placeholder: 'logs/', description: 'Optional. Empty lists all files.' },
  ],
  llmDescription: 'Get a directory-style listing of files in the store. Output: { files: [...], count }.',
  llmExamples: [{}, { prefix: 'logs/' }],
};

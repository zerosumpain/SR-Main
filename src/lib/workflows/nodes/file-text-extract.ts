// file-text-extract — pull plain text + structured metadata from a file in
// the workflow file store. Replaces file-extract's "extract" mode so the
// orchestrator picks one node with a simple config instead of fighting a
// discriminated union.
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, ExtractError } from '$lib/jkai/extract';

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

export const fileTextExtractDef: NodeDefinition = {
  type: 'file-text-extract',
  label: 'Extract text from file',
  category: 'integration',
  description: 'Pull plain text + structured metadata out of a PDF / DOCX / Markdown / audio / video file in the workflow file store.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the source file in the store. Supports {{input.field}} templates.' },
      pageFrom: { type: 'number', description: 'PDF only: 1-indexed first page (omit for all pages).' },
      pageTo: { type: 'number', description: 'PDF only: 1-indexed last page (inclusive).' },
      language: { type: 'string', description: 'Audio/video: BCP-47 language hint for Whisper, e.g. "en". Omit for auto-detect.' },
      persist: { type: 'boolean', description: 'Save the extracted text as a new .txt file in the store.' },
      outputName: { type: 'string', description: 'Required when persist=true. Name for the saved .txt file.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Extracted' }],
  basicConfig: [
    { key: 'fileName', label: 'Source file', type: 'template-textarea', placeholder: 'docs/contract.pdf', description: 'Name of the file in the store.' },
    { key: 'pageFrom', label: 'First page (PDF)', type: 'text', placeholder: '1', description: 'Optional. 1-indexed.' },
    { key: 'pageTo', label: 'Last page (PDF)', type: 'text', placeholder: '5', description: 'Optional. Inclusive.' },
    { key: 'language', label: 'Language (audio/video)', type: 'text', placeholder: 'en', description: 'BCP-47 hint.' },
    { key: 'persist', label: 'Save as new .txt', type: 'toggle', description: 'Persist the extracted text to the file store.' },
    { key: 'outputName', label: 'Saved file name', type: 'template-textarea', placeholder: 'reports/{{input.id}}.txt', description: 'Required when "Save as new .txt" is on.', visibleWhen: { key: 'persist', equals: true } },
  ],
  llmDescription: 'Use this when you need the text contents of a file already in the workflow file store. Output is { text, meta, sourceFile }, plus { file } when persist=true. To create a new file from text/markdown/json/csv use `file-build` instead.',
  llmExamples: [
    { fileName: 'contract.pdf' },
    { fileName: 'meeting.mp4', language: 'en' },
    { fileName: '{{input.upload.name}}', persist: true, outputName: 'extracted/{{input.upload.name}}.txt' },
  ],
};

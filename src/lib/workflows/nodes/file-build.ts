// file-build — synthesise a new file (docx/pdf/html/xlsx/csv) from input
// content. Replaces file-extract's "synthesize" mode so the orchestrator
// picks one node with a simple config instead of fighting a discriminated
// union.
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';

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

export const fileBuildDef: NodeDefinition = {
  type: 'file-build',
  label: 'Build new file',
  category: 'integration',
  description: 'Synthesise a new file (docx / pdf / html / xlsx / csv) from text / markdown / json / csv / xlsx input.',
  configSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['docx', 'pdf', 'html', 'xlsx', 'csv'], description: 'Output format.' },
      source: { type: 'string', enum: ['markdown', 'text', 'json', 'csv', 'xlsx'], description: 'Format of the supplied content.' },
      contentPath: { type: 'string', description: 'Dot-path into input pointing at the content. Defaults to `input.content`.' },
      title: { type: 'string', description: 'Optional title for docx/pdf output.' },
      persist: { type: 'boolean', description: 'Save the output to the file store.' },
      outputName: { type: 'string', description: 'Required when persist=true.' },
    },
    required: ['format', 'source'],
  },
  defaultConfig: { persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'File' }],
  basicConfig: [
    {
      key: 'format', label: 'Output format', type: 'dropdown', description: 'What kind of file to produce.',
      options: [
        { value: 'docx', label: 'DOCX (Word)' },
        { value: 'pdf', label: 'PDF' },
        { value: 'html', label: 'HTML' },
        { value: 'xlsx', label: 'XLSX (Excel)' },
        { value: 'csv', label: 'CSV' },
      ],
    },
    {
      key: 'source', label: 'Input format', type: 'dropdown', description: 'Format of the content you are providing.',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'text', label: 'Plain text' },
        { value: 'json', label: 'JSON (array of rows)' },
        { value: 'csv', label: 'CSV' },
        { value: 'xlsx', label: 'XLSX (binary, base64)' },
      ],
    },
    { key: 'contentPath', label: 'Content path', type: 'text', placeholder: 'data.body', description: 'Dot-path into input. Default `input.content`.' },
    { key: 'title', label: 'Title', type: 'text', description: 'Optional title for docx/pdf.' },
    { key: 'persist', label: 'Save to file store', type: 'toggle', description: 'When on, the output becomes a new workflow file.' },
    { key: 'outputName', label: 'Saved file name', type: 'template-textarea', placeholder: 'reports/{{input.id}}.docx', description: 'Required when "Save to file store" is on.', visibleWhen: { key: 'persist', equals: true } },
  ],
  llmDescription: 'Use this to render text/markdown/json/csv into a downloadable file. Output is always { base64, mimeType, sizeBytes, suggestedExtension }, plus { file } when persist=true. To pull text out of an existing file use `file-text-extract` instead.',
  llmExamples: [
    { format: 'docx', source: 'markdown', contentPath: 'input.report', persist: true, outputName: 'reports/{{input.id}}.docx' },
    { format: 'xlsx', source: 'json', contentPath: 'input.rows' },
    { format: 'pdf', source: 'markdown', contentPath: 'input.body', title: 'Weekly summary' },
  ],
};

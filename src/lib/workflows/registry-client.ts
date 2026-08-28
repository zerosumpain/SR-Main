/**
 * Client-safe registry module with definitions only (no executors).
 * Does NOT import engine, events, or sandbox (Node.js-only modules).
 * Use this from page components. Use '$lib/workflows' from +server.ts routes.
 */
import { manualTriggerDef } from './nodes/manual-trigger';
import { transformDef } from './nodes/transform';
import { delayDef } from './nodes/delay';
import { httpRequestDef } from './nodes/http-request';
import { conditionalDef } from './nodes/conditional';
import { switchDef } from './nodes/switch.def';
import { approvalDef } from './nodes/approval.def';
import { textParserDef } from './nodes/text-parser';
import { validatorDef } from './nodes/validator';
import { mergeDef } from './nodes/merge';
import { accumulatorDef } from './nodes/accumulator';
import { subWorkflowDef } from './nodes/sub-workflow.def';
import { codeExecuteDef } from './nodes/code-execute.def';
import { llmCallDef } from './nodes/llm-call.def';
import { dataStoreDef } from './nodes/data-store.def';
import { databaseDef } from './nodes/database.def';
import { dedupeDef } from './nodes/dedupe.def';
import { emailDef } from './nodes/email.def';
import { loopDef } from './nodes/loop.def';
import { stravaDef } from './nodes/strava.def';
import { whoopDef } from './nodes/whoop.def';
import { errorHandlerDef } from './nodes/error-handler.def';
import { openrouterDef } from './nodes/openrouter.def';
import { thinkDef } from './nodes/think.def';
import { llmRouterDef } from './nodes/llm-router.def';
import { llmAgentDef } from './nodes/llm-agent.def';
import { whatsappDef } from './nodes/whatsapp.def';
import { homeAssistantDef } from './nodes/home-assistant.def';
import { healthQueryDef } from './nodes/health-query.def';
import { briefingComposeDef } from './nodes/briefing-compose.def';
import { locationContextDef } from './nodes/location-context.def';
import { weatherBriefDef } from './nodes/weather-brief.def';
import { blogDef } from './nodes/blog.def';
import { jkaiDef } from './nodes/jkai.def';
import { siteToolDef } from './nodes/site-tool.def';
import { fileSearchDef } from './nodes/file-search.def';
import { researchSearchDef } from './nodes/research-search.def';
import { deckBuildDef } from './nodes/deck-build.def';
import { apiCallDef } from './nodes/api-call.def';
import { apiIntegrationDef } from './nodes/api-integration.def';
import { delegateAgentDef } from './nodes/delegate-agent.def';
import { deepDiveDef } from './nodes/deep-dive.def';
import { webScrapeDef } from './nodes/web-scrape.def';
import { stealthScrapeDef } from './nodes/stealth-scrape.def';
import { stealthScrapeLlmDef } from './nodes/stealth-scrape-llm.def';
import { gmailTriggerDef } from './nodes/gmail-trigger.def';
import { whatsappTriggerDef } from './nodes/whatsapp-trigger.def';
import { gmailFetchDef } from './nodes/gmail-fetch.def';
import { gmailSendDef } from './nodes/gmail-send.def';
import { gmailReplyDef } from './nodes/gmail-reply.def';
import { gmailLabelDef } from './nodes/gmail-label.def';
import { gmailSearchDef } from './nodes/gmail-search.def';
import { tavilySearchDef } from './nodes/tavily-search.def';
import { intelWriteDef } from './nodes/intel-write.def';
import { interactiveStepDef } from './nodes/interactive-step.def';
// Client-safe `.def.ts` files (type-only imports) for nodes whose main `.ts`
// executor file pulls in server-only modules — same pattern as the imports
// above.
import { siteMapperDef } from './nodes/site-mapper.def';
import { fileStoreDef } from './nodes/file-store.def';
import { fileExtractDef } from './nodes/file-extract.def';
import { appleCalendarDef } from './nodes/apple-calendar.def';
import { infrastructureStatusDef } from './nodes/infrastructure-status.def';
import { infrastructureUpdateDef } from './nodes/infrastructure-update.def';
// Client-safe node files (type-only / template-only imports, no $lib server
// deps) imported directly for their definition.
import { triggerDef } from './nodes/trigger';
import { inspectorDef } from './nodes/inspector';
import { postitDef } from './nodes/postit';
import { annotationDef } from './nodes/annotation';
import type { NodeDefinition } from './types';
// Dynamic node definitions are loaded server-side only (in index.ts).
// This file must stay client-safe — no Node.js imports (fs, path, etc).
//
// ──────────────────────────────────────────────────────────────────────────
// Inlined client-safe definitions
//
// The nodes below ARE registered (executor + def) in `index.ts`, but their
// source `.ts` files import server-only modules ($lib/db, $lib/jkai/*,
// $lib/workflows/site-tools/*, etc.) and have no separate client-safe
// `.def.ts`. Importing the def from those files would pull Node.js / server
// code into the client bundle and break this module's client-safety
// guarantee. We therefore mirror the definition objects here verbatim
// (copied from the corresponding node file).
//
// Drift between these copies and the registered executors is guarded by
// tests/lib/workflows/registry-parity.test.ts — if a type is added, removed,
// or renamed on either side, that test fails.
// ──────────────────────────────────────────────────────────────────────────

const intelligenceDef: NodeDefinition = {
  type: 'intelligence',
  label: 'Intelligence',
  category: 'core',
  description:
    'Filtered view onto the knowledge graph. Queryable; emits both prose context and a structured IntelItem[].',
  configSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query template. Supports {{input.field}}.' },
      facets: { type: 'object' },
    },
  },
  defaultConfig: {
    query: '',
    facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' },
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Intelligence view' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Query',
      type: 'template-textarea',
      description: 'What to look up. {{input.field}} placeholders supported.',
      placeholder: 'new projects',
      section: 'QUERY',
    },
  ],
};

const quickAnswerDef: NodeDefinition = {
  type: 'quick-answer',
  label: 'Quick Answer',
  category: 'core',
  description:
    'Run a quick-answer session (Tavily + synthesis). Polls until complete; returns the answer and sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'array', items: { type: 'string' } },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: { topic: '{{item.title}}', goals: [], maxWaitMs: 180000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Answer' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific questions or angles. One per line.',
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '180000',
      section: 'ADVANCED',
    },
  ],
};

const deepResearchDef: NodeDefinition = {
  type: 'deep-research',
  label: 'Deep Research',
  category: 'core',
  description:
    'DAG-driven deep research (commission via pipeline). Emits researchReport + sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'string' },
      depth: { type: 'string', enum: ['shallow', 'medium', 'deep'] },
      pollIntervalMs: { type: 'number' },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: {
    topic: '{{item.title}}',
    goals: '',
    depth: 'medium',
    pollIntervalMs: 5000,
    maxWaitMs: 900000,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      placeholder: 'What is the impact of …',
      description: 'Topic to research deeply. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
    {
      key: 'goals',
      label: 'Goals',
      type: 'template-textarea',
      placeholder: 'Understand key players, risks, opportunities',
      description: 'Optional: specific angles or questions. One per line.',
      section: 'QUERY',
    },
    {
      key: 'depth',
      label: 'Depth',
      type: 'dropdown',
      options: [
        { value: 'shallow', label: 'Shallow (quick skim)' },
        { value: 'medium', label: 'Medium (balanced)' },
        { value: 'deep', label: 'Deep (thorough)' },
      ],
      section: 'QUERY',
    },
    {
      key: 'maxWaitMs',
      label: 'Max wait (ms)',
      type: 'number',
      description: 'Polling deadline before giving up.',
      placeholder: '900000',
      section: 'ADVANCED',
    },
  ],
  llmDescription:
    "Commission a long-running deep-research session and block until it finishes (or maxWaitMs elapses). Outputs { researchEngine: 'deep', researchSessionId, researchStatus, researchReport, sources }. Use for thorough investigations where you want a multi-paragraph synthesis with citations — costs minutes of wall-clock time and several LLM calls. For a fast 1-2 paragraph answer use `quick-answer` instead. Pair with a `research-result` display node downstream if you want the canvas to render the report nicely. Templates allowed in topic/goals (e.g. {{input.title}}).",
  llmExamples: [
    { topic: '{{input.title}}', depth: 'medium' },
    { topic: 'Latest advances in solid-state batteries 2026', goals: 'Players, technical readiness, commercialisation timelines', depth: 'deep' },
  ],
};

const intelQueryDef: NodeDefinition = {
  type: 'intel-query',
  label: 'Intel Query',
  category: 'core',
  description:
    'Search the intel knowledge graph; appends matching context as intelContext to downstream input.',
  configSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Query template. Supports {{input.field}} placeholders.',
      },
    },
  },
  defaultConfig: { query: '{{input.message}}' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Output w/ intel context' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Query',
      type: 'template-textarea',
      description: 'What to look up. {{input.field}} placeholders supported.',
      placeholder: '{{input.message}}',
      section: 'QUERY',
    },
  ],
};

const chatDef: NodeDefinition = {
  type: 'chat',
  label: 'Chat',
  category: 'trigger',
  description:
    'Conversational chat node. Unwired → acts as the canvas orchestrator panel (no role in execution). Wiring it is not supported — use `llm-call` for a prompt→completion step.',
  configSchema: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description:
          'Optional: pin an existing /jkai conversation to this chat node so the canvas thread "follows" the user from chat onto the canvas. Set by `pinConversationToCanvasChat` and `workflow_build_from_spec`.',
      },
    },
  },
  defaultConfig: {},
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [],
};

const builderChatDef: NodeDefinition = {
  type: 'builder-chat',
  label: 'Builder Chat',
  category: 'integration',
  description:
    'Set the build outcome and config. Programmatic: starts a JKAI build with the configured prompt and emits the buildId.',
  configSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Build outcome prompt. Supports templates.' },
      thinkingLevel: { type: 'string' },
      enforceDesignSystem: { type: 'boolean' },
      planFirst: { type: 'boolean' },
      modelProvider: { type: 'string' },
      modelId: { type: 'string' },
      minIterations: { type: 'number' },
      maxIterations: { type: 'number' },
      maxTotalMinutes: { type: 'number' },
      maxTokensPerHour: { type: 'number' },
      activeMinutesPerHour: { type: 'number' },
    },
    required: ['prompt'],
  },
  defaultConfig: { prompt: '', thinkingLevel: 'medium', enforceDesignSystem: true, planFirst: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input (for templating)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Started build' }],
  llmDescription:
    'Start a JKAI autonomous build with a prompt and full config. Returns buildId for downstream Builder Pi / Build View nodes.',
};

const builderPiDef: NodeDefinition = {
  type: 'builder-pi',
  label: 'Builder Pi',
  category: 'integration',
  description:
    'Block until a JKAI build reaches a terminal state (completed / failed / paused), then emit its final snapshot.',
  configSchema: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Target build id (templates supported).' },
    },
    required: [],
  },
  defaultConfig: { buildId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input (expects { buildId } if not configured)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Final build' }],
  llmDescription: 'Wait for a JKAI build to finish and return its final state.',
};

const buildViewDef: NodeDefinition = {
  type: 'build-view',
  label: 'Build View',
  category: 'integration',
  description: 'Snapshot of an in-progress or finished JKAI build (status, preview URL, published slug).',
  configSchema: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Target build id (templates supported).' },
    },
    required: [],
  },
  defaultConfig: { buildId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input (expects { buildId } if not configured)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Build snapshot' }],
  llmDescription: 'Read the current state of a JKAI build without waiting.',
};

const fileReadDef: NodeDefinition = {
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

const fileWriteDef: NodeDefinition = {
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

const fileDeleteDef: NodeDefinition = {
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

const fileListDef: NodeDefinition = {
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

const fileTextExtractDef: NodeDefinition = {
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

const fileBuildDef: NodeDefinition = {
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

const blogListDef: NodeDefinition = {
  type: 'blog-list',
  label: 'Blog: list posts',
  category: 'integration',
  description: 'List the most recent blog posts (up to 50).',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Posts' }],
  basicConfig: [],
  llmDescription: 'List blog posts. No config. Output: { success, data: { posts: [...] } }.',
  llmExamples: [{}],
};

const blogGetDef: NodeDefinition = {
  type: 'blog-get',
  label: 'Blog: get post',
  category: 'integration',
  description: 'Fetch a single blog post by ID.',
  configSchema: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: 'Post ID. Supports {{input.field}}.' },
    },
    required: ['postId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Post' }],
  basicConfig: [
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Get one post by ID. Output: { success, data: { post } }.',
  llmExamples: [{ postId: '{{input.id}}' }],
};

const blogCreateDef: NodeDefinition = {
  type: 'blog-create',
  label: 'Blog: create post',
  category: 'integration',
  description: 'Create a new blog post. Supports template interpolation in title and content.',
  configSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Post title. Supports {{input.field}}.' },
      content: { type: 'string', description: 'Post body as HTML. Supports {{input.field}}.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Defaults to draft.' },
      tags: { type: 'string', description: 'Comma-separated tags.' },
    },
    required: ['title'],
  },
  defaultConfig: { status: 'draft' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'title', label: 'Title', type: 'template-textarea', placeholder: 'Weekly Update', description: 'Supports {{input.field}}.' },
    { key: 'content', label: 'Content (HTML)', type: 'template-textarea', placeholder: '<p>This week…</p>', description: 'Supports {{input.field}}.' },
    {
      key: 'status', label: 'Status', type: 'dropdown', description: 'Defaults to draft.',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }],
    },
    { key: 'tags', label: 'Tags', type: 'text', placeholder: 'tech, ai, personal', description: 'Comma-separated.' },
  ],
  llmDescription: 'Create a blog post. Title required; everything else optional. Output: { success, data: { post } }.',
  llmExamples: [
    { title: 'Weekly Update', content: '<p>This week…</p>', status: 'draft', tags: 'weekly, update' },
    { title: '{{input.headline}}', content: '{{input.body}}' },
  ],
};

const blogUpdateDef: NodeDefinition = {
  type: 'blog-update',
  label: 'Blog: update post',
  category: 'integration',
  description: 'Update an existing blog post. Pass only the fields you want to change.',
  configSchema: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: 'Post ID. Supports {{input.field}}.' },
      title: { type: 'string', description: 'New title. Omit to leave unchanged.' },
      content: { type: 'string', description: 'New content (HTML). Omit to leave unchanged.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Omit to leave unchanged.' },
      tags: { type: 'string', description: 'New tags. Omit to leave unchanged.' },
    },
    required: ['postId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.id}}', description: 'Supports {{input.field}}.' },
    { key: 'title', label: 'Title', type: 'template-textarea', description: 'Optional. Supports {{input.field}}.' },
    { key: 'content', label: 'Content (HTML)', type: 'template-textarea', description: 'Optional. Supports {{input.field}}.' },
    {
      key: 'status', label: 'Status', type: 'dropdown', description: 'Optional.',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }],
    },
    { key: 'tags', label: 'Tags', type: 'text', description: 'Optional. Comma-separated.' },
  ],
  llmDescription: 'Update an existing post. Only postId is required; pass only the fields you want to change. To publish a draft: { postId, status: "published" }.',
  llmExamples: [
    { postId: '{{input.id}}', status: 'published' },
    { postId: '{{input.post.id}}', title: '{{input.headline}}', content: '{{input.body}}' },
  ],
};

const deepDiveStartDef: NodeDefinition = {
  type: 'deep-dive-start',
  label: 'Deep dive: start',
  category: 'integration',
  description: 'Kick off a new deep research session. Returns a session id you can poll with `deep-dive-status` or fetch the report with `deep-dive-report`.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to research. Supports {{input.field}}.' },
      goals: { type: 'string', description: 'Optional objectives / questions to address.' },
      depth: { type: 'string', enum: ['shallow', 'medium', 'deep'], description: 'How thorough.' },
    },
    required: ['topic'],
  },
  defaultConfig: { depth: 'medium' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Session' }],
  basicConfig: [
    { key: 'topic', label: 'Topic', type: 'template-textarea', placeholder: 'Impact of AI on software engineering', description: 'Supports {{input.field}}.' },
    { key: 'goals', label: 'Goals', type: 'template-textarea', placeholder: 'Understand trends, key players, future outlook', description: 'Optional.' },
    {
      key: 'depth', label: 'Depth', type: 'dropdown', description: 'How thorough.',
      options: [
        { value: 'shallow', label: 'Shallow (quick skim)' },
        { value: 'medium', label: 'Medium (balanced)' },
        { value: 'deep', label: 'Deep (thorough)' },
      ],
    },
  ],
  llmDescription: 'Start a research session. Output: { success, data: { id, ... } } — pass `data.id` to deep-dive-status / deep-dive-report. Research runs asynchronously; status polling continues until done.',
  llmExamples: [
    { topic: 'Quantum computing breakthroughs 2026', goals: 'Key advances, practical applications', depth: 'deep' },
    { topic: '{{input.subject}}' },
  ],
};

const deepDiveStatusDef: NodeDefinition = {
  type: 'deep-dive-status',
  label: 'Deep dive: check status',
  category: 'integration',
  description: 'Check progress of a running research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}, e.g. {{input.data.id}}.' },
    },
    required: ['sessionId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Status' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Get the status of a research session. Output: { success, data: { status, progress, ... } }.',
  llmExamples: [{ sessionId: '{{input.data.id}}' }],
};

const deepDiveReportDef: NodeDefinition = {
  type: 'deep-dive-report',
  label: 'Deep dive: get report',
  category: 'integration',
  description: 'Fetch the final report for a completed research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}.' },
    },
    required: ['sessionId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Report' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Pull the rendered research report. Output: { success, data: { report, citations, ... } }.',
  llmExamples: [{ sessionId: '{{input.data.id}}' }],
};

const deepDiveListDef: NodeDefinition = {
  type: 'deep-dive-list',
  label: 'Deep dive: list sessions',
  category: 'integration',
  description: 'List recent research sessions (most recent first).',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Sessions' }],
  basicConfig: [],
  llmDescription: 'List research sessions. No config. Output: { success, data: { sessions: [...] } }.',
  llmExamples: [{}],
};

const deepDiveControlDef: NodeDefinition = {
  type: 'deep-dive-control',
  label: 'Deep dive: control session',
  category: 'integration',
  description: 'Pause, resume, or cancel a running research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}.' },
      action: { type: 'string', enum: ['pause', 'resume', 'cancel'], description: 'What to do.' },
    },
    required: ['sessionId', 'action'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
    {
      key: 'action', label: 'Action', type: 'dropdown', description: 'What to do.',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
    },
  ],
  llmDescription: 'Pause / resume / cancel a research session.',
  llmExamples: [
    { sessionId: '{{input.data.id}}', action: 'cancel' },
  ],
};

const researchResultDef: NodeDefinition = {
  type: 'research-result',
  label: 'Research Result',
  category: 'core',
  description:
    'Display node for a commissioned deep/quick research session. Pulses while pending; populates when complete.',
  configSchema: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['deep', 'quick'] },
      sessionId: { type: 'string' },
      topic: { type: 'string' },
    },
  },
  defaultConfig: { engine: 'deep', sessionId: '', topic: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [
    {
      key: 'engine',
      label: 'Engine',
      type: 'dropdown',
      options: [
        { value: 'deep', label: 'Deep research' },
        { value: 'quick', label: 'Quick research' },
      ],
      section: 'SOURCE',
    },
    {
      key: 'sessionId',
      label: 'Session ID',
      type: 'template-textarea',
      description: 'Existing session ID. Supports {{input.*}} placeholders from an upstream connection.',
      placeholder: '{{input.researchSessionId}}',
      section: 'SOURCE',
    },
  ],
  llmDescription:
    "Display-only node that renders a previously-commissioned research session (deep or quick) on the canvas. Does NOT start a new session — it just polls the given sessionId and surfaces the report. Use when an upstream node (deep-research / quick-answer) emits researchSessionId and you want the result visible on the canvas as a separate stage. If you only need the report's text downstream and don't care about the canvas display, skip this node and read directly from deep-research's output.",
  llmExamples: [
    { engine: 'deep', sessionId: '{{input.researchSessionId}}' },
    { engine: 'quick', sessionId: '{{trigger.output.sessionId}}' },
  ],
};

const builtInDefinitions: NodeDefinition[] = [
  manualTriggerDef,
  transformDef,
  codeExecuteDef,
  delayDef,
  httpRequestDef,
  llmCallDef,
  emailDef,
  dataStoreDef,
  databaseDef,
  dedupeDef,
  loopDef,
  conditionalDef,
  switchDef,
  approvalDef,
  whoopDef,
  stravaDef,
  openrouterDef,
  errorHandlerDef,
  textParserDef,
  validatorDef,
  thinkDef,
  llmRouterDef,
  mergeDef,
  accumulatorDef,
  subWorkflowDef,
  llmAgentDef,
  whatsappDef,
  homeAssistantDef,
  healthQueryDef,
  briefingComposeDef,
  locationContextDef,
  weatherBriefDef,
  blogDef,
  jkaiDef,
  siteToolDef,
  fileSearchDef,
  researchSearchDef,
  deckBuildDef,
  apiCallDef,
  apiIntegrationDef,
  delegateAgentDef,
  deepDiveDef,
  webScrapeDef,
  stealthScrapeDef,
  stealthScrapeLlmDef,
  gmailTriggerDef,
  whatsappTriggerDef,
  gmailFetchDef,
  gmailSendDef,
  gmailReplyDef,
  gmailLabelDef,
  gmailSearchDef,
  tavilySearchDef,
  intelWriteDef,
  interactiveStepDef,
  // Reconciled with registered executors (see registry-parity.test.ts).
  builderChatDef,
  builderPiDef,
  buildViewDef,
  intelligenceDef,
  researchResultDef,
  quickAnswerDef,
  deepResearchDef,
  siteMapperDef,
  intelQueryDef,
  chatDef,
  triggerDef,
  inspectorDef,
  fileStoreDef,
  fileExtractDef,
  fileReadDef,
  fileWriteDef,
  fileDeleteDef,
  fileListDef,
  fileTextExtractDef,
  fileBuildDef,
  blogListDef,
  blogGetDef,
  blogCreateDef,
  blogUpdateDef,
  deepDiveStartDef,
  deepDiveStatusDef,
  deepDiveReportDef,
  deepDiveListDef,
  deepDiveControlDef,
  postitDef,
  annotationDef,
  appleCalendarDef,
  infrastructureStatusDef,
  infrastructureUpdateDef,
];

export const nodeDefinitions: NodeDefinition[] = builtInDefinitions;

export function getDefinition(type: string): NodeDefinition | undefined {
  return nodeDefinitions.find((d) => d.type === type);
}

export type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  NodeDefinition,
  Position,
  PortDefinition,
  JsonSchema,
} from './types';

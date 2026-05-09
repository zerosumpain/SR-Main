// src/lib/curate/materialize.ts
//
// Convert an approved CurateProposal into a full NodeSpec. The proposal
// alone is too high-level for codegen — it lacks the executor body and
// detailed schemas. We derive most of NodeSpec mechanically from the
// proposal (which has type/label/category/description/configFields/etc.)
// and use a single focused LLM call for the executor body, the only
// piece the LLM is uniquely required for.
//
// This avoids the "empty LLM content" failure mode that we hit when
// asking the model to emit an entire NodeSpec JSON in one go.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSession, updateSession } from './session-store';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { validateNodeSpec } from './spec/validate';
import type {
  NodeSpec,
  UISchema,
  UISchemaField,
  UISchemaSection,
  JsonSchema,
  NodeDep,
  NodeExample,
} from './spec/types';

const execFileAsync = promisify(execFile);

// ── Public entry ─────────────────────────────────────────────────────────

export async function materializeNodeSpec(sessionId: string): Promise<NodeSpec> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  const proposal = session.proposal as Proposal | null;
  if (!proposal) {
    throw new Error(`Session ${sessionId} has no proposal — cannot materialize spec`);
  }
  if (!session.worktreePath) {
    throw new Error(`Session ${sessionId} has no worktreePath — cannot read library types`);
  }

  // 1. Mechanical derivations.
  const integrationType = deriveIntegrationType(proposal);
  const configSchema = buildConfigSchema(proposal.configFields ?? []);
  const defaultConfig = buildDefaultConfig(proposal.configFields ?? []);
  const uiSchema = buildUISchema(proposal, integrationType);
  const llmExamples = (proposal.testCases ?? []).map(toLlmExample);
  const deps: NodeDep[] = proposal.suggestedDeps ?? [];

  // 2. Focused LLM call for the executor body only. We install the proposal's
  //    new deps into the worktree first so we can read the actual .d.ts files
  //    and feed them into the prompt — without that the LLM hallucinates
  //    library APIs (e.g. ICAL.Component, tsdav.fetchEventsByTimeRange).
  const executorBody = await generateExecutorBody(proposal, deps, session.worktreePath);

  // 3. Auto-stub docs from proposal fields. The user can polish post-promotion.
  const docs = buildDocs(proposal);

  // 4. Assemble.
  const spec: NodeSpec = {
    type: proposal.type,
    label: proposal.label,
    category: proposal.category,
    description: proposal.description,
    llmDescription: proposal.llmDescription,
    llmExamples,
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: deriveOutputSchema(proposal.outputShape),
    configSchema,
    defaultConfig,
    uiSchema,
    executorBody,
    deps,
    docs,
    integrationType: integrationType ?? undefined,
  };

  // 5. Validate before persisting — codegen reads from session.nodeSpec.
  const validation = validateNodeSpec(spec);
  if (!validation.ok) {
    throw new Error(
      `Materialized NodeSpec failed validation:\n${validation.errors.join('\n')}`,
    );
  }

  await updateSession(sessionId, { nodeSpec: spec as unknown as Record<string, unknown> });
  return spec;
}

// ── Proposal shape (loosely typed; we only use a subset) ─────────────────

interface Proposal {
  type: string;
  label: string;
  category: string;
  description: string;
  llmDescription: string;
  approach?: string;
  rejectedAlternatives?: { name: string; reason: string }[];
  suggestedDeps?: NodeDep[];
  authMethod?: 'oauth2' | 'api-key' | 'none' | 'other';
  configFields?: ProposalConfigField[];
  outputShape?: { description?: string; example?: Record<string, unknown> };
  testCases?: { scenario: string; config: Record<string, unknown>; notes?: string }[];
}

interface ProposalConfigField {
  key: string;
  label: string;
  widget?: string;
  required?: boolean;
  description?: string;
}

// ── Derivations ──────────────────────────────────────────────────────────

function deriveIntegrationType(p: Proposal): string | null {
  // If the proposal mentions credentials, the integrationType matches the
  // node type (kebab-case). Most curated nodes will fit this default.
  if (p.authMethod === 'none') return null;
  return p.type;
}

function buildConfigSchema(fields: ProposalConfigField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.key] = { type: jsonTypeForWidget(f.widget), description: f.description ?? '' };
    if (f.required) required.push(f.key);
  }
  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function buildDefaultConfig(fields: ProposalConfigField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.widget === 'toggle') defaults[f.key] = false;
  }
  return defaults;
}

function buildUISchema(p: Proposal, integrationType: string | null): UISchema {
  const fields = p.configFields ?? [];
  const sections: UISchemaSection[] = [];

  // Connection section (if there's a credential picker).
  const credField = fields.find((f) => f.widget === 'credential-picker');
  if (credField && integrationType) {
    sections.push({
      title: 'Connection',
      intro: `Pick the credential to authenticate with ${p.label}.`,
      fields: [
        toUiField(credField, integrationType),
        ...fields.filter((f) => f.widget === 'resource-picker').map((f) => toUiField(f, integrationType, credField.key)),
      ],
    });
  }

  // Configuration section: everything that isn't credential/resource.
  const otherFields = fields.filter((f) => f.widget !== 'credential-picker' && f.widget !== 'resource-picker');
  if (otherFields.length > 0) {
    sections.push({
      title: 'Configuration',
      fields: otherFields.map((f) => toUiField(f, integrationType ?? undefined)),
    });
  }

  // Empty fallback so validateNodeSpec doesn't choke.
  if (sections.length === 0) {
    sections.push({ title: 'Configuration', fields: [] });
  }

  const banners = credField ? [{ kind: 'credential-status' as const, credentialField: credField.key }] : undefined;
  const actions =
    credField && integrationType
      ? [{
          kind: 'test-connection' as const,
          placement: 'top' as const,
          integrationType,
          credentialField: credField.key,
        }]
      : undefined;

  return { layout: 'single', sections, banners, actions };
}

function toUiField(
  f: ProposalConfigField,
  integrationType: string | undefined,
  credentialKey?: string,
): UISchemaField {
  const base = {
    key: f.key,
    label: f.label,
    description: f.description,
    required: f.required,
  };
  switch (f.widget) {
    case 'credential-picker':
      return { ...base, widget: 'credential-picker', integrationType: integrationType ?? f.key };
    case 'resource-picker':
      return {
        ...base,
        widget: 'resource-picker',
        integrationType: integrationType ?? f.key,
        credentialKey: credentialKey ?? 'credentialId',
      };
    case 'dropdown':
      // We don't have option lists in the proposal — use a string input as
      // a safe fallback. The user can edit post-promotion.
      return { ...base, widget: 'string' };
    case 'toggle':
      return { ...base, widget: 'toggle' };
    case 'textarea':
      return { ...base, widget: 'textarea' };
    case 'datetime':
      return { ...base, widget: 'datetime' };
    case 'template-string':
      return { ...base, widget: 'template-string' };
    default:
      return { ...base, widget: 'string' };
  }
}

function jsonTypeForWidget(widget: string | undefined): string {
  if (widget === 'toggle') return 'boolean';
  return 'string';
}

function toLlmExample(tc: { scenario: string; config: Record<string, unknown>; notes?: string }): NodeExample {
  return { scenario: tc.scenario, config: tc.config, notes: tc.notes };
}

function deriveOutputSchema(shape: Proposal['outputShape']): JsonSchema {
  if (!shape || !shape.example) return { type: 'object', additionalProperties: true };
  // Build a permissive schema from the example keys. Each property must
  // carry a `type` field — JsonSchema rejects bare { description } objects.
  const properties: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(shape.example)) {
    properties[key] = {
      type: jsonTypeForExampleValue(value),
      description: shape.description ?? '',
    };
  }
  return { type: 'object', properties, additionalProperties: true };
}

function jsonTypeForExampleValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function buildDocs(p: Proposal): string {
  const lines: string[] = [];
  lines.push(`> ${p.description}`, '');
  lines.push('## When to use', '', p.llmDescription, '');
  if (p.approach) {
    lines.push('## How it works', '', p.approach, '');
  }
  if (p.configFields && p.configFields.length > 0) {
    lines.push('## Configuration', '');
    for (const f of p.configFields) {
      lines.push(`- **${f.label}** (\`${f.key}\`)${f.required ? ' — required' : ''}${f.description ? ': ' + f.description : ''}`);
    }
    lines.push('');
  }
  if (p.outputShape) {
    lines.push('## Output', '');
    if (p.outputShape.description) lines.push(p.outputShape.description, '');
    if (p.outputShape.example) {
      lines.push('```json', JSON.stringify(p.outputShape.example, null, 2), '```', '');
    }
  }
  if (p.testCases && p.testCases.length > 0) {
    lines.push('## Examples', '');
    for (const tc of p.testCases) {
      lines.push(`### ${tc.scenario}`, '', '```json', JSON.stringify(tc.config, null, 2), '```', '');
      if (tc.notes) lines.push(tc.notes, '');
    }
  }
  return lines.join('\n');
}

// ── Executor body via focused LLM call ───────────────────────────────────

const EXECUTOR_SYSTEM_PROMPT_BASE = `\
You are writing the BODY of an async function in TypeScript.

Signature you are completing:
  async function execute(
    input: any,
    config: Record<string, any>,
    _ctx: any,
  ): Promise<{ output: Record<string, unknown>; rowCount?: number }> {
    // YOUR CODE GOES HERE
  }

Hard rules for the code:
- Output ONLY the function body. No \`function\` keyword. No \`async\` keyword.
- No import statements. The available identifiers are listed in the AVAILABLE
  IMPORTS section below — use those exact names verbatim.
- Use \`config\` for user-configured fields. Branch on a primary operation field
  (config.operation, config.action, etc.) if the node supports multiple ops.
- For credentialed nodes, fetch via \`await getCredential<KIND>(config.credentialId)\`
  where KIND is 'basic' | 'apikey' | 'oauth2'. Throw if null. The credential
  object's secret fields live under \`.payload\` (NOT \`.data\`):
    * basic   → cred.payload.username, cred.payload.password
    * apikey  → cred.payload.apiKey
    * oauth2  → cred.payload.accessToken, cred.payload.refreshToken, cred.payload.expiresAt
  Non-secret config (e.g. base URL) lives under \`.metadata\`.
- When a library exposes a class with a private constructor, do NOT use
  \`new ClassName()\` — look for a static factory like \`ClassName.create()\`,
  a top-level helper like \`createClient()\`, or a function-style export.
- Throw on errors with descriptive messages. Catch blocks must type the error
  as 'unknown' and use \`String(err)\` (or \`err instanceof Error ? err.message : String(err)\`)
  before referencing properties.
- Type EVERY callback parameter (e.g. \`.map((item: any) => ...)\`) — TypeScript
  strict mode rejects implicit any.
- Return shape: \`return { output: { ...your data... } };\` — the wrapping
  function expects the project's NodeResult shape, which has an \`output\`
  field. Do NOT return \`{ success: true, ... }\` or raw data — wrap it inside
  \`output\`. Optional: include \`rowCount\` (a number) when returning a list.

Output format:
Return a JSON object of shape: {"executor_body": "<the typescript code>"}.
The "executor_body" string must contain only TypeScript source — no markdown
fences, no commentary. Newlines and double-quotes inside the code must be
JSON-escaped (\\n, \\"). Do not return anything except the JSON object.
`;

// Mirrors the camel() + depImportName() functions in codegen/executor.ts
// so the prompt advertises the exact namespace names the codegen will emit.
function depImportNamespace(depName: string): string {
  if (depName === 'tsdav') return 'tsdav';
  const dashed = depName.replace(/[^a-z0-9]/gi, '-');
  return dashed.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Read the main .d.ts file for each declared dep from the worktree's
 * node_modules. Returns a markdown block formatted for the LLM prompt.
 *
 * Truncates each file to MAX_DTS_CHARS_PER_DEP (raw count, not tokens) to
 * keep the prompt size bounded. Falls back gracefully if a dep has no
 * types or the file can't be read — the LLM still gets the names of the
 * remaining deps and can use general knowledge.
 */
const MAX_DTS_CHARS_PER_DEP = 6000;

function readDepTypeDefs(deps: NodeDep[], worktreeDir: string): string {
  const blocks: string[] = [];

  for (const dep of deps) {
    const depDir = path.join(worktreeDir, 'node_modules', dep.name);
    const block = readSingleDepDts(dep.name, depDir);
    if (block) blocks.push(block);
  }
  return blocks.join('\n\n');
}

function readSingleDepDts(depName: string, depDir: string): string | null {
  // Find the entry .d.ts file via package.json's `types` / `typings` field,
  // falling back to common conventions.
  let dtsRel: string | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(depDir, 'package.json'), 'utf8')) as {
      types?: string;
      typings?: string;
      main?: string;
    };
    dtsRel = pkg.types ?? pkg.typings ?? null;
    if (!dtsRel && pkg.main) {
      // Try replacing .js extension with .d.ts.
      const candidate = pkg.main.replace(/\.(js|cjs|mjs)$/i, '.d.ts');
      if (fs.existsSync(path.join(depDir, candidate))) dtsRel = candidate;
    }
    if (!dtsRel && fs.existsSync(path.join(depDir, 'index.d.ts'))) {
      dtsRel = 'index.d.ts';
    }
  } catch {
    // Couldn't read package.json — fall through.
  }

  if (!dtsRel) return `### ${depName}\n(no type declarations found)`;

  let content: string;
  try {
    content = fs.readFileSync(path.join(depDir, dtsRel), 'utf8');
  } catch (err) {
    return `### ${depName}\n(could not read ${dtsRel}: ${err instanceof Error ? err.message : err})`;
  }

  if (content.length > MAX_DTS_CHARS_PER_DEP) {
    content = content.slice(0, MAX_DTS_CHARS_PER_DEP) + '\n// ... (truncated for prompt size)';
  }

  return `### ${depName} (from ${dtsRel}):\n\`\`\`ts\n${content}\n\`\`\``;
}

async function generateExecutorBody(
  proposal: Proposal,
  deps: NodeDep[],
  worktreeDir: string,
): Promise<string> {
  // Install proposal deps into the worktree so we can read their actual .d.ts
  // files. This is the same install that runGenerate would do later — running
  // it here is idempotent (npm install --save with already-present deps is a
  // fast no-op the second time around).
  if (deps.length > 0) {
    const pkgSpecs = deps.map((d) => `${d.name}@${d.version}`);
    await execFileAsync(
      'npm',
      ['install', '--save', '--no-audit', '--no-fund', ...pkgSpecs],
      { cwd: worktreeDir, timeout: 5 * 60 * 1000 },
    );
  }

  const dtsReference = readDepTypeDefs(deps, worktreeDir);

  const importsList = [
    '- getCredential — from $lib/integrations/credentials (always available)',
    ...deps.map((d) => `- ${depImportNamespace(d.name)} — from ${d.name}`),
  ];

  const systemPrompt = `${EXECUTOR_SYSTEM_PROMPT_BASE}
AVAILABLE IMPORTS (use these exact identifiers):
${importsList.join('\n')}

${dtsReference ? `LIBRARY TYPE REFERENCE — these are the ACTUAL type declarations
of each declared dep (read directly from node_modules). Match these names
and signatures exactly; do not invent methods or properties not shown here.

${dtsReference}
` : ''}`;

  const userPrompt = `Node type: ${proposal.type}
Label: ${proposal.label}
Description: ${proposal.description}
Approach: ${proposal.approach ?? proposal.llmDescription}

Auth method: ${proposal.authMethod ?? 'none'}

Config fields:
${(proposal.configFields ?? []).map((f) => `- ${f.key} (${f.widget ?? 'string'}${f.required ? ', required' : ''}): ${f.label}`).join('\n')}

Output shape: ${JSON.stringify(proposal.outputShape ?? { example: {} })}

Now write the function body. Remember: return { output: {...} }, type all
callback parameters, and use the namespace identifiers listed in the system
prompt's AVAILABLE IMPORTS section.`;

  // Stay on the admin-configured builder default (GLM-5.1 on z.ai).
  // Empirically GLM-5.1 with thinking enabled was hanging indefinitely
  // on free-text code-generation against this gateway — TCP connection
  // open, no response body, SDK timeout fires after 90s. The same model
  // + same gateway works fine for structured extraction (see extract.ts);
  // the failure mode is specific to verbose code emission with thinking.
  //
  // Disable GLM thinking for this call via the z.ai-specific `thinking`
  // parameter (Anthropic-style: { type: 'disabled' }). This skips the
  // reasoning chain that was timing out and lets the model emit content
  // directly. Keeps the JSON envelope + response_format as defensive
  // belt-and-braces — extract.ts confirms that path works on this gateway.
  const ctx = await resolveDefaultModel('builder');
  const { client, model } = await getLLMClient(ctx);

  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 16384,
      stream: false,
      // z.ai-specific extension: disable GLM-5 thinking to skip the
      // reasoning chain that hangs on this prompt shape. Forwarded by
      // the openai SDK as-is in the request body.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ thinking: { type: 'disabled' } } as any),
    },
    { timeout: 90_000, maxRetries: 0 },
  );

  const choice = response.choices[0];
  const rawContent = (choice?.message?.content ?? '').trim();

  if (!rawContent) {
    console.error(
      '[curate.materialize] executor body LLM returned empty content',
      {
        proposalType: proposal.type,
        promptChars: userPrompt.length,
        finishReason: choice?.finish_reason,
        usage: response.usage,
        contentRaw: choice?.message?.content,
      },
    );
    throw new Error(
      `Executor body LLM returned empty content ` +
      `(finish_reason=${choice?.finish_reason ?? 'unknown'}, ` +
      `prompt_tokens=${response.usage?.prompt_tokens ?? '?'}, ` +
      `completion_tokens=${response.usage?.completion_tokens ?? '?'}). ` +
      `Check gateway model setting / max_tokens.`,
    );
  }

  // Parse JSON envelope and extract the executor_body field.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawContent) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Executor body JSON parse failed: ${err instanceof Error ? err.message : String(err)}. ` +
      `First 300 chars: ${rawContent.slice(0, 300)}`,
    );
  }

  let body = typeof parsed.executor_body === 'string' ? parsed.executor_body.trim() : '';
  if (!body) {
    throw new Error(
      `Executor body LLM returned JSON without executor_body field. ` +
      `Got keys: ${Object.keys(parsed).join(', ') || '(empty)'}`,
    );
  }

  // Defensive: strip code fences if the model wrapped the body anyway.
  const fenceMatch = body.match(/^```(?:ts|typescript|javascript|js)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) body = fenceMatch[1].trim();

  return body;
}

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

// ── Public entry ─────────────────────────────────────────────────────────

export async function materializeNodeSpec(sessionId: string): Promise<NodeSpec> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  const proposal = session.proposal as Proposal | null;
  if (!proposal) {
    throw new Error(`Session ${sessionId} has no proposal — cannot materialize spec`);
  }

  // 1. Mechanical derivations.
  const integrationType = deriveIntegrationType(proposal);
  const configSchema = buildConfigSchema(proposal.configFields ?? []);
  const defaultConfig = buildDefaultConfig(proposal.configFields ?? []);
  const uiSchema = buildUISchema(proposal, integrationType);
  const llmExamples = (proposal.testCases ?? []).map(toLlmExample);
  const deps: NodeDep[] = proposal.suggestedDeps ?? [];

  // 2. Focused LLM call for the executor body only.
  const executorBody = await generateExecutorBody(proposal, deps);

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
  // Build a permissive schema from the example keys.
  const properties: Record<string, JsonSchema> = {};
  for (const key of Object.keys(shape.example)) {
    properties[key] = { description: shape.description ?? '' };
  }
  return { type: 'object', properties, additionalProperties: true };
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

const EXECUTOR_SYSTEM_PROMPT = `\
You are writing the BODY of an async function in TypeScript.

Signature you are completing:
  async function execute(input: any, config: any, _ctx: any): Promise<any> {
    // YOUR CODE GOES HERE
  }

Hard rules for the code:
- Output ONLY the function body. No \`function\` keyword. No \`async\` keyword.
- No import statements — assume \`getCredential\` from '$lib/integrations/credentials' is in scope, plus a namespace import for each declared dep (e.g. \`tsdav\` is the \`tsdav\` package, \`googleapis\` is the \`googleapis\` package).
- Use \`config\` for user-configured fields. Branch on a primary operation field if the node supports multiple operations.
- For credentialed nodes, fetch with \`await getCredential<KIND>(config.credentialId)\` (KIND = 'basic' | 'apikey' | 'oauth2'). Throw if null.
- Throw on errors with descriptive messages.
- Return the result object.

Output format:
Return a JSON object of shape: {"executor_body": "<the typescript code>"}.
The "executor_body" string must contain only TypeScript source — no markdown
fences, no commentary. Newlines and double-quotes inside the code must be
JSON-escaped (\\n, \\"). Do not return anything except the JSON object.
`;

async function generateExecutorBody(
  proposal: Proposal,
  deps: NodeDep[],
): Promise<string> {
  const userPrompt = `Node type: ${proposal.type}
Label: ${proposal.label}
Description: ${proposal.description}
Approach: ${proposal.approach ?? proposal.llmDescription}

Auth method: ${proposal.authMethod ?? 'none'}

Available deps: ${deps.length === 0 ? '(none — use stdlib + global fetch)' : deps.map((d) => d.name).join(', ')}

Config fields:
${(proposal.configFields ?? []).map((f) => `- ${f.key} (${f.widget ?? 'string'}${f.required ? ', required' : ''}): ${f.label}`).join('\n')}

Output shape: ${JSON.stringify(proposal.outputShape ?? { example: {} })}

Now write the function body.`;

  // Non-streaming call: streaming with GLM-5.x + large max_tokens + reasoning
  // was hanging indefinitely (the gateway opened the SSE stream but never
  // emitted the first content chunk). One-shot is fine here — the UI doesn't
  // render partial executor body, so we get nothing from streaming except
  // failure modes. Non-streaming also gives us finish_reason + usage for
  // diagnostics on empty content.
  const ctx = await resolveDefaultModel('builder');
  const { client, model } = await getLLMClient(ctx);

  // Mirrors src/lib/jkai/intel/extract.ts, which works reliably against
  // this same gateway + model. Earlier non-streaming free-text variants
  // hung the z.ai gateway indefinitely on this exact call shape; wrapping
  // the output in JSON via response_format unsticks it. max_tokens=16384
  // matches extract.ts. The 90s SDK timeout + maxRetries:0 fail fast if
  // the gateway hangs again, instead of pinning the SDK for the 10-min
  // default × 3 retries.
  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXECUTOR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 16384,
      stream: false,
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

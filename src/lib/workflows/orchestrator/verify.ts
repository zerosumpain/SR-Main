/**
 * Post-finalize verification for orchestrator-generated workflows.
 *
 * Propagates schemas through the graph and checks each node's config
 * for references to upstream fields that don't exist. Catches the
 * category of bugs where the builder LLM guesses at data shapes
 * (e.g. input.tips vs input.parsed.tips).
 */

import type { WorkflowNodeDef, WorkflowEdgeDef, JsonSchema, NodeDefinition } from '../types';
import { resolveUpstreamSchema, schemaToVariablePaths } from '../schema-propagation';

export interface VerificationIssue {
  nodeId: string;
  nodeLabel: string;
  field: string;
  issue: string;
  severity: 'error' | 'warning';
}

type OutputSchemaGetter = (type: string, config: Record<string, unknown>) => JsonSchema;
type DefinitionGetter = (type: string) => NodeDefinition | undefined;

/**
 * Patterns in template-textarea fields that the workflow engine CANNOT
 * interpolate. These are common LLM hallucinations — Jinja, Handlebars, or
 * raw template-literal syntax.
 */
const UNSUPPORTED_TEMPLATE_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\{%[\s\S]*?%\}/, name: 'Jinja block ({% ... %})' },
  { pattern: /\{\{\s*#(each|if|unless|with)\b/, name: 'Handlebars block helper ({{#each}}, {{#if}}, ...)' },
  { pattern: /\{\{\s*\/(each|if|unless|with)\b/, name: 'Handlebars block close ({{/each}}, {{/if}}, ...)' },
  { pattern: /\{\{\s*\.\.\//, name: 'Handlebars parent-scope reference ({{../x}})' },
];

/**
 * Scan a value for unsupported template syntax. Returns the first match name,
 * or null if clean. Only meant to flag template-textarea fields, not code.
 */
function detectUnsupportedTemplateSyntax(value: string): string | null {
  for (const { pattern, name } of UNSUPPORTED_TEMPLATE_PATTERNS) {
    if (pattern.test(value)) return name;
  }
  return null;
}

/**
 * Common code-execute body mistakes:
 * - `inputs` (plural) — the sandbox exposes `input` singular
 * - `process.env.X` without a known mapped key
 */
function detectCodeExecuteIssues(code: string): string[] {
  const problems: string[] = [];
  if (/\binputs\b/.test(code)) {
    problems.push('uses `inputs` (plural) — the sandbox exposes upstream data as `input` (singular). Replace `inputs.X` with `input.X`.');
  }
  // Flag reading process.env keys that aren't injected by the sandbox.
  const INJECTED = new Set(['TAVILY_API_KEY', 'OPENROUTER_API_KEY', 'ZAI_API_KEY', 'ELEVENLABS_API_KEY']);
  for (const m of code.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
    if (!INJECTED.has(m[1])) {
      problems.push(`reads process.env.${m[1]} — the sandbox only injects ${[...INJECTED].join(', ')} from /admin/ai/keys. For other secrets, add a new key via admin or use a dedicated integration node instead of code-execute.`);
      break; // one warning per unknown key is enough
    }
  }
  return problems;
}

/**
 * Per-operation required-field rules. These encode semantic requirements that
 * can't be expressed in a static configSchema.required (which doesn't vary by
 * operation). Returns a list of issue messages for a given node config.
 */
function detectSemanticGaps(node: WorkflowNodeDef): { field: string; issue: string; severity: 'error' | 'warning' }[] {
  const out: { field: string; issue: string; severity: 'error' | 'warning' }[] = [];
  const cfg = node.config as Record<string, unknown>;

  if (node.type === 'data-store' && cfg.operation === 'set' && !cfg.valuePath) {
    out.push({
      field: 'valuePath',
      issue: 'data-store set without valuePath will silently store the entire input blob. Set valuePath to the dot-path of the field to persist (e.g. "titles", "parsed.tips"), or add a transform upstream that places the value under "input.value".',
      severity: 'warning',
    });
  }

  if (node.type === 'blog' && (cfg.operation === 'create' || cfg.operation === 'update')) {
    if (cfg.operation === 'create' && !cfg.title) {
      out.push({ field: 'title', issue: 'blog create requires a title.', severity: 'error' });
    }
  }

  if (node.type === 'http-request') {
    const method = (cfg.method as string) || 'GET';
    if (['POST', 'PUT', 'PATCH'].includes(method) && !cfg.body) {
      out.push({ field: 'body', issue: `http-request with method ${method} usually needs a body — none configured.`, severity: 'warning' });
    }
  }

  if (node.type === 'whatsapp' && !cfg.message) {
    out.push({ field: 'message', issue: 'whatsapp message content is empty — the node will fail with "No message content configured".', severity: 'error' });
  }

  if (node.type === 'email' && !cfg.to) {
    out.push({ field: 'to', issue: 'email recipient is empty.', severity: 'error' });
  }

  if ((node.type === 'llm-call' || node.type === 'llm-agent') && !cfg.userPrompt) {
    out.push({ field: 'userPrompt', issue: `${node.type} requires a userPrompt.`, severity: 'error' });
  }

  if (node.type === 'interactive-step') {
    const mode = cfg.mode;
    const validModes = ['vnc', 'confirm', 'both'] as const;
    if (typeof mode !== 'string' || !(validModes as readonly string[]).includes(mode)) {
      out.push({
        field: 'mode',
        issue: `interactive-step mode must be one of "vnc", "confirm", "both" (got ${JSON.stringify(mode)}). For CAPTCHA/login: use "vnc" with profile + url. Without a valid mode the run will pause forever with no VNC session for the human to act on.`,
        severity: 'error',
      });
    } else if (mode === 'vnc' || mode === 'both') {
      if (!cfg.profile || typeof cfg.profile !== 'string') {
        out.push({
          field: 'profile',
          issue: `interactive-step mode="${mode}" requires a "profile" matching the downstream stealth-scrape profile — otherwise no VNC session is launched and the run stalls with no way for the human to act.`,
          severity: 'error',
        });
      }
      if (!cfg.url || typeof cfg.url !== 'string') {
        out.push({
          field: 'url',
          issue: `interactive-step mode="${mode}" requires a "url" — the landing/search page the headed browser opens on. Without it the noVNC session shows about:blank.`,
          severity: 'error',
        });
      }
    }
  }

  return out;
}

/**
 * Walk the configSchema's property enums and reject any value not in the
 * declared enum. configSchema enums were informational until now; a bad
 * value like `mode: "browse"` on interactive-step would silently slip
 * through and leave the run paused with no VNC.
 */
function detectEnumViolations(
  config: Record<string, unknown>,
  def: NodeDefinition | undefined,
): string[] {
  const problems: string[] = [];
  const props = def?.configSchema?.properties as Record<string, { enum?: unknown[] }> | undefined;
  if (!props) return problems;
  for (const [key, schema] of Object.entries(props)) {
    const declaredEnum = schema?.enum;
    if (!Array.isArray(declaredEnum) || declaredEnum.length === 0) continue;
    if (!(key in config)) continue;
    const value = config[key];
    if (!declaredEnum.includes(value as never)) {
      problems.push(
        `Invalid value for "${key}": ${JSON.stringify(value)}. Must be one of: ${declaredEnum.map((v) => JSON.stringify(v)).join(', ')}.`,
      );
    }
  }
  return problems;
}

/**
 * Submission-time validator — checks a single node's config BEFORE it's added
 * to the draft. Called from `use_node` / `workflow_add_node` handlers for
 * immediate LLM feedback. Focuses on single-node issues (not graph-level).
 * Returns null if valid, or a human-readable error string.
 */
export function validateNodeConfigPreSubmit(
  type: string,
  config: Record<string, unknown>,
  def: NodeDefinition | undefined,
): string | null {
  const errors: string[] = [];

  // Unknown config keys
  if (def?.configSchema?.properties) {
    const validKeys = new Set(Object.keys(def.configSchema.properties));
    validKeys.add('description');
    const unknown = Object.keys(config).filter((k) => !validKeys.has(k));
    if (unknown.length > 0) {
      errors.push(`Unknown config keys: ${unknown.join(', ')}. Valid keys for ${type}: ${[...validKeys].filter(k => k !== 'description').join(', ')}`);
    }
  }

  // Template syntax in template-textarea fields
  for (const field of def?.basicConfig ?? []) {
    if (field.type !== 'template-textarea') continue;
    const v = config[field.key];
    if (typeof v !== 'string') continue;
    const bad = detectUnsupportedTemplateSyntax(v);
    if (bad) {
      errors.push(`Field "${field.key}" uses ${bad}. Only {{input.field}} interpolation is supported. For loops or conditionals, add a transform node upstream that builds the string.`);
    }
  }

  // Code-execute body issues
  if (type === 'code-execute' && typeof config.code === 'string') {
    for (const msg of detectCodeExecuteIssues(config.code)) {
      errors.push(`code-execute: ${msg}`);
    }
  }

  // Enum enforcement — configSchema.properties[x].enum declares legal values.
  // Without this, `interactive-step` with mode="browse" would slip through
  // and leave runs paused with no VNC session.
  for (const msg of detectEnumViolations(config, def)) {
    errors.push(msg);
  }

  // Per-operation semantic gaps (errors only — warnings can wait for finalize)
  const semantic = detectSemanticGaps({
    id: '_', type, config, position: { x: 0, y: 0 }, label: '',
  } as WorkflowNodeDef).filter((g) => g.severity === 'error');
  for (const g of semantic) errors.push(`${g.field}: ${g.issue}`);

  return errors.length > 0 ? errors.join('\n') : null;
}

/**
 * Extract all `input.X.Y.Z` references from a string (template or expression).
 * Handles both {{input.X}} template syntax and bare input.X in JS expressions.
 */
function extractInputRefs(text: string): string[] {
  const refs = new Set<string>();
  // Template variables: {{input.field.path}}
  for (const m of text.matchAll(/\{\{input\.([^}]+?)\}\}/g)) {
    refs.add(m[1].trim());
  }
  // Bare JS references: input.field (not inside {{ }})
  for (const m of text.matchAll(/\binput\.([a-zA-Z_$][a-zA-Z0-9_.?]*)/g)) {
    // Strip optional chaining operator for path comparison
    refs.add(m[1].replace(/\?/g, ''));
  }
  return [...refs];
}

/**
 * Check if a dot-path has a valid prefix in the schema's known paths.
 * "parsed.tips" is valid if schema has a "parsed" property of type object.
 * We accept any path whose first segment exists in the schema.
 */
function pathHasValidRoot(ref: string, knownPaths: Set<string>): boolean {
  if (knownPaths.has(ref)) return true;
  // Check if any known path is a prefix of this ref
  for (const known of knownPaths) {
    if (ref.startsWith(known + '.')) return true;
  }
  // Check if first segment exists as a top-level key
  const firstSegment = ref.split('.')[0];
  return knownPaths.has(firstSegment);
}

/**
 * Verify a workflow graph for data-shape issues.
 *
 * For each node:
 * 1. Resolves the upstream schema (what input fields are available).
 * 2. Scans config string values for {{input.X}} and input.X references.
 * 3. Flags references that don't match the upstream schema.
 * 4. Validates config keys against the node definition's configSchema.
 */
export function verifyWorkflow(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getDefinition: DefinitionGetter,
  getOutputSchema: OutputSchemaGetter,
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  for (const node of nodes) {
    const def = getDefinition(node.type);

    // --- Config key validation ---
    if (def?.configSchema?.properties) {
      const validKeys = new Set(Object.keys(def.configSchema.properties));
      validKeys.add('description'); // always allowed (injected by assembler)
      for (const key of Object.keys(node.config)) {
        if (!validKeys.has(key)) {
          issues.push({
            nodeId: node.id,
            nodeLabel: node.label,
            field: key,
            issue: `Unknown config key "${key}". Valid keys for ${node.type}: ${[...validKeys].join(', ')}`,
            severity: 'error',
          });
        }
      }
    }

    // --- Template syntax validation (G1) ---
    for (const field of def?.basicConfig ?? []) {
      if (field.type !== 'template-textarea') continue;
      const v = node.config[field.key];
      if (typeof v !== 'string') continue;
      const bad = detectUnsupportedTemplateSyntax(v);
      if (bad) {
        issues.push({
          nodeId: node.id, nodeLabel: node.label, field: field.key,
          issue: `Contains ${bad}. Only {{input.field}} interpolation is supported. Build the string in an upstream transform node instead.`,
          severity: 'error',
        });
      }
    }

    // --- Code-execute body validation (G5) ---
    if (node.type === 'code-execute' && typeof node.config.code === 'string') {
      for (const msg of detectCodeExecuteIssues(node.config.code)) {
        issues.push({
          nodeId: node.id, nodeLabel: node.label, field: 'code',
          issue: msg, severity: 'error',
        });
      }
    }

    // --- Per-operation semantic gaps (G4) ---
    for (const gap of detectSemanticGaps(node)) {
      issues.push({ nodeId: node.id, nodeLabel: node.label, ...gap });
    }

    // --- Upstream schema resolution ---
    const upstreamSchema = resolveUpstreamSchema(
      node.id,
      nodes,
      edges,
      getOutputSchema,
    );
    const paths = schemaToVariablePaths(upstreamSchema);
    const knownPaths = new Set(paths.map((p) => p.path));

    // If the upstream schema has zero properties, we can't validate references
    // (the upstream might just not have a detailed output schema). Skip.
    if (knownPaths.size === 0) continue;

    // --- Scan config values for input references ---
    for (const [field, value] of Object.entries(node.config)) {
      if (typeof value !== 'string') continue;
      const refs = extractInputRefs(value);
      for (const ref of refs) {
        if (!pathHasValidRoot(ref, knownPaths)) {
          const available = paths
            .slice(0, 15)
            .map((p) => `input.${p.path}`)
            .join(', ');
          issues.push({
            nodeId: node.id,
            nodeLabel: node.label,
            field,
            issue: `Reference "input.${ref}" not found in upstream schema. Available: ${available}`,
            severity: 'error',
          });
        }
      }
    }
  }

  return issues;
}

/** Format issues into a string the LLM can act on. */
export function formatIssues(issues: VerificationIssue[]): string {
  if (issues.length === 0) return '';
  const lines = issues.map(
    (i) => `- [${i.severity}] Node "${i.nodeLabel}" (${i.nodeId}), field "${i.field}": ${i.issue}`,
  );
  return [
    `Verification found ${issues.length} issue(s):`,
    '',
    ...lines,
    '',
    'Fix these by calling use_node to update the affected config, or connect_nodes to rewire. Then call finalize_workflow again.',
  ].join('\n');
}

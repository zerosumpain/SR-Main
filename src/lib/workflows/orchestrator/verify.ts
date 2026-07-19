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
import { extractTemplateTokens, classifyTemplateToken } from '../state-templates';
import { validateWorkflowCompatibility } from '../mapping/compatibility';

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
  const INJECTED = new Set(['TAVILY_API_KEY', 'OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY']);
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
      errors.push(`Field "${field.key}" uses ${bad}. Supported template syntax is {{input.field}}, {{state.KEY}}, {{today}} and {{now}} only. For loops or conditionals, add a transform node upstream that builds the string.`);
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

/** Workflow-level trigger descriptor (mirrors `workflows.trigger` / the
 *  assembled GeneratedWorkflow.trigger). Optional on `verifyWorkflow` so
 *  existing 4-arg callers keep working; when supplied it lets the semantic-gap
 *  rule below know the workflow is scheduled/recurring even when the cron lives
 *  only in the workflow row (not a trigger node). */
export interface VerifyTrigger {
  type: string;
  config?: Record<string, unknown>;
}

/** Outbound "send" nodes — reaching one produces a side-effecting delivery. */
const OUTBOUND_SEND_TYPES = new Set([
  'whatsapp',
  'gmail-send',
  'gmail-reply',
  'email',
  'blog',
  'deck-build',
]);

/** Nodes that emit a LIST of items fetched from the outside world. Piped
 *  straight into a send on a recurring schedule, they re-deliver the same items
 *  every run unless a memory node filters them first.
 *
 *  `gmail-fetch` is deliberately NOT here: it fetches a SINGLE message by
 *  messageId (per-message idempotent, driven by a gmail-trigger that fires once
 *  per new message), so it never re-delivers a list. Only `gmail-search` (which
 *  returns a list) is a feed source — matching the generator's own hard-rule /
 *  critic prompts, which name gmail-search and never gmail-fetch. Listing
 *  gmail-fetch here made the canonical gmail auto-reply exemplars trip a bogus
 *  dedupe finding on every build. */
const LIST_SOURCE_TYPES = new Set([
  'tavily-search',
  'web-scrape',
  'stealth-scrape',
  'stealth-scrape-llm',
  'gmail-search',
  'http-request',
  'site-mapper',
]);

/** Sources whose output may just as well be a scalar snapshot (a health check)
 *  as a list of items. Flagging those as hard errors would send legitimate
 *  "poll a value and message me" monitors through spurious revision rounds — so
 *  they warn instead of erroring. */
const AMBIGUOUS_SOURCE_TYPES = new Set(['http-request']);

/** Memory nodes that break the "re-send" chain: `dedupe` filters seen ids;
 *  `data-store` persists a cursor/set the author can gate on. */
const MEMORY_TYPES = new Set(['dedupe', 'data-store']);

/** A `blog` node only "sends" when it creates/updates a post. */
function isOutboundSend(node: WorkflowNodeDef): boolean {
  if (!OUTBOUND_SEND_TYPES.has(node.type)) return false;
  if (node.type === 'blog') {
    const op = (node.config as Record<string, unknown>)?.operation;
    return op === 'create' || op === 'update' || op === undefined;
  }
  return true;
}

/**
 * True when the workflow fires on a recurring schedule/event (cron, interval,
 * platform event, or a gmail-trigger) — the class of workflow for which
 * "re-sends across runs" is a real failure. Manual/webhook-only triggers are
 * NOT treated as recurring (a manual run re-sending is expected).
 */
export function isRecurringWorkflow(
  nodes: WorkflowNodeDef[],
  trigger?: VerifyTrigger,
): boolean {
  const t = (trigger?.type ?? '').toLowerCase();
  if (t === 'cron' || t === 'interval' || t === 'schedule' || t === 'event') return true;
  for (const n of nodes) {
    // gmail-trigger fires on every matching inbound message — inherently recurring.
    if (n.type === 'gmail-trigger') return true;
    if (n.type === 'trigger') {
      const cfg = (n.config ?? {}) as Record<string, unknown>;
      const kind = String(cfg.kind ?? '').toLowerCase();
      if (kind === 'cron' || kind === 'interval' || kind === 'event') return true;
      if (typeof cfg.cron === 'string' && cfg.cron.trim().length > 0) return true;
    }
  }
  return false;
}

/**
 * Graph-level semantic-gap rule (B3): a recurring workflow that pipes a
 * list-producing source into an outbound send with NO dedupe/data-store node on
 * the path between them will re-send previously-sent items on every run. This
 * is exactly the live "news pipeline re-sends the same story" failure.
 *
 * Detection = reverse walk from each send node over incoming edges, treating any
 * memory node (dedupe/data-store) as a barrier we do NOT expand past. If that
 * barrier-respecting walk still reaches a list source, that source→send path is
 * unguarded ⇒ error. The message names the fix so the self-heal/revision loop
 * (which consumes error-severity issues) can auto-insert the dedupe node.
 */
function detectMissingDedupMemory(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  trigger?: VerifyTrigger,
): VerificationIssue[] {
  if (!isRecurringWorkflow(nodes, trigger)) return [];
  const sends = nodes.filter(isOutboundSend);
  if (sends.length === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const predecessors = new Map<string, string[]>();
  for (const e of edges) {
    const list = predecessors.get(e.targetNodeId) ?? [];
    list.push(e.sourceNodeId);
    predecessors.set(e.targetNodeId, list);
  }

  // Does `nodeId` have a memory node anywhere in its transitive upstream? Used
  // to recognise a FAN-IN (merge/join) that pulls a memory value in on one of
  // its branches — the manual "diff-dance" dedup shape (data-store get → merge →
  // transform-diff → send), where the memory guards the send even though it sits
  // on a PARALLEL branch rather than on the source→send chain itself.
  const memoryUpstreamCache = new Map<string, boolean>();
  const hasMemoryUpstream = (startId: string): boolean => {
    const cached = memoryUpstreamCache.get(startId);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const queue = [...(predecessors.get(startId) ?? [])];
    let found = false;
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (MEMORY_TYPES.has(nodeById.get(id)?.type ?? '')) {
        found = true;
        break;
      }
      for (const p of predecessors.get(id) ?? []) queue.push(p);
    }
    memoryUpstreamCache.set(startId, found);
    return found;
  };

  // Reverse-BFS from a send node; stop at memory barriers; return the first
  // list-source that reaches the send without passing through memory.
  const findUnguardedSource = (sendId: string): WorkflowNodeDef | null => {
    const seen = new Set<string>();
    const queue = [...(predecessors.get(sendId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = nodeById.get(id);
      if (!node) continue;
      if (MEMORY_TYPES.has(node.type)) continue; // barrier — memory protects the send
      // Check source BEFORE the fan-in barrier so a source that ALSO feeds the
      // send via a direct (bypass) edge is still flagged.
      if (LIST_SOURCE_TYPES.has(node.type)) return node;
      // Fan-in barrier: a join node (≥2 inputs) that pulls a memory value in on
      // one branch carries that memory forward (a downstream transform can dedup
      // against it), so it protects every source feeding the same join. This is
      // the diff-dance topology — without it, exemplar 7 flags its own scrape.
      const incoming = predecessors.get(id) ?? [];
      if (incoming.length >= 2 && hasMemoryUpstream(id)) continue;
      for (const p of incoming) queue.push(p);
    }
    return null;
  };

  // Report each unguarded source once (a single dedupe insert fixes all its sends).
  const flagged = new Map<string, { source: WorkflowNodeDef; send: WorkflowNodeDef }>();
  for (const send of sends) {
    const source = findUnguardedSource(send.id);
    if (source && !flagged.has(source.id)) flagged.set(source.id, { source, send });
  }

  return [...flagged.values()].map(({ source, send }) => {
    const ambiguous = AMBIGUOUS_SOURCE_TYPES.has(source.type);
    return {
      nodeId: source.id,
      nodeLabel: source.label,
      field: 'dedupe',
      issue: ambiguous
        ? `Recurring workflow: "${source.label}" (${source.type}) feeds the send node ` +
          `"${send.label}" (${send.type}) with no dedupe or data-store between them. If it returns ` +
          `a LIST of items, every scheduled run will re-send items already sent — insert a dedupe ` +
          `node after "${source.label}" and gate the send on its newCount. If it returns a single ` +
          `current value (status/snapshot) that SHOULD be sent every run, this is fine as-is.`
        : `Recurring workflow: "${source.label}" (${source.type}) produces a list that flows to the ` +
          `send node "${send.label}" (${send.type}) with no dedupe or data-store between them — ` +
          `every scheduled run will re-send items already sent. Insert a dedupe node immediately after ` +
          `"${source.label}" (idPath "url", falling back to "id"), before the send, so only genuinely ` +
          `new items continue downstream. Then gate the send on the dedupe's newCount (skip when 0).`,
      severity: ambiguous ? ('warning' as const) : ('error' as const),
    };
  });
}

/**
 * Author-time enforcement of the `site-tool` destructive-gating rule (C1): a
 * `site-tool` node with `allowDestructive: true` MUST have an `approval` node
 * somewhere upstream on its path, so a destructive site capability (send /
 * publish / delete) can never fire without human sign-off. This is the PRIMARY
 * guard — the executor's runtime check is belt-and-braces.
 *
 * Detection = reverse walk from each flagged site-tool node over incoming edges;
 * if no `approval` node is reachable upstream, error. The message names the fix.
 */
function detectSiteToolApprovalGaps(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
): VerificationIssue[] {
  const flagged = nodes.filter(
    (n) => n.type === 'site-tool' && (n.config as Record<string, unknown>)?.allowDestructive === true,
  );
  if (flagged.length === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const predecessors = new Map<string, string[]>();
  for (const e of edges) {
    const list = predecessors.get(e.targetNodeId) ?? [];
    list.push(e.sourceNodeId);
    predecessors.set(e.targetNodeId, list);
  }

  const hasUpstreamApproval = (startId: string): boolean => {
    const seen = new Set<string>();
    const queue = [...(predecessors.get(startId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (nodeById.get(id)?.type === 'approval') return true;
      for (const p of predecessors.get(id) ?? []) queue.push(p);
    }
    return false;
  };

  const issues: VerificationIssue[] = [];
  for (const node of flagged) {
    if (hasUpstreamApproval(node.id)) continue;
    const toolName = String((node.config as Record<string, unknown>)?.toolName ?? '(unset)');
    issues.push({
      nodeId: node.id,
      nodeLabel: node.label,
      field: 'allowDestructive',
      issue:
        `site-tool "${node.label}" invokes the destructive tool "${toolName}" with allowDestructive:true ` +
        `but has no approval node upstream. Add an approval node before this node so the run pauses for ` +
        `human sign-off before the destructive action fires (or set allowDestructive:false and pick a ` +
        `non-destructive tool).`,
      severity: 'error',
    });
  }
  return issues;
}

/**
 * Verify a workflow graph for data-shape issues.
 *
 * For each node:
 * 1. Resolves the upstream schema (what input fields are available).
 * 2. Scans config string values for {{input.X}} and input.X references.
 * 3. Flags references that don't match the upstream schema.
 * 4. Validates config keys against the node definition's configSchema.
 *
 * After the per-node pass, a graph-level rule (B3) flags recurring send
 * workflows that lack dedup memory. Pass `trigger` (the workflow-level trigger
 * descriptor) so the rule can see cron/interval schedules stored on the
 * workflow row rather than on a trigger node.
 */
export function verifyWorkflow(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getDefinition: DefinitionGetter,
  getOutputSchema: OutputSchemaGetter,
  trigger?: VerifyTrigger,
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
          issue: `Contains ${bad}. Supported template syntax is {{input.field}}, {{state.KEY}}, {{today}} and {{now}} only. Build the string in an upstream transform node instead.`,
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

    // --- Unknown template-variable warnings (A4) ---
    // Any {{...}} token that isn't {{input.*}} / {{state.*}} / {{today}} /
    // {{now}} won't be substituted at runtime. Warn (don't block) — block/helper
    // syntax is already reported as an error above, so skip that class here.
    for (const [field, value] of Object.entries(node.config)) {
      if (typeof value !== 'string') continue;
      const flagged = new Set<string>();
      for (const inner of extractTemplateTokens(value)) {
        if (flagged.has(inner)) continue;
        if (classifyTemplateToken(inner) !== 'unknown') continue;
        flagged.add(inner);
        issues.push({
          nodeId: node.id,
          nodeLabel: node.label,
          field,
          issue: `Unknown template variable {{${inner}}} — it will not be substituted. Supported: {{input.field}}, {{state.KEY}}, {{today}}, {{now}}.`,
          severity: 'warning',
        });
      }
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

  // --- Graph-level: recurring send without dedup memory (B3) ---
  issues.push(...detectMissingDedupMemory(nodes, edges, trigger));

  // --- Graph-level: destructive site-tool without upstream approval (C1) ---
  issues.push(...detectSiteToolApprovalGaps(nodes, edges));

  // --- Graph-level: handle-kind compatibility between connected nodes (D) ---
  issues.push(...detectEdgeIncompatibility(nodes, edges));

  return issues;
}

/**
 * Warn (never error) on edges whose source output kinds and target input kinds
 * do not overlap — the generator/spec path can create these (the interactive
 * canvas already blocks them). Anchored to the target node. Shares the same
 * handle-kind engine as the interactive auto-mapping assistant.
 */
function detectEdgeIncompatibility(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
): VerificationIssue[] {
  const labelById = new Map(nodes.map((n) => [n.id, n.label ?? n.type]));
  return validateWorkflowCompatibility(
    nodes.map((n) => ({ id: n.id, type: n.type })),
    edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
  ).map((c) => ({
    nodeId: c.targetNodeId,
    nodeLabel: labelById.get(c.targetNodeId) ?? c.targetType,
    field: 'connection',
    issue: c.issue,
    severity: c.severity,
  }));
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

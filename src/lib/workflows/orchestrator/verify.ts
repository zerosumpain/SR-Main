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

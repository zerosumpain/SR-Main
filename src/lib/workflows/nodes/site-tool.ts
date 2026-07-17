import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { isDenylistedTool } from './site-tool-denylist';

export { siteToolDef } from './site-tool.def';

/**
 * Deep-interpolate {{input.*}} into every string leaf of the args object.
 * Non-string leaves (numbers, booleans, nested objects, arrays) are walked but
 * otherwise passed through unchanged, so a tool schema expecting an array/object
 * still receives one. ({{state.*}} / {{today}} / {{now}} were already resolved
 * by the engine before this executor ran.)
 */
function interpolateArgs(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolateTemplate(value, input);
  if (Array.isArray(value)) return value.map((v) => interpolateArgs(v, input));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateArgs(v, input);
    }
    return out;
  }
  return value;
}

/** Classic Levenshtein edit distance (small strings — tool names). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** Up to 5 closest known tool names to `name` (substring hits first, then edit distance). */
function didYouMean(name: string, all: string[]): string[] {
  const lower = name.toLowerCase();
  const substr = all.filter((t) => t.toLowerCase().includes(lower) || lower.includes(t.toLowerCase()));
  const ranked = all
    .map((t) => ({ t, d: editDistance(lower, t.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(3, Math.floor(lower.length / 2)))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.t);
  const merged: string[] = [];
  for (const t of [...substr, ...ranked]) {
    if (!merged.includes(t)) merged.push(t);
    if (merged.length >= 5) break;
  }
  return merged;
}

/**
 * Walk incoming edges transitively from `nodeId` looking for an `approval` node
 * anywhere upstream on the path. Best-effort runtime enforcement of the
 * destructive-gating rule (the author-time verify rule in orchestrator/verify.ts
 * is the primary guard). Returns false when the current node id is unknown.
 */
function hasUpstreamApproval(context: ExecutionContext, nodeId: string | undefined): boolean {
  if (!nodeId) return false;
  const seen = new Set<string>();
  const queue: string[] = context.getIncomingEdges(nodeId).map((e) => e.sourceNodeId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const info = context.getNodeConfig(id);
    if (info?.type === 'approval') return true;
    for (const e of context.getIncomingEdges(id)) queue.push(e.sourceNodeId);
  }
  return false;
}

export const siteToolExecutor: NodeExecutor = {
  type: 'site-tool',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const toolName = String(config.toolName ?? '').trim();
    if (!toolName) {
      throw new Error('site-tool: no toolName configured. Set the tool to invoke (e.g. "save_memory").');
    }

    // Hard denylist — never invocable, regardless of dryRun / allowDestructive.
    if (isDenylistedTool(toolName)) {
      throw new Error(
        `site-tool: "${toolName}" is denylisted from workflows (arbitrary-code / self-modification / irreversible-wipe surface) and can never be invoked from the canvas.`,
      );
    }

    // Lazy dynamic import — the site-tools registry pulls server-only domain
    // modules and MUST NOT be imported at module-init time (circular-init hazard).
    const { getTool, getToolDefinitions } = await import('$lib/workflows/site-tools/registry');
    const tool = getTool(toolName);
    if (!tool) {
      const all = getToolDefinitions().map((d) => d.function.name);
      const suggestions = didYouMean(toolName, all);
      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' No close matches — see /admin/ai/tools for the full catalog.';
      throw new Error(`site-tool: unknown tool "${toolName}".${hint}`);
    }

    const interpolatedArgs = interpolateArgs(config.args ?? {}, input) as Record<string, unknown>;

    // DRY RUN: never invoke ANY tool. Return a simulated result describing what
    // WOULD have run, so wiring can be verified without side effects.
    if (context.dryRun) {
      return {
        output: { success: true, dryRun: true, wouldInvoke: toolName, args: interpolatedArgs, toolName },
        rowCount: 1,
        metadata: { dryRun: true },
      };
    }

    // Destructive gating.
    if (tool.destructive) {
      if (config.allowDestructive !== true) {
        throw new Error(
          `site-tool: "${toolName}" is a destructive tool (it sends/publishes/deletes). To run it, set allowDestructive: true AND place an approval node upstream of this node so the run pauses for human sign-off first.`,
        );
      }
      if (!hasUpstreamApproval(context, context._currentNodeId)) {
        throw new Error(
          `site-tool: "${toolName}" has allowDestructive: true but no approval node is wired upstream on its path. Add an approval node before this node so the destructive action is signed off before it fires.`,
        );
      }
    }

    // Bridge the tool's progress-emit onto the workflow event stream as a log.
    const toolCtx = {
      emit: (text: string) => {
        context.emit({
          type: 'log',
          runId: context.runId,
          nodeId: context._currentNodeId,
          data: { message: text, source: toolName },
          timestamp: new Date().toISOString(),
        });
      },
    };

    const result = await tool.handler(interpolatedArgs, toolCtx);

    if (!result.success) {
      // Route through the node error path so the node's On-failure config
      // (retry / continue / route) governs what happens next.
      throw new Error(result.error || `site-tool: "${toolName}" failed`);
    }

    return {
      output: { success: true, toolName, data: result.data },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in the args object' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        toolName: { type: 'string' },
        data: { type: 'object', description: "The invoked tool's data envelope" },
        dryRun: { type: 'boolean', description: 'true only on a dry run (no tool invoked)' },
      },
    };
  },
};

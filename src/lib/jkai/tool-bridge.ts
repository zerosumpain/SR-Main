import {
  executeTool,
  getTool,
  getToolDefinitions,
  getToolsetManifest,
} from '$lib/workflows/site-tools/registry';

// The per-build credential lives in `bridge-token.ts` — re-exported here so
// existing callers keep working, and importable on its own by anything that
// needs to check a build's identity without pulling in the tool registry.
export { signBridgeToken, verifyBridgeToken } from './bridge-token';

/**
 * Destructive tools are not on the bridge. Ever.
 *
 * Everywhere else a `destructive: true` tool reaches a human first — the MCP
 * dispatcher raises a confirmation and fails closed when nobody is attached. A
 * build has nobody attached by construction: it is a headless agent running for
 * up to two hours. Handing it `gmail_send`, `publish_page` or
 * `node_builder_commit_and_deploy` would be handing it the one class of action
 * the confirmation gate exists to hold back, with the gate bypassed.
 *
 * It costs the builder nothing: a change-request build ships through a pull
 * request, and an app build is published by the user from the builds page.
 */
export function isBridgeable(name: string): boolean {
  return getTool(name)?.destructive !== true;
}

export async function invokeTool(name: string, args: unknown): Promise<unknown> {
  if (!getTool(name)) throw new Error(`unknown tool: ${name}`);
  if (!isBridgeable(name)) {
    throw new Error(
      `${name} is a destructive tool and is not available to builds. It needs a human to ` +
        `confirm it, and no human is attached to a build. Report what you wanted to do in ` +
        `## Evaluation instead.`,
    );
  }
  const result = await executeTool(name, (args ?? {}) as Record<string, unknown>);
  if (!result.success) {
    throw new Error(result.error ?? 'tool execution failed');
  }
  return result;
}

export function manifestForBuild(enabledToolsets: string[]) {
  const all = getToolsetManifest()
    .map((t) => ({ ...t, tools: t.tools.filter((x) => isBridgeable(x.name)) }))
    .filter((t) => t.tools.length > 0);
  if (enabledToolsets.includes('all')) return all;
  return all.filter((t) => enabledToolsets.includes(t.toolset));
}

export function definitionsForBuild(enabledToolsets: string[]) {
  const allDefs = getToolDefinitions().filter((d) => isBridgeable(d.function.name));
  if (enabledToolsets.includes('all')) return allDefs;
  const allowedNames = new Set(
    manifestForBuild(enabledToolsets).flatMap((m) => m.tools.map((t) => t.name)),
  );
  // No fail-open. This used to end `|| allowedSets.length === 0`, so a list
  // that matched no toolset — `[]`, or a stale/misspelt name — handed the agent
  // EVERY tool, the exact opposite of what the list asked for. `['all']` is the
  // wildcard and it is checked above; anything else means "only these", and
  // matching nothing means nothing.
  return allDefs.filter((d) => allowedNames.has(d.function.name));
}

import { loadToolRegistry } from '$lib/workflows/site-tools/load-registry';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';

// The per-build credential lives in `bridge-token.ts` — re-exported here so
// existing callers keep working, and importable on its own by anything that
// needs to check a build's identity without pulling in the tool registry.
export { signBridgeToken, verifyBridgeToken } from './bridge-token';

/**
 * The catalogue is loaded on demand, not statically.
 *
 * `site-tools/registry` imports all 52 tool modules for their `register()` side
 * effects, so a static edge to it put ~440 files in the closure of every
 * endpoint that touches this module — `/api/jkai/tools/{invoke,manifest}` and,
 * through the `verifyBridgeToken` re-export above, both `/api/jkai/studio/*`
 * handlers, which only ever wanted fifteen lines of HMAC. SR-Main #873 did this
 * for chat; the build bridge was the other static importer and is the same fix.
 *
 * Every export here is therefore async. They were already called from async
 * handlers, so no call site changed shape beyond an `await`.
 */
type Registry = Awaited<ReturnType<typeof loadToolRegistry>>;

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
 *
 * The rule is one line and lives here, taking an already-loaded registry so the
 * three public helpers below cannot drift from each other or pay for a second
 * load.
 */
function bridgeable(reg: Registry, name: string): boolean {
  return reg.getTool(name)?.destructive !== true;
}

export async function isBridgeable(name: string): Promise<boolean> {
  return bridgeable(await loadToolRegistry(), name);
}

export async function invokeTool(name: string, args: unknown, allowedTools?: string[], attribution?: { buildId: string; iterationId?: string }): Promise<unknown> {
  const reg = await loadToolRegistry();
  if (!reg.getTool(name)) throw new Error(`unknown tool: ${name}`);
  if (!bridgeable(reg, name)) {
    throw new Error(
      `${name} is a destructive tool and is not available to builds. It needs a human to ` +
        `confirm it, and no human is attached to a build. Report what you wanted to do in ` +
        `## Evaluation instead.`,
    );
  }
  // Through the executor seam rather than `reg.executeTool`, so there stays
  // exactly one place that knows how to reach the catalogue.
  const result = await executeSiteTool(name, (args ?? {}) as Record<string, unknown>, { emit: () => {}, allowedTools, ...attribution });
  if (!result.success) {
    throw new Error(result.error ?? 'tool execution failed');
  }
  return result;
}

export async function manifestForBuild(enabledToolsets: string[]) {
  const reg = await loadToolRegistry();
  const all = reg.getToolsetManifest()
    .map((t) => ({ ...t, tools: t.tools.filter((x) => bridgeable(reg, x.name)) }))
    .filter((t) => t.tools.length > 0);
  if (enabledToolsets.includes('all')) return all;
  return all.filter((t) => enabledToolsets.includes(t.toolset));
}

export async function definitionsForBuild(enabledToolsets: string[]) {
  const reg = await loadToolRegistry();
  const allDefs = reg.getToolDefinitions().filter((d) => bridgeable(reg, d.function.name));
  if (enabledToolsets.includes('all')) return allDefs;
  const allowedNames = new Set(
    (await manifestForBuild(enabledToolsets)).flatMap((m) => m.tools.map((t) => t.name)),
  );
  // No fail-open. This used to end `|| allowedSets.length === 0`, so a list
  // that matched no toolset — `[]`, or a stale/misspelt name — handed the agent
  // EVERY tool, the exact opposite of what the list asked for. `['all']` is the
  // wildcard and it is checked above; anything else means "only these", and
  // matching nothing means nothing.
  return allDefs.filter((d) => allowedNames.has(d.function.name));
}

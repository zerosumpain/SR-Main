import { unattendedPrincipal } from '$lib/tools/in-process-principal';
import { declaredTier } from '$lib/tools/declared-tier';
import { loadToolRegistry } from '$lib/tools/load-registry';
import { executeSiteTool } from '$lib/tools/executor';

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
function bridgeable(reg: Registry, name: string, opts: { web?: boolean } = {}): boolean {
  const tool = reg.getTool(name);
  if (!tool || tool.destructive === true) return false;
  // The declared tier, failing closed: no effect is destructive, and anything
  // that always confirms or rides the commission lane needs a human too.
  const tier = declaredTier(tool);
  if (tier.effect === 'destructive' || tier.confirm === 'always' || tier.lane !== 'standard') return false;
  // A closed list of reads, plus only the reviewed build mutates. A read is
  // not harmless just because it changes nothing: a build is a coding agent
  // that also has a shell and the network, so the owner's mail, memory,
  // health, intel, trips, captures and daydreams must never reach it, and
  // neither may a fetch that could carry them out.
  if (tier.effect === 'read' && tier.confirm === 'never') {
    if ((BRIDGE_READS as readonly string[]).includes(name)) return true;
    return opts.web === true && (BRIDGE_WEB_READS as readonly string[]).includes(name);
  }
  return (BRIDGE_MUTATES as readonly string[]).includes(name);
}

/**
 * The reads a build may call over the bridge, reviewed by hand: its own builds
 * and workspace, CodeGraph, the skills and tool catalogue, and the workflow
 * node catalogue. Nothing personal (mail, memory, health, intel, recall,
 * knowledge, trips, captures, daydream, activity, calendar, files, datastore,
 * the owner's workflows and runs), no secrets listing, no browser and no
 * `fetch_url`.
 */
export const BRIDGE_READS = [
  'build_list', 'build_inspect', 'build_get_iteration', 'build_get_plan', 'build_get_logs', 'build_list_files', 'build_read_file',
  'codegraph_query',
  'skills_list', 'skill_view', 'tool_search', 'tool_describe', 'capabilities_snapshot',
  'workflow_list_node_types', 'workflow_describe_node',
] as const;

/**
 * Web research, only for a build whose declared toolsets name it explicitly
 * (`BRIDGE_WEB_TOOLSETS`; never through 'all'): a search, not a fetch, so the
 * build cannot post private data to a URL of its choosing.
 */
export const BRIDGE_WEB_READS = ['research_web_search'] as const;
export const BRIDGE_WEB_TOOLSETS = ['research', 'web'] as const;

/** Whether a build's declared toolsets explicitly ask for web research. */
export function buildWantsWeb(enabledToolsets: readonly string[]): boolean {
  return enabledToolsets.some((t) => (BRIDGE_WEB_TOOLSETS as readonly string[]).includes(t));
}

/**
 * The mutates a build may call over the bridge, reviewed by hand. Everything
 * else that changes something is off the bridge.
 *
 * A build is an unattended 'bridge' principal running a coding agent for up to
 * two hours. It edits its own workspace with the agent's file and shell tools
 * and is published by a person from the builds page, so it needs very little
 * from the site that changes anything:
 *
 * - `build_write_file`: writing into the workspace through the site, which the
 *   agent can already do locally. Held to the calling build's own workspace
 *   and its 'dev' space (`buildWriteRefusal`), never another build's or the
 *   published 'live' copy.
 *
 * Deliberately left off, though a toolset may name them: `register_chat_build`
 * and `build_create`/`build_tweak`/`build_control`/`studio_build` (a build
 * starting, replacing or publishing builds, which spends and can overwrite
 * another app); `research_*` and `generate_*`/`write_document` (spend, and the
 * output lands in the owner's library, not the workspace); `browser_*` (the
 * owner's signed-in browser); and every personal-data mutate: memory,
 * `notify_owner`, mail labels, Home Assistant, credentials and API
 * registrations, follow-ups, schedules and heartbeat actions, datastore,
 * monitors, workflows, trips and daydream rulings. No build uses any of them:
 * delivery builds already keep to `developmentTools` (reads only) and app
 * builds publish through a person.
 */
export const BRIDGE_MUTATES = ['build_write_file'] as const;

/**
 * `build_write_file` takes any build id and either space. On the bridge it is
 * held to the calling build and its dev space, or the sentence saying why not.
 */
export function buildWriteRefusal(args: Record<string, unknown>, buildId: string | undefined): string | null {
  if (!buildId || args.buildId !== buildId) {
    return 'build_write_file on the bridge writes only to this build\'s own workspace.';
  }
  if (args.space !== undefined && args.space !== 'dev') {
    return 'build_write_file on the bridge writes only to the dev space; a person publishes the live copy.';
  }
  return null;
}

export async function isBridgeable(name: string): Promise<boolean> {
  return bridgeable(await loadToolRegistry(), name);
}

export async function invokeTool(name: string, args: unknown, allowedTools?: string[], attribution?: { buildId: string; iterationId?: string }): Promise<unknown> {
  const reg = await loadToolRegistry();
  if (!reg.getTool(name)) throw new Error(`unknown tool: ${name}`);
  // Web research is open only when the build's own list (from
  // `definitionsForBuild`, which applied `buildWantsWeb`) names it.
  if (!bridgeable(reg, name, { web: allowedTools?.includes(name) === true })) {
    const tier = declaredTier(reg.getTool(name)!);
    if (tier.effect === 'read' && tier.confirm === 'never') {
      throw new Error(
        `${name} reads things builds are not given (the owner's private data, or the open web). ` +
          `Report what you wanted to know in ## Evaluation instead.`,
      );
    }
    if (tier.effect === 'mutate' && tier.confirm !== 'always' && tier.lane === 'standard') {
      throw new Error(
        `${name} changes the owner's things outside this build and is not available to builds. ` +
          `Report what you wanted to do in ## Evaluation instead.`,
      );
    }
    throw new Error(
      `${name} is a destructive tool and is not available to builds. It needs a human to ` +
        `confirm it, and no human is attached to a build. Report what you wanted to do in ` +
        `## Evaluation instead.`,
    );
  }
  const input = (args ?? {}) as Record<string, unknown>;
  if (name === 'build_write_file') {
    const refusal = buildWriteRefusal(input, attribution?.buildId);
    if (refusal) throw new Error(refusal);
  }
  // Through the executor seam rather than `reg.executeTool`, so there stays
  // exactly one place that knows how to reach the catalogue.
  const result = await executeSiteTool(name, input, {
    emit: () => {},
    allowedTools,
    // Never attended: no human is attached to a build. Its list is the build's
    // toolsets narrowed by `bridgeable`, so only the reviewed BRIDGE_MUTATES
    // change anything.
    principal: unattendedPrincipal('build-bridge', allowedTools ?? [], 'bridge'),
    ...attribution,
  });
  if (!result.success) {
    throw new Error(result.error ?? 'tool execution failed');
  }
  return result;
}

export async function manifestForBuild(enabledToolsets: string[]) {
  const reg = await loadToolRegistry();
  const web = buildWantsWeb(enabledToolsets);
  const all = reg.getToolsetManifest()
    .map((t) => ({ ...t, tools: t.tools.filter((x) => bridgeable(reg, x.name, { web })) }))
    .filter((t) => t.tools.length > 0);
  if (enabledToolsets.includes('all')) return all;
  return all.filter((t) => enabledToolsets.includes(t.toolset));
}

export async function definitionsForBuild(enabledToolsets: string[]) {
  const reg = await loadToolRegistry();
  const web = buildWantsWeb(enabledToolsets);
  const allDefs = reg.getToolDefinitions().filter((d) => bridgeable(reg, d.function.name, { web }));
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

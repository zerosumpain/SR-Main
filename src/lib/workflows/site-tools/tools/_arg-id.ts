// src/lib/workflows/site-tools/tools/_arg-id.ts
//
// Read an id argument under any of the names the toolset actually uses.
//
// The workflows toolset names the same concept two different ways, and the
// majority spelling is the wrong one for its most-called tool:
//
//   `workflowId`  workflow_lint, workflow_amend, workflow_add_node,
//                 workflow_add_edge, workflow_add_schedule, workflow_generate,
//                 workflow_subscribe, workflow_unsubscribe,
//                 workflow_clear_data_store, workflow_get_generation_log  (10)
//   `id`          workflow_inspect, workflow_delete, workflow_update_metadata,
//                 workflow_run                                             (4)
//
// So a caller learns `workflowId` from ten tools and then spends it on
// `workflow_inspect`, which declares `id`. Measured over 30 days:
// `workflow_inspect` was called 73 times and **35 of those carried no `id`
// key at all** — 17 `workflowId`, 4 `id_or_slug`, 12 with no arguments. Each
// one reached `eq(workflows.id, undefined)` and came back
// **"Workflow not found"**, which is a claim about the WORKFLOW rather than
// about the call. There were 51 of those results in the window. The obvious
// next move on being told a workflow does not exist is to go and list them
// again, which is most of why `workflow_list` ran 23 times for 4 distinct
// argument sets.
//
// This is the same fault that made `ha_query_state` return `404 Not Found` on
// `entityId` (32 of 72 calls), and the repo had already settled the principle
// twice before that: `resolveWorkflowId` in `$lib/mcp/server.ts` takes
// `workflow_id` or `workflowId`, and Hermes' own arguments arrive stringified
// often enough that the house rule is coerce, never reject.
//
// Renaming the parameters instead would be the tidier fix and the wrong one:
// it breaks every stored workflow spec, every saved canvas op and any
// ephemeral tool written against the current names.

/** camelCase → snake_case, for generating the sibling spelling. */
function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export interface ReadIdOptions {
  /**
   * Accept a bare `id` as this argument.
   *
   * Off for tools that take TWO ids — on `workflow_subscribe(buildId,
   * workflowId)` a bare `id` is genuinely ambiguous, and guessing which one
   * was meant is how you subscribe the wrong build.
   */
  allowBareId?: boolean;
  /** Extra names seen in the wild that no rule would generate. */
  extra?: string[];
}

/**
 * The first usable string among the canonical name, its snake_case sibling,
 * any supplied aliases, and (unless disabled) a bare `id`.
 *
 * Order matters: the declared name always wins, so a caller that gets it right
 * is never second-guessed by a stray alias sitting alongside it.
 */
export function readId(
  args: Record<string, unknown> | null | undefined,
  canonical: string,
  options: ReadIdOptions = {},
): string {
  const { allowBareId = true, extra = [] } = options;
  const candidates = [canonical, snake(canonical), ...extra, ...(allowBareId ? ['id'] : [])];
  for (const key of candidates) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Aliases seen on live `workflow_inspect` calls that no rule would generate. */
export const WORKFLOW_ID_ALIASES = ['id_or_slug', 'idOrSlug', 'workflow'];

/** Read the workflow id under any spelling the toolset has ever used. */
export function readWorkflowId(args: Record<string, unknown> | null | undefined, options: ReadIdOptions = {}): string {
  return readId(args, 'workflowId', { extra: WORKFLOW_ID_ALIASES, ...options });
}

/**
 * The message for a call that named no id at all.
 *
 * Deliberately not "Workflow not found". That sentence answers a question
 * nobody asked — it asserts something about the estate when the actual problem
 * is the argument, and it sends the caller off to re-list workflows that were
 * never missing. Say which names are accepted, so the next call succeeds.
 */
export function missingIdError(subject: string, canonical: string): string {
  return `No ${subject} id was supplied. Pass \`${canonical}\` (\`${snake(canonical)}\` and \`id\` are also accepted). This is a problem with the call, not a missing ${subject} — nothing has been looked up.`;
}

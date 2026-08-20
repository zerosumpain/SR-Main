// MCP essentials gate — names of tools that stay visible in `tools/list`
// when the meta-tool dispatcher is enabled (env JKAI_MCP_META_TOOL=1).
//
// Everything else in the registry is reached via `jkai_extended` (see
// ./meta-tool.ts) with list/schema/invoke operations, cutting the manifest
// from ~28k to ~3k tokens. The tools/call dispatch path is unaffected — it
// still looks up tools by name in the full unfiltered registry — so a tool
// name surfaced via jkai_extended.list can also be invoked directly.
//
// Default behaviour (flag absent or != '1'): no filtering. The full registry
// is exposed exactly as before. Flip on the VPS after a smoke test.

export const ESSENTIAL_TOOL_NAMES = new Set<string>([
  // Persistent memory — needed in nearly every turn.
  'save_memory',
  'recall_memories',
  'forget_memory',
  // Scheduling primitive — the user-visible "remind me / follow up at" path.
  'schedule_reply_at',
  // Heartbeat watcher registration — long-running task observability.
  'register_heartbeat_action',
  // Primary outbound notification channel.
  'whatsapp_send',
  // Static-app creation path. jkai-general SKILL.md explicitly tells the
  // model to call this whenever it builds a self-contained HTML app in
  // chat. Routing it through jkai_extended.invoke is fragile (the model
  // sometimes misforms the wrapper args), and the prompt-cost of a single
  // tool definition is modest vs. losing the "build me a quick app" UX.
  'register_hermes_build',
  // New-workflow path. Same rationale: the design-first flow ends with a
  // workflow_build_from_spec call, and the model must reliably hit it
  // after the user confirms. Cheap insurance.
  'workflow_build_from_spec',
  // The GROUNDED build path, and the reason build_from_spec above is no longer
  // the default. Both the canvas skill and build_from_spec's own description
  // said "prefer workflow_generate" — and production did the opposite, 26 hand-
  // authored specs to 3 generates, because only one of them was free to reach.
  // The model was not ignoring the instruction; it was pricing it. A tool the
  // prompt calls mandatory has to cost the same as the one it warns about.
  'workflow_generate',
  // Read-only, ~163 tokens, and the single cheapest way to stop a bad build
  // reaching the DB. It was used on 9 of 29 builds while sitting behind a
  // jkai_extended round-trip; the run that thrashed hardest (13 builds, 14
  // deletes, 2026-07-17) never called it once.
  'workflow_lint',
  // New-presentation path (sr. decks). Same design-first flow: outline agreed
  // in chat, then one build call — must survive the meta-tool squeeze.
  'presentation_build_from_spec',
  // API-first answering. `api_search`/`api_call` are the entry points for
  // fetching live/factual data before falling back to model knowledge, and
  // `datastore_query` reads the permanent structured store — all three must
  // stay visible so the model reaches for them without a meta-tool round-trip.
  'api_search',
  'api_call',
  // The secret registry + integration register. `api_secrets_list` is how the
  // model discovers a credential it is allowed to use without ever seeing one,
  // and `api_integration_list`/`_call` are the cheap path for a question a
  // recorded integration already answers — both must stay visible or the model
  // re-derives (or gives up on) an API call it already owns.
  'api_secrets_list',
  'api_integration_list',
  'api_integration_call',
  // The out-of-band credential form. This one MUST be top-level: it is needed
  // at the exact moment the model discovers a credential is missing, and if
  // reaching it costs a jkai_extended round-trip the model will do the cheap
  // thing instead and ask the user to paste the key into the chat. That is the
  // failure this tool exists to prevent — on 2026-08-01 it put a live bank
  // client_secret into ten places including an LLM provider. Cheap insurance.
  'request_credential',
  // Its update sibling, top-level for the same reason: the moment that matters
  // is "your key expired", and if changing one costs a jkai_extended round-trip
  // the model asks for a paste instead.
  'update_credential',
  'datastore_query',
  // Unified recall across files + research + memory + datastore — the @knowledge
  // entry point. Kept visible so "what do I know about X" reaches it directly.
  'knowledge_search',
  // ── Measured first-turn hot set (2026-08-20) ─────────────────────────────
  // Not guessed. Counted out of Hermes' state.db: for every top-level jkai
  // thread, the `jkai_extended` sub-tools invoked on the FIRST turn, ranked by
  // how many DISTINCT threads reached for them (raw call counts lie — a single
  // Home-Assistant thread can fire `ha_query_state` a hundred times). The five
  // below are the top of that list, and every one of them was costing a
  // `jkai_extended` discovery round-trip before the work could start, on a
  // first turn that already took a median 30s to say anything at all.
  //
  // Same argument as `workflow_lint` above: a tool the model has to pay a
  // round-trip to reach is a tool it prices out of the plan. Measured off a
  // real `tools/list`, the five add 3,031 characters — about 760 tokens —
  // against a ~1.5k budget, so no descriptions were trimmed and nothing
  // changes for the toolset lane or the workflow nodes.
  //
  // `apple_calendar_list` was next (8 threads) and is deliberately NOT here:
  // its schema alone is ~750 tokens, which would nearly double the cost of
  // this whole promotion for one fewer thread than the cheapest tool above it.
  'workflow_list',       // 16 threads — "what canvases do I already have"
  'workflow_inspect',    // 14 threads — reads one canvas before changing it
  'file_search',         // 10 threads — semantic search over /drive
  'gmail_search',        //  9 threads — the mail entry point
  'ha_query_state',      //  9 threads — "is the X on"
]);

export function isMetaToolEnabled(): boolean {
  return process.env.JKAI_MCP_META_TOOL === '1';
}

/**
 * Is `name` directly visible in `tools/list`? The hardcoded set above, plus
 * anything the active tool-call policy has promoted.
 *
 * Promotion is ADDITIVE ONLY. Every name in ESSENTIAL_TOOL_NAMES is there for a
 * documented reason, so letting an overlay demote one would be a capability
 * regression rather than the hint change the overlay is allowed to make —
 * see `promoteToEssential` in $lib/toolpolicy/policy.ts.
 *
 * Lives here rather than in server.ts because meta-tool.ts needs it too and
 * already imports from server.ts; putting it there would close an import cycle.
 */
export function isEssentialUnderPolicy(
  name: string,
  policy: { promoteToEssential: string[] },
): boolean {
  return ESSENTIAL_TOOL_NAMES.has(name) || policy.promoteToEssential.includes(name);
}

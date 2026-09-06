import { currentExecution, withExecution } from '$lib/jkai/grounding/execution';
import { retainEvidence } from '$lib/jkai/grounding/evidence.server';
import { validateArguments } from '$lib/jkai/grounding/schema';
// Tool Registry — Slim Coordinator
// Types and register() live in registry-internal.ts to avoid circular init with domain modules.

export { register } from './registry-internal';
export type { ToolDefinition, ToolResult } from './registry-internal';
import { ownerPhone } from '$lib/config/owner';
import { tools, getToolsByToolset, getAvailableToolsets, isRegisteredTool } from './registry-internal';
import type { ToolResult } from './registry-internal';

// --- Load all domain modules (each calls register() on import) ---
import './tools/evidence';
import './tools/health';
import './tools/activity';
import './tools/blog';
import './tools/builds';
import './tools/studio';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';
import './tools/diagnostics';
import './tools/capabilities';
import './tools/memory';
import './tools/followup';
import './tools/heartbeat';
import './tools/scheduled';
import './tools/home-assistant';
import './tools/visualise';
import './tools/ephemeral-tools';
import './tools/media-write-document';
import './tools/publish-page';
import './tools/request-change';
import './tools/media-generate-image';
import './tools/media-generate-audio-tts';
import './tools/scraper';
import './tools/file-share';
import './tools/files';
import './tools/route-export';
import './tools/route-plan';
import './tools/knowledge';
import './tools/intel-graph';
import './tools/mail';
import './tools/codegraph';
import './tools/agents';
import './tools/discovery';
import './tools/recall';
import './tools/browser';
import './tools/monitors';
import './tools/gmail';
import './tools/apple-calendar';
import './tools/node-call';
import './tools/custom-tool-admin';
import './tools/web';
import './tools/node-builder';
import './tools/site-signals';
import './tools/news';
import './tools/presentations';
import './tools/datastore';
import './tools/apis';
import './tools/api-integrations';
import './tools/request-credential';
import './tools/update-credential';

// --- Public API ---

export function getTools() {
  return tools as readonly (typeof tools)[number][];
}

/** Look up a single registered tool by name. */
export function getTool(name: string) {
  return tools.find((t) => t.name === name);
}

/** Get OpenAI-format tool definitions for ALL registered tools (used by workflow engine, not general chat) */
export function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Get OpenAI-format tool definitions for a specific toolset */
export function getToolsetDefinitions(toolset: string) {
  return getToolsByToolset(toolset).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * OpenAI-format definitions for specific tools, by name.
 *
 * For pushing an individual capability into the always-on set without dragging
 * its whole toolset along: `research_web_search` lives in `research`, which
 * also carries nine session-management tools nobody wants on every turn.
 *
 * Silently skips a name that is not registered — the caller is a prompt-assembly
 * path and must not fail a turn because a tool was renamed.
 */
export function getToolDefinitionsByName(names: readonly string[]) {
  return names
    .map((n) => tools.find((t) => t.name === n))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

/** Compact manifest of all toolsets — category, tool names, and one-line descriptions */
export function getToolsetManifest(): Array<{
  toolset: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
}> {
  const toolsetDescriptions: Record<string, string> = {
    health: 'Health & fitness data — weekly stats, readiness, sleep, training load, timeline',
    activity: 'Personal activity sources connected on /jkai/sources — games and playtime (Steam), listening, archives; grant-gated summaries, search and provenance',
    blog: 'Blog post management — list, create, update, publish/unpublish',
    builds: 'JKAI autonomous builder — create, monitor, control, inspect, publish builds',
    research: 'Deep dive research — start sessions, get reports, query findings, web search',
    workflows: 'Workflow automation — create, inspect, edit nodes/edges/schedules, and amend an existing canvas in one atomic, audited change (workflow_amend)',
    home: 'Home Assistant smart home — query state, control devices, history, templates',
    whatsapp: 'WhatsApp messaging — send messages and notifications',
    diagnostics: 'System diagnostics — scheduler status, run history, service logs',
    followups: 'Follow-up queue — schedule/track background tasks and get notified when they complete',
    heartbeat: 'Heartbeat actions — register periodic agent check-ins on a long-running task and mark them complete',
    schedule: 'Scheduled callbacks — one-shot time-based fires (a fixed reply, a direct tool call, or a re-engagement) at a specific time',
    memory: 'Persistent memory — save, recall, and forget facts about the user',
    visualise: 'Inline visual responses — render charts (Vega-Lite), maps (Mapbox), diagrams (Mermaid), and tables directly in the chat, plus place-name geocoding (OpenStreetMap) so map points land where they are meant to',
    media: 'Media generation — create downloadable files (markdown, code, CSV, JSON, text) as conversation attachments',
    scraper: 'Scraper intelligence — look up target domain knowledge (CAPTCHA requirements, CSS selectors, interactive hints) before planning scraper workflows',
    files: 'Workflow file store — list, read, and semantically SEARCH files uploaded via /drive (file_search finds files by their content, including image visuals/OCR and audio transcripts). PDFs, DOCX, audio, and video are auto-extracted to text on read.',
    gmail: 'Gmail — search/read messages and threads on connected accounts, list labels, send/reply/modify-labels (write actions require user confirmation)',
    'apple-calendar': 'Apple Calendar — list iCloud calendars/events and create events on a selected calendar (creation requires user confirmation)',
    web: 'Web — fetch the readable contents of a public HTTP/HTTPS URL (HTML or plain text). Use when the user shares a link or you need to look up the page behind a URL.',
    'node-builder': 'Workflow node codegen — scaffold, validate, and commit/deploy new canvas node types (repo-modifying; deploy ships to production and is confirmation-gated)',
    'custom-tools': 'Custom/ephemeral tools — author a throwaway tool for the current turn and promote a useful one into a persistent tool',
    'site-signals': 'Live site signals (read-only) — current GPS walk/ride status, family presence (who is home), and DfE policy-engine tracking indicators',
    news: 'Live technical news — search the current Hacker News and Lobsters wires and return source links',
    decks: 'sr. decks presentations — list, build from a spec, inspect, and manage block-based slide decks',
    datastore: 'Permanent sitewide datastore — full CRUD over collections of JSON records with filters/aggregates and row-level permissions (structured/queryable data that persists across chats and workflows)',
    apis: 'API catalogue + integration register — search catalogued external data sources, call them for live data (SSRF-guarded), authenticate with owner-registered secret handles you can use but never read (api_secrets_list), and RECORD a working call as a reusable named integration (api_integration_save/test) that also appears in the no-code canvas node',
    knowledge: 'Unified knowledge recall — one search across /drive files, deep-dive research facts, personal memory, and datastore records (the @knowledge mention)',
    discovery: 'Find capability you were not handed — search every registered tool by keyword (tool_search), read one tool\'s exact schema (tool_describe), and list or read the curated skill playbooks (skills_list, skill_view)',
    browser: 'A real headless browser on the residential-IP host — navigate, read the page, click, type, scroll, list images, and read the console. Use for pages that need JavaScript or a login, and for diagnosing why a page misbehaves',
    recall: 'Continuity across conversations — search what was actually said before (session_search), search stored facts about the user (memory_search), and pin a new one (memory_remember)',
    agents: 'Persistent agent team — list/define named specialist agents and delegate a focused sub-task to one (each has its own persona, allowed tools, and shared team memory)',
    monitors: 'Natural-language monitors — create a "watch X, tell me when Y" scheduled workflow and list active monitors (manage/pause on /jkai/daydreams/watches)',
    'codegraph': 'Build-history GRAPH for this repo — what changing a file has taught us before. Seed a query with file:PATH, fingerprint:<error class>, gate:NAME or topic:"text", then pipe | hops 1 | lessons | episodes. Returns the rules that apply to those files and what happened the last time they changed, each with a verdict (verified/landed/repaired). Use for "how do I change X here", "why is it done this way", "has this broken before" — where intel-graph answers about the WORLD, this answers about the CODE.',
    'intel-graph': 'Intel knowledge GRAPH structure — find entities, walk their N-hop neighbourhood, trace how two things are connected, and read what the graph noticed on its own (brokers, unexpected links, likely-missing links). Use when the question is about how things RELATE, where knowledge_search answers what is known ABOUT a thing.',
  };

  const manifest = getAvailableToolsets().map((ts) => ({
    toolset: ts,
    description: toolsetDescriptions[ts] || ts,
    tools: getToolsByToolset(ts).map((t) => ({
      name: t.name,
      description: t.description,
    })),
  }));

  return manifest;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: import('./registry-internal').ToolExecContext,
): Promise<ToolResult> {
  ctx = ctx ?? currentExecution();
  if (ctx?.allowedTools && !ctx.allowedTools.includes(name)) return { success: false, error: `Tool ${name} is outside this caller's capability scope` };
  if (ctx?.signal?.aborted || (ctx?.deadline && Date.now() > ctx.deadline)) return { success: false, error: 'Invocation cancelled or expired' };
  if ((ctx?.depth ?? 0) > 5) return { success: false, error: 'Nested capability depth exceeded' };
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };
  const issues = validateArguments(tool.parameters, args);
  if (issues.length) return { success: false, error: 'invalid_arguments', data: { issues, inputSchema: tool.parameters } };
  let result: ToolResult;
  try {
    result = await withExecution(ctx ?? { emit: () => {} }, () => tool.handler(args, ctx));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  // Attach a durable watcher to anything that spawns a long-running task.
  //
  // This hook used to live in general-chat.ts, which the cutover made
  // dormant — so every `producesLongRunningTask` declaration went inert and
  // the last auto-bound watcher dates from May. The model was told by the tool
  // catalogue that watchers attach themselves, so it stopped registering them;
  // when it did register one by hand it had no task binding and could only
  // guess at progress. Hooking the shared execution boundary instead of one
  // engine's loop means both paths get it.
  if (tool.producesLongRunningTask && ctx?.conversationId && result?.success) {
    try {
      const { autoRegisterFromToolResult } = await import('$lib/heartbeat/auto-register');
      const outcome = await autoRegisterFromToolResult({
        conversationId: ctx.conversationId,
        toolName: name,
        produces: tool.producesLongRunningTask,
        resultData: result.data,
      });
      if (!outcome.registered) {
        console.warn(`[heartbeat-auto] skipped ${name}: ${outcome.reason}`);
      }
    } catch (err) {
      // A watcher is a nicety; never fail the tool call over it.
      console.error(`[heartbeat-auto] failed for ${name}:`, err);
    }
  }

  return retainEvidence(name, result, ctx);
}

/** Compact system prompt section — lists toolsets, not individual tools */
export function buildSystemPromptSection(): string {
  const toolsets = getAvailableToolsets();
  // The owner's WhatsApp number used to be appended here as a literal, which
  // put it in the repo, in every commit, and in the prompt sent to a model on
  // every single turn. It is read from the environment now, and only mentioned
  // at all when something is configured to receive it.
  const phone = ownerPhone();
  const contact = phone ? `\n\nJohn's WhatsApp number: ${phone}` : '';
  return `\n\n--- Capabilities ---\nYou have toolsets available: ${toolsets.join(', ')}.\nUse activate_toolset(name) to load tools for a domain. Use jkai_help() to see what's available in each toolset.\nWhen tools are pre-loaded for you, use them directly — no activation needed.${contact}`;
}

// Re-export toolset helpers for use by meta-tools and general-chat
export { getToolsByToolset, getAvailableToolsets, isRegisteredTool };

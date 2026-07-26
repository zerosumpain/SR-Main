// Tool Registry — Slim Coordinator
// Types and register() live in registry-internal.ts to avoid circular init with domain modules.

export { register } from './registry-internal';
export type { ToolDefinition, ToolResult } from './registry-internal';
import { tools, getToolsByToolset, getAvailableToolsets, isRegisteredTool } from './registry-internal';
import type { ToolResult } from './registry-internal';

// --- Load all domain modules (each calls register() on import) ---
import './tools/health';
import './tools/blog';
import './tools/builds';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';
import './tools/diagnostics';
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
import './tools/files';
import './tools/knowledge';
import './tools/intel-graph';
import './tools/agents';
import './tools/monitors';
import './tools/gmail';
import './tools/web';
import './tools/node-builder';
import './tools/site-signals';
import './tools/presentations';
import './tools/datastore';
import './tools/apis';
import './tools/api-integrations';

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

/** Compact manifest of all toolsets — category, tool names, and one-line descriptions */
export function getToolsetManifest(): Array<{
  toolset: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
}> {
  const toolsetDescriptions: Record<string, string> = {
    health: 'Health & fitness data — weekly stats, readiness, sleep, training load, timeline',
    blog: 'Blog post management — list, create, update, publish/unpublish',
    builds: 'JKAI autonomous builder — create, monitor, control, inspect, publish builds',
    research: 'Deep dive research — start sessions, get reports, query findings, web search',
    workflows: 'Workflow automation — create, inspect, edit nodes/edges/schedules',
    home: 'Home Assistant smart home — query state, control devices, history, templates',
    whatsapp: 'WhatsApp messaging — send messages and notifications',
    diagnostics: 'System diagnostics — scheduler status, run history, service logs',
    followups: 'Follow-up queue — schedule/track background tasks and get notified when they complete',
    heartbeat: 'Heartbeat actions — register periodic agent check-ins on a long-running task and mark them complete',
    schedule: 'Scheduled callbacks — one-shot time-based fires (a fixed reply, a direct tool call, or a re-engagement) at a specific time',
    memory: 'Persistent memory — save, recall, and forget facts about the user',
    visualise: 'Inline visual responses — render charts (Vega-Lite), maps (Leaflet), and tables directly in the chat',
    media: 'Media generation — create downloadable files (markdown, code, CSV, JSON, text) as conversation attachments',
    scraper: 'Scraper intelligence — look up target domain knowledge (CAPTCHA requirements, CSS selectors, interactive hints) before planning scraper workflows',
    files: 'Workflow file store — list, read, and semantically SEARCH files uploaded via /drive (file_search finds files by their content, including image visuals/OCR and audio transcripts). PDFs, DOCX, audio, and video are auto-extracted to text on read.',
    gmail: 'Gmail — search/read messages and threads on connected accounts, list labels, send/reply/modify-labels (write actions require user confirmation)',
    web: 'Web — fetch the readable contents of a public HTTP/HTTPS URL (HTML or plain text). Use when the user shares a link or you need to look up the page behind a URL.',
    'node-builder': 'Workflow node codegen — scaffold, validate, and commit/deploy new canvas node types (repo-modifying; deploy ships to production and is confirmation-gated)',
    'custom-tools': 'Custom/ephemeral tools — author a throwaway tool for the current turn and promote a useful one into a persistent tool',
    'site-signals': 'Live site signals (read-only) — current GPS walk/ride status, family presence (who is home), and DfE policy-engine tracking indicators',
    decks: 'sr. decks presentations — list, build from a spec, inspect, and manage block-based slide decks',
    datastore: 'Permanent sitewide datastore — full CRUD over collections of JSON records with filters/aggregates and row-level permissions (structured/queryable data that persists across chats and workflows)',
    apis: 'API catalogue + integration register — search catalogued external data sources, call them for live data (SSRF-guarded), authenticate with owner-registered secret handles you can use but never read (api_secrets_list), and RECORD a working call as a reusable named integration (api_integration_save/test) that also appears in the no-code canvas node',
    knowledge: 'Unified knowledge recall — one search across /drive files, deep-dive research facts, personal memory, and datastore records (the @knowledge mention)',
    agents: 'Persistent agent team — list/define named specialist agents and delegate a focused sub-task to one (each has its own persona, allowed tools, and shared team memory)',
    monitors: 'Natural-language monitors — create a "watch X, tell me when Y" scheduled workflow and list active monitors (manage/pause on /jkai/monitors)',
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
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };
  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Compact system prompt section — lists toolsets, not individual tools */
export function buildSystemPromptSection(): string {
  const toolsets = getAvailableToolsets();
  return `\n\n--- Capabilities ---\nYou have toolsets available: ${toolsets.join(', ')}.\nUse activate_toolset(name) to load tools for a domain. Use jkai_help() to see what's available in each toolset.\nWhen tools are pre-loaded for you, use them directly — no activation needed.\n\nJohn's WhatsApp number: +447359228511`;
}

// Re-export toolset helpers for use by meta-tools and general-chat
export { getToolsByToolset, getAvailableToolsets, isRegisteredTool };

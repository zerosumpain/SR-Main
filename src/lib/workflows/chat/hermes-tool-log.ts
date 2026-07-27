// Rewrite Hermes' inline tool-call log into plain English.
//
// Hermes interleaves a progress log into the assistant's *text stream*, so these
// lines land in `orchestrator_chats.content` and render as prose in the bubble:
//
//   ⚙️ mcp_jkai_recall_memories: "david foley"
//   ⚙️ mcp_jkai_jkai_extended: "workflow_inspect" (×2)
//   ⚙️ mcp_jkai_ha_get_history...
//
// That is machinery leaking into the answer: a namespaced MCP identifier, a raw
// argument, and a repeat count. The thread already has a proper home for tool
// activity — the CATEGORY-chipped step cards fed by `tool-summary.ts` — so this
// module's job is only to make the *prose* copy readable: same line, same rough
// length, said in English.
//
// It is a pure string transform over the raw message text, applied before the
// markdown parse, so it fixes live streaming and stored history alike with no
// migration.

/** Marks a rewritten line so the bubble can style it as machinery, not answer. */
export const TOOL_LOG_CLASS = 'tool-log-step';

/**
 * One Hermes log entry.
 *
 * `arg` is whatever Hermes put after the colon — usually a query string, but for
 * the `jkai_extended` meta-dispatcher it is the *inner tool name*, which is why
 * that case is unwrapped rather than quoted.
 */
export interface HermesToolLogEntry {
  tool: string;
  arg: string | null;
  count: number;
}

/**
 * Match one log entry. Deliberately strict about the separator: the tool name
 * must be followed by an ellipsis or a colon before we claim a match, so a
 * half-streamed `⚙️ mcp_jkai_recall_mem` is left alone until it completes
 * rather than being rewritten and then rewritten again.
 */
const ENTRY_RE =
  /⚙️?[ \t]*([A-Za-z0-9_-]+)(?:(?:\.{3}|…)|[ \t]*:[ \t]*(?:["“”']([^"“”'\n]*)["“”']|([^\n(]+?)))[ \t]*(?:\(×(\d+)\))?/g;

/** Strip Hermes' `mcp_<server>_` namespace. Server names carry no underscore. */
function stripMcpNamespace(tool: string): string {
  const m = tool.match(/^mcp_[^_]+_(.+)$/);
  return m ? m[1] : tool;
}

/** A bare snake_case identifier — how `jkai_extended` names its inner tool. */
function looksLikeToolName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value);
}

function quote(value: string, max = 48): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  const clipped = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return `“${clipped}”`;
}

/** `workflow_build_from_spec` → `workflow build from spec`. */
function humanise(tool: string): string {
  return tool.replace(/_/g, ' ').trim();
}

/**
 * Verb phrases for the tools that actually show up in the log. Each takes the
 * argument (already trimmed, may be null) and returns a sentence WITHOUT the
 * repeat suffix — `describeHermesToolCall` appends that.
 *
 * Everything not listed falls through to a generic `Ran <tool>` phrasing, which
 * is honest rather than wrong. Add a row here when a new tool starts appearing.
 */
const PHRASES: Record<string, (arg: string | null) => string> = {
  // Memory
  recall_memories: (a) => (a ? `Searched saved memories for ${quote(a)}` : 'Searched saved memories'),
  save_memory: () => 'Saved a memory',
  forget_memory: () => 'Removed a saved memory',

  // Knowledge / intel
  knowledge_search: (a) => (a ? `Searched the knowledge base for ${quote(a)}` : 'Searched the knowledge base'),
  intel_find: (a) => (a ? `Looked up ${quote(a)} in the intel graph` : 'Searched the intel graph'),
  intel_neighbourhood: (a) => (a ? `Walked the graph around ${quote(a)}` : 'Walked the intel graph'),
  intel_path: () => 'Traced a connection through the intel graph',
  intel_insights: () => 'Read findings out of the intel graph',

  // Files / drive
  file_search: (a) => (a ? `Searched your files for ${quote(a)}` : 'Searched your files'),
  file_list: (a) => (a ? `Listed files under ${quote(a)}` : 'Listed your files'),
  file_read: (a) => (a ? `Read ${quote(a)}` : 'Read a file'),
  write_document: (a) => (a ? `Wrote the document ${quote(a)}` : 'Wrote a document'),

  // Research / web
  research_web_search: (a) => (a ? `Searched the web for ${quote(a)}` : 'Searched the web'),
  web_search: (a) => (a ? `Searched the web for ${quote(a)}` : 'Searched the web'),
  research_search: (a) => (a ? `Searched past research for ${quote(a)}` : 'Searched past research'),
  research_list: () => 'Listed past research sessions',
  fetch_url: (a) => (a ? `Fetched ${quote(a)}` : 'Fetched a web page'),
  webpage_fetch: (a) => (a ? `Fetched ${quote(a)}` : 'Fetched a web page'),

  // Canvas / workflows
  workflow: () => 'Worked on the canvas',
  workflow_list: () => 'Listed your canvases',
  workflow_inspect: () => 'Read the current canvas',
  workflow_create: (a) => (a ? `Created the canvas ${quote(a)}` : 'Created a canvas'),
  workflow_build_from_spec: (a) => (a ? `Built the canvas ${quote(a)}` : 'Built a canvas from a spec'),
  workflow_update_node: () => 'Updated a node on the canvas',
  workflow_add_node: () => 'Added a node to the canvas',
  workflow_remove_node: () => 'Removed a node from the canvas',
  workflow_add_edge: () => 'Connected two nodes on the canvas',
  workflow_remove_edge: () => 'Disconnected two nodes on the canvas',
  workflow_delete: () => 'Deleted a canvas',
  workflow_run: () => 'Ran the canvas',
  workflow_get_run: () => 'Read a canvas run result',
  workflow_lint: () => 'Checked the canvas for problems',
  workflow_list_node_types: () => 'Checked what node types exist',
  register_hermes_build: () => 'Registered the build',
  presentation_build_from_spec: (a) => (a ? `Built the deck ${quote(a)}` : 'Built a deck from a spec'),

  // Home Assistant
  ha_query_state: (a) => (a ? `Read the state of ${quote(a)}` : 'Read a device state'),
  ha_call_service: (a) => (a ? `Controlled ${quote(a)}` : 'Controlled a device'),
  ha_get_history: (a) => (a ? `Read device history for ${quote(a)}` : 'Read device history'),
  ha_render_template: () => 'Asked Home Assistant to work something out',

  // Health
  health_sleep: () => 'Checked your sleep data',
  health_readiness: () => 'Checked your readiness data',
  health_training_load: () => 'Checked your training load',

  // Integrations / secrets
  api_search: (a) => (a ? `Searched the API catalogue for ${quote(a)}` : 'Searched the API catalogue'),
  api_integration_list: () => 'Listed your API integrations',
  api_secrets_list: () => 'Checked which API credentials exist',

  // Messaging
  whatsapp_send: () => 'Sent a WhatsApp message',
  gmail_search: (a) => (a ? `Searched your mail for ${quote(a)}` : 'Searched your mail'),
  gmail_send: () => 'Sent an email',
  gmail_reply: () => 'Replied to an email',

  // Meta
  activate_toolset: (a) => (a ? `Loaded the ${a} toolset` : 'Loaded a toolset'),
  jkai_help: () => 'Checked what it can do',
  delegate_task: () => 'Handed work to a sub-agent',
};

/**
 * Turn one parsed entry into a sentence.
 *
 * The `jkai_extended` dispatcher is unwrapped first: its argument is the real
 * tool name, so `jkai_extended: "workflow_inspect"` describes a canvas read, not
 * a lookup of the string "workflow_inspect".
 */
export function describeHermesToolCall(entry: HermesToolLogEntry): string {
  let tool = stripMcpNamespace(entry.tool);
  let arg = entry.arg && entry.arg.trim().length > 0 ? entry.arg.trim() : null;

  if (tool === 'jkai_extended' && arg) {
    if (looksLikeToolName(arg)) {
      tool = arg;
      arg = null;
    } else {
      // A prose preview rather than a tool name (e.g. "intel entity") — keep it
      // as the subject of a generic lookup.
      return withCount(`Looked up ${quote(arg)}`, entry.count);
    }
  }

  const phrase = PHRASES[tool];
  const text = phrase
    ? phrase(arg)
    : arg
      ? `Ran ${humanise(tool)} on ${quote(arg)}`
      : `Ran ${humanise(tool)}`;

  return withCount(text, entry.count);
}

function withCount(text: string, count: number): string {
  return count > 1 ? `${text} — ${count} calls` : text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Rewrite every Hermes tool-log entry in `text` into a plain-English step line.
 *
 * Emitted as a block-level `<div class="tool-log-step">` surrounded by blank
 * lines so `marked` treats it as an HTML block rather than folding it into the
 * neighbouring paragraph — Hermes often glues an entry straight onto the end of
 * a sentence with no newline at all. The chat sanitiser allows `div` + `class`,
 * so the markup survives to the bubble.
 */
export function rewriteHermesToolLog(text: string): string {
  if (!text || text.indexOf('⚙') === -1) return text;

  const rewritten = text.replace(
    ENTRY_RE,
    (_match, tool: string, quoted: string | undefined, bare: string | undefined, count: string | undefined) => {
      const arg = quoted ?? bare ?? null;
      const sentence = describeHermesToolCall({
        tool,
        arg: arg === undefined ? null : arg,
        count: count ? Number(count) : 1,
      });
      return `\n\n<div class="${TOOL_LOG_CLASS}">${escapeHtml(sentence)}</div>\n\n`;
    },
  );

  // Collapse the blank-line padding we just introduced so a run of consecutive
  // entries doesn't leave a gulf of empty paragraphs behind it.
  return rewritten.replace(/\n{3,}/g, '\n\n').trim();
}

// Rewrite Hermes' inline tool-call log into plain English.
//
// Hermes interleaves a progress log into the assistant's *text stream*, so these
// lines land in `orchestrator_chats.content` and render as prose in the bubble:
//
//   ⚙️ mcp_jkai_recall_memories: "david foley"
//   ⚙️ mcp_jkai_jkai_extended: "workflow_inspect" (×2)
//   🔍 web_search: "House of Lords members salary allowan..."
//   📄 web_extract: "https://www.parliament.uk/business/lo..."
//
// That is machinery leaking into the answer: a namespaced MCP identifier, a raw
// argument, and a repeat count. The thread already has a proper home for tool
// activity — the CATEGORY-chipped step cards fed by `tool-summary.ts` — so this
// module's job is only to make the *prose* copy readable: same line, same rough
// length, said in English.
//
// **The leading glyph is per-tool, not always ⚙️.** Hermes resolves it with
// `get_tool_emoji(tool, default="⚙️")` (gateway/run.py), which reads the tool
// registry's own `emoji` field first. Only tools with no registered emoji — every
// `mcp_jkai_*` tool, because they arrive over MCP — fall back to ⚙️. Hermes' own
// native tools each carry their own: 🔍 web_search, 📄 web_extract, 🐍
// execute_code, 💻 terminal, 🔀 delegate_task, 📚 skill_view, … So matching on
// ⚙️ alone covers the MCP half of the log and silently misses the native half.
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
 * The glyphs Hermes puts in front of a *tool* entry — an explicit allowlist of
 * the `emoji=` values registered across its tool modules, plus ⚙️/⚡, the two
 * hardcoded fallbacks for tools that register none (which is every MCP tool).
 *
 * An allowlist rather than "any emoji" because the assistant's own prose is full
 * of glyph-then-word-then-colon shapes that must survive untouched. Real examples
 * from production replies: `✅ Corrected:`, `🥇 WINNER:`, `→ recommendation:`,
 * `— kicker:`. Matching any leading glyph would rewrite those into "Ran
 * Corrected".
 *
 * Hermes' status glyphs (`⏳ Working — 12 min`, `⏱️ Agent inactive…`) are still
 * out of this list, but no longer because they're harmless — they never reach
 * the bubble at all now. `$lib/jkai/hermes-frames` recognises them on the frame
 * stream and routes them off the text channel, because re-editing them was what
 * wiped the answer out of the bubble and the persisted row. This module only
 * ever sees the reply, so it only has to worry about the tool log.
 */
const TOOL_GLYPHS = [
  '⚙', '⚡',                                             // fallbacks (all MCP tools, unregistered tools)
  '🔍', '📄', '🔎', '🐦',                                 // search + extract
  '🐍', '💻', '🔧', '📖', '✍', '📚', '📝',                 // code, shell, files, skills
  '🌐', '📸', '🖥', '👆', '📜', '🖼', '◀', '⌨', '👁', '🧪', // browser
  '🔀', '🧠', '🏠', '⏰', '📨', '💬', '📋', '❓',            // delegation, memory, HA, cron, messaging
  '🔊', '🎬', '🎨', '🔗', '➕', '💓',                       // media + kanban
];

/** `(?:🔍|📄|…)` plus an optional variation selector, e.g. the ️ in `⚙️`. */
const GLYPH_ALT = `(?:${TOOL_GLYPHS.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\uFE0F?`;

/**
 * Match one log entry. Deliberately strict about the separator: the tool name
 * must be followed by an ellipsis or a colon before we claim a match, so a
 * half-streamed `⚙️ mcp_jkai_recall_mem` is left alone until it completes
 * rather than being rewritten and then rewritten again.
 *
 * The quoted-argument branch cannot close on the first quote: search queries
 * routinely contain their own, and Hermes logs
 * `🔍 web_search: ""House of Lords" benefits pension fre..."` — stopping at the
 * first inner quote captured an empty argument and spilled the remainder of the
 * query into the reply as loose prose.
 *
 * Nor can it close on the LAST quote of the line, which is what it used to do.
 * Hermes glues the answer straight onto the end of an entry with no newline, and
 * the answer has curly quotes in it. Real production row:
 *
 *   ⚙️ mcp__jkai__jkai_extended: "workflow_run" (×2)The live check completed,
 *   but it exposed one routing flaw: “new URLs” and “relevant URLs” need sepa…
 *
 * Greedy-to-last-quote swallowed two sentences of the reply into the argument.
 *
 * The three quoted branches below are ordered most-constrained first, which is
 * what makes both shapes work. Counted over 45 days of production rows:
 *
 *   885  `"arg"` ending the line              → greedy, so a phrase-quoted
 *                                               query keeps its inner quotes
 *   153  `"arg" (×N)`                         → lazy up to the repeat marker
 *    12  `"arg"` with prose glued straight on → lazy up to the FIRST quote;
 *                                               there is no closing quote at
 *                                               the end of the line to aim for
 *
 * The glued-on text is usually one of Hermes' own `⏳ Working — 3 min` status
 * lines, which are already English and are deliberately left where they are.
 */
const ENTRY_RE = new RegExp(
  `${GLYPH_ALT}[ \\t]*([A-Za-z0-9_]+)` +
    `(?:(?:\\.{3}|…)|[ \\t]*:[ \\t]*(?:` +
    `["“”'](.*?)["“”'](?=[ \\t]*\\(×\\d+\\))` + //  …"arg" (×2)
    `|["“”'](.*)["“”'](?=[ \\t]*(?:\\n|$))` + //    …"arg"  ← ends the line
    `|["“”'](.*?)["“”']` + //                       …"arg"Prose glued straight on
    `|([^\\n(]+?)))` + //                           …bare unquoted arg
    `[ \\t]*(?:\\(×(\\d+)\\))?`,
  'g',
);

/**
 * Hermes tools whose names carry no underscore. Needed because the second half
 * of the false-positive guard is "the token looks like a tool name", and
 * `snake_case` is the only structural tell most of them have.
 */
const BARE_TOOLS = new Set([
  'terminal', 'patch', 'memory', 'process', 'clarify', 'cronjob', 'todo', 'skill', 'workflow',
]);

/**
 * Second guard, applied after the glyph matches: a captured token is only
 * treated as a tool if it is `snake_case` or a known single-word tool. Stops an
 * allowlisted glyph that also shows up in prose (`📋 Summary:`, `💬 Note:`) from
 * being rewritten as a tool call.
 */
function looksLikeToolToken(name: string): boolean {
  return name.includes('_') || BARE_TOOLS.has(name.toLowerCase());
}

/**
 * Strip Hermes' `mcp_<server>_` namespace. Server names carry no underscore.
 *
 * Both separator spellings are live: 342 `mcp_jkai_…` against 176
 * `mcp__jkai__…` across 45 days of production rows, because the MCP client
 * changed how it namespaces and the old rows keep the old form. Matching only
 * the single-underscore spelling left the other 176 rendering as
 * `Ran mcp jkai jkai extended on …` — the namespace read as the verb.
 */
function stripMcpNamespace(tool: string): string {
  const m = tool.match(/^mcp_{1,2}[^_]+_{1,2}(.+)$/);
  return m ? m[1] : tool;
}

/** A bare snake_case identifier — how `jkai_extended` names its inner tool. */
function looksLikeToolName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value);
}

function quote(value: string, max = 48): string {
  // Hermes has usually already clipped the preview with a literal `...`; fold
  // that into a real ellipsis so it matches the one our own clipping adds
  // rather than showing two spellings in the same sentence.
  const clean = value.trim().replace(/\s+/g, ' ').replace(/\.{3,}$/, '…');
  const clipped = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return `“${clipped}”`;
}

/**
 * Name a URL argument the way a person would — `parliament.uk`, not a quoted
 * 90-character path truncated mid-slug. Several of the native tools (web_extract,
 * browser_navigate, fetch_url) take a URL as their whole preview, and Hermes has
 * usually already clipped it, so the raw string is both long and broken.
 */
function prettyUrl(value: string): string {
  const raw = value.trim();
  try {
    const h = new URL(raw).hostname.replace(/^www\./, '');
    if (h) return h;
  } catch {
    // Hermes truncates the preview, so a clipped URL often will not parse.
    const m = raw.match(/^https?:\/\/(?:www\.)?([^/\s]+)/i);
    if (m) return m[1];
  }
  return quote(raw, 40);
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
  web_extract: (a) => (a ? `Read ${prettyUrl(a)}` : 'Read a web page'),
  research_search: (a) => (a ? `Searched past research for ${quote(a)}` : 'Searched past research'),
  research_list: () => 'Listed past research sessions',
  fetch_url: (a) => (a ? `Fetched ${prettyUrl(a)}` : 'Fetched a web page'),
  webpage_fetch: (a) => (a ? `Fetched ${prettyUrl(a)}` : 'Fetched a web page'),
  x_search: (a) => (a ? `Searched X for ${quote(a)}` : 'Searched X'),

  // Hermes' own session / skill machinery
  session_search: (a) => (a ? `Searched past conversations for ${quote(a)}` : 'Searched past conversations'),
  skill_view: (a) => (a ? `Read its ${a.replace(/[-_]/g, ' ')} playbook` : 'Read one of its playbooks'),
  skills_list: () => 'Checked which playbooks it has',
  skill_manage: () => 'Updated one of its playbooks',
  memory: (a) => (a ? `Checked its memory for ${quote(a)}` : 'Checked its memory'),
  mixture_of_agents: () => 'Asked several models and merged the answers',
  clarify: () => 'Paused to ask a clarifying question',
  todo: () => 'Updated its task list',
  cronjob: () => 'Worked with a scheduled job',
  process: () => 'Managed a background process',
  send_message: () => 'Sent a message',

  // Code / shell / local files (build runner contexts)
  execute_code: () => 'Ran some code',
  terminal: (a) => (a ? `Ran the command ${quote(a, 40)}` : 'Ran a terminal command'),
  read_file: (a) => (a ? `Read ${quote(a)}` : 'Read a file'),
  write_file: (a) => (a ? `Wrote ${quote(a)}` : 'Wrote a file'),
  patch: (a) => (a ? `Edited ${quote(a)}` : 'Edited a file'),
  search_files: (a) => (a ? `Searched the files for ${quote(a)}` : 'Searched the files'),

  // Browser automation
  browser_navigate: (a) => (a ? `Opened ${prettyUrl(a)} in a browser` : 'Opened a page in a browser'),
  browser_snapshot: () => 'Looked at the page',
  browser_vision: () => 'Looked at the page',
  browser_click: (a) => (a ? `Clicked ${quote(a, 32)}` : 'Clicked something on the page'),
  browser_type: (a) => (a ? `Typed ${quote(a, 32)} into the page` : 'Typed into the page'),
  browser_press: (a) => (a ? `Pressed ${quote(a, 20)}` : 'Pressed a key'),
  browser_scroll: () => 'Scrolled the page',
  browser_back: () => 'Went back a page',
  browser_console: () => 'Read the browser console',
  browser_get_images: () => 'Collected the images on the page',
  browser_dialog: () => 'Handled a browser dialog',
  browser_cdp: () => 'Drove the browser directly',

  // Media
  image_generate: (a) => (a ? `Generated an image of ${quote(a)}` : 'Generated an image'),
  video_generate: () => 'Generated a video',
  video_analyze: () => 'Analysed a video',
  vision_analyze: () => 'Looked at an image',
  text_to_speech: () => 'Turned text into speech',

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
  tool_search: (a) => (a ? `Looked for a tool that could ${quote(a)}` : 'Looked for the right tool'),
  tool_describe: (a) =>
    a ? `Read how ${humanise(stripMcpNamespace(a))} works` : 'Read a tool definition',
  activate_toolset: (a) => (a ? `Loaded the ${a} toolset` : 'Loaded a toolset'),
  jkai_help: () => 'Checked what it can do',
  delegate_task: (a) => (a ? `Handed a sub-agent the job of ${quote(a)}` : 'Handed work to a sub-agent'),
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
  if (!text || !TOOL_GLYPHS.some((g) => text.includes(g))) return text;

  const rewritten = text.replace(
    ENTRY_RE,
    (
      match,
      tool: string,
      quotedBeforeCount: string | undefined,
      quotedToEol: string | undefined,
      quotedThenProse: string | undefined,
      bare: string | undefined,
      count: string | undefined,
    ) => {
      // The glyph alone is not proof: it is also ordinary punctuation in a
      // reply. Require the token to look like a tool name too, and hand back
      // the untouched match when it does not.
      if (!looksLikeToolToken(tool)) return match;
      const arg = quotedBeforeCount ?? quotedToEol ?? quotedThenProse ?? bare ?? null;
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

/**
 * Remove every Hermes tool-log entry from `text`, leaving only the answer.
 *
 * This is what the chat bubble uses. The English rewrite above was a halfway
 * house — it made the machinery readable, but it is still machinery sitting in
 * the middle of a reply, and the thread already has a proper home for it: the
 * tool-call trace behind the *analyse* button, which is the durable record of
 * what actually ran. `rewriteHermesToolLog` stays for that page.
 *
 * Same matcher and same two guards as the rewrite, so anything the rewrite
 * would have left alone — `✅ Corrected:`, `📋 Summary:`, a half-streamed tool
 * name with no colon yet — survives here untouched too.
 *
 * Each entry becomes a paragraph break rather than nothing at all: Hermes glues
 * entries onto the end of a sentence with no newline, so deleting in place
 * would run the sentence before straight into the one after. The `\n{3,}`
 * collapse afterwards means a run of consecutive entries still leaves a single
 * blank line, not a gulf.
 */
export function stripHermesToolLog(text: string): string {
  if (!text || !TOOL_GLYPHS.some((g) => text.includes(g))) return text;

  const stripped = text.replace(ENTRY_RE, (match, tool: string) =>
    looksLikeToolToken(tool) ? '\n\n' : match,
  );

  return stripped
    // An entry glued to the end of a sentence leaves the space before it behind,
    // and two trailing spaces are a hard line break in markdown.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

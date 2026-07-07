import type { ToolProgressStep } from './job-store';

/**
 * The tool-call thread the chat UI renders is meant to be *skimmable*: each line
 * leads with a one-word CATEGORY of the action and states the *outcome* in a few
 * words, with the raw args/result one click away. Everything in this module feeds
 * that: `resolveDisplayTool` unmasks the real tool, `categorizeTool` supplies the
 * one-word bucket, and the two `summarize*` functions produce the outcome text.
 * The bus (`$lib/mcp/jsonrpc`), the Hermes frame adapter (`$lib/jkai/sse-adapter`)
 * and the UI all import from here so every render path agrees.
 */

export type ToolCategory =
  | 'WEB' | 'FILE' | 'MAIL' | 'HOME' | 'CANVAS'
  | 'DATA' | 'MSG' | 'AGENT' | 'MEM' | 'RUN' | 'TOOL';

/**
 * Un-mask the tool a step should be *displayed* as, plus the args that describe
 * it. Two transforms:
 *   1. `jkai_extended` is an MCP-layer meta-dispatcher — the real tool + its args
 *      ride inside `{ operation:'invoke', name, args }`. Unwrap to the inner tool.
 *   2. Hermes namespaces MCP tools as `mcp_<server>_<tool>` (e.g.
 *      `mcp_jkai_jkai_extended`). Strip that prefix so categorisation/labelling
 *      see the bare tool name.
 * Everything else passes through untouched.
 */
export function resolveDisplayTool(
  tool: string,
  args: Record<string, unknown> | undefined,
): { tool: string; args: Record<string, unknown> } {
  let name = typeof tool === 'string' ? tool : '';
  let a = args && typeof args === 'object' ? args : {};

  // Strip a leading `mcp_<server>_` namespace (single pass — server names here
  // have no underscores, e.g. `jkai`).
  const mcp = name.match(/^mcp_[^_]+_(.+)$/);
  if (mcp) name = mcp[1];

  // Unwrap the jkai_extended meta-dispatcher's invoke operation.
  if (name === 'jkai_extended' && a && (a as { operation?: unknown }).operation === 'invoke') {
    const inner = a as { name?: unknown; args?: unknown };
    if (typeof inner.name === 'string' && inner.name) {
      name = inner.name;
      a = inner.args && typeof inner.args === 'object' ? (inner.args as Record<string, unknown>) : {};
    }
  }

  return { tool: name, args: a };
}

/**
 * One-word category for the display tool (call `resolveDisplayTool` first if you
 * have a raw/meta name). Purely for the leading chip on a step line, so a user
 * can tell "this is a WEB action" from "this is a HOME action" at a glance.
 * Matched most-specific first.
 */
export function categorizeTool(tool: string): ToolCategory {
  const t = (tool || '').toLowerCase();
  const startsAny = (...ps: string[]) => ps.some((p) => t.startsWith(p));

  if (startsAny('ha_')) return 'HOME';
  if (startsAny('gmail_')) return 'MAIL';
  if (startsAny('workflow_')) return 'CANVAS';
  if (startsAny('whatsapp', 'publish_page', 'web_app_publish', 'send_')) return 'MSG';
  if (startsAny('build_')) return 'RUN';
  if (/memor(y|ies)/.test(t)) return 'MEM';
  if (t === 'delegate_task' || startsAny('subagent', 'delegate')) return 'AGENT';
  if (startsAny('file_', 'drive_', 'write_document', 'read_document', 'file_search')) return 'FILE';
  if (startsAny('render_', 'blog_', 'policy_engine', 'live_walk', 'family_presence', 'chart', 'table', 'map_'))
    return 'DATA';
  if (startsAny('terminal', 'exec', 'bash', 'shell', 'run_command', 'python')) return 'RUN';
  if (
    startsAny(
      'web_search', 'intel_search', 'fetch_url', 'webpage_fetch', 'stealth_scrape',
      'scraper_', 'reverse_geocode', 'geocode', 'browse',
    )
  )
    return 'WEB';
  // activate_toolset / jkai_help / list_custom_tools / create_tool / status_update
  // and any unknown tool fall through to the neutral bucket.
  return 'TOOL';
}

/** Unwrap the `{ success, data }` envelope site-tools return; passthrough otherwise. */
function unwrap(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  if ('data' in r && r.data && typeof r.data === 'object') return r.data as Record<string, unknown>;
  return r;
}

/**
 * Best-effort item count from an unwrapped result. Handlers are inconsistent
 * about the array key (`results`, `hits`, `messages`, `threads`, `files`,
 * `memories`), and several also carry an explicit `count`. Try `count` first,
 * then the first array under a known key.
 */
function countOf(d: Record<string, unknown>): number | undefined {
  if (typeof d.count === 'number') return d.count;
  for (const k of ['results', 'hits', 'messages', 'threads', 'files', 'memories', 'items', 'rows']) {
    if (Array.isArray(d[k])) return (d[k] as unknown[]).length;
  }
  return undefined;
}

/** First result's URL across the inconsistent array keys, for a "top: host" tail. */
function firstUrl(d: Record<string, unknown>): unknown {
  for (const k of ['results', 'hits']) {
    const arr = d[k];
    if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') return (arr[0] as { url?: unknown }).url;
  }
  return undefined;
}

/** Hostname of a URL, for compact "top result" / "fetched" summaries. */
function host(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const trim = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * Args-derived label shown on a tool step while it's still running. Lets the user
 * see *what* a tool is currently doing (which query, which file, which device)
 * instead of a bare spinner. Resolves the meta/`mcp_` display tool first.
 */
export function summarizeRunningTool(tool: string, args: Record<string, unknown>): string {
  const disp = resolveDisplayTool(tool, args);
  const a = disp.args;
  const str = (k: string): string | undefined => {
    const v = a[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  switch (disp.tool) {
    case 'activate_toolset': return str('toolset') ? `loading the ${str('toolset')} toolset — making those tools available` : 'loading a toolset';
    case 'jkai_help': return str('toolset') ? `getting help on ${str('toolset')} — checking what's available` : 'looking at available tools';
    case 'workflow_inspect':
      return str('id') ? `inspecting canvas ${str('id')!.slice(0, 8)}… — reading current state` : 'inspecting the canvas';
    case 'workflow_get_run':
      return str('id') ? `fetching run ${str('id')!.slice(0, 8)}… — pulling its result` : 'fetching a run result';
    case 'workflow_get_generation_log':
      return str('id') ? `replaying how canvas ${str('id')!.slice(0, 8)}… was built` : 'replaying a canvas build';
    case 'workflow_lint':
      return 'linting the workflow — checking config, edges and node types';
    case 'workflow_add_schedule':
      return 'activating the schedule — enabling the cron trigger';
    case 'workflow_remove_schedule':
      return 'pausing the schedule — stopping the cron trigger';
    case 'workflow_run':
      return str('id') ? `running canvas ${str('id')!.slice(0, 8)}… — kicking off the workflow` : 'running the canvas now';
    case 'workflow_list': return 'listing existing canvases — checking what already exists';
    case 'workflow_list_node_types': return 'fetching node types — needed before searching';
    case 'workflow_create': return str('name') ? `creating canvas "${str('name')}" — about to plan its structure` : 'creating a new canvas';
    case 'workflow_build_from_spec': return str('name') ? `building canvas "${str('name')}" from spec — inserting nodes one by one` : 'building a canvas from spec';
    case 'workflow_delete': return str('id') ? `deleting canvas ${str('id')!.slice(0, 8)}…` : 'deleting a canvas';
    case 'workflow_update_metadata': return str('name') ? `renaming canvas to "${str('name')}"` : 'updating canvas metadata';
    case 'workflow_add_node': return str('type') ? `adding a ${str('type')} node to the canvas` : 'adding a node to the canvas';
    case 'workflow_remove_node': return 'removing a node from the canvas';
    case 'workflow_update_node': return str('id') ? `updating node ${str('id')!.slice(0, 8)}… — applying a config change` : 'updating a node\'s config';
    case 'workflow_add_edge': return 'wiring an edge — connecting two nodes';
    case 'workflow_remove_edge': return 'removing an edge between two nodes';
    case 'file_list': return str('prefix') ? `listing files under ${str('prefix')}` : 'listing files';
    case 'file_read': return str('name') ? `reading ${str('name')}` : (str('id') ? `reading file ${str('id')!.slice(0, 8)}…` : 'reading a file');
    case 'file_search': return str('query') ? `searching files for “${trim(str('query')!, 40)}”` : 'searching files';
    case 'scraper_script_list': return 'listing scripts';
    case 'scraper_script_read':
    case 'scraper_script_save':
    case 'scraper_script_test':
      return str('profile') ? `profile ${str('profile')}` : 'working with a scraper script';
    case 'scraper_target_knowledge_lookup': {
      const domains = a.domains;
      if (Array.isArray(domains) && typeof domains[0] === 'string') return `looking up ${trim(domains[0] as string, 50)}`;
      return 'looking up target knowledge';
    }
    case 'web_search':
    case 'intel_search':
    case 'gmail_search':
      return str('query') ? `“${trim(str('query')!, 40)}”` : 'searching';
    case 'fetch_url':
    case 'webpage_fetch': return str('url') ? `fetching ${host(str('url')) ?? trim(str('url')!, 50)}` : 'fetching a page';
    case 'stealth_scrape':
    case 'stealth_scrape_llm':
      return str('url') ? `scraping ${host(str('url')) ?? trim(str('url')!, 50)}` : (str('profile') ? `profile ${str('profile')}` : 'scraping a page');
    case 'ha_query_state': return str('entity_id') ? `reading ${str('entity_id')}` : 'querying a device';
    case 'ha_call_service': return str('service') ? `calling ${str('service')}` : 'controlling a device';
    case 'ha_get_history': return str('entity_id') ? `history for ${str('entity_id')}` : 'getting device history';
    case 'ha_render_template': return 'running a template';
    case 'gmail_fetch': return str('threadId') ? `thread ${str('threadId')!.slice(0, 8)}…` : 'fetching mail';
    case 'gmail_send':
    case 'gmail_reply':
      return str('to') ? `→ ${str('to')}` : 'sending mail';
    case 'blog_get':
    case 'blog_update':
      return str('id') ? `post ${str('id')}` : 'working with a post';
    case 'recall_memories': return str('query') ? `“${trim(str('query')!, 40)}”` : 'recalling memory';
    case 'save_memory': return 'saving a memory';
    case 'render_chart':
    case 'render_map':
    case 'render_table':
      return str('caption') ? trim(str('caption')!, 50) : 'rendering';
    default: {
      // Generic fallback: take the first short string arg, if any.
      for (const v of Object.values(a)) {
        if (typeof v === 'string' && v.length > 0 && v.length < 80) return trim(v, 50);
      }
      return '';
    }
  }
}

/**
 * Human-friendly one-liner stating the *outcome* of a completed tool call. Shown
 * as the primary text on a step line, so keep it under ~120 chars. Resolves the
 * meta/`mcp_` display tool and unwraps the `{ success, data }` envelope first.
 */
export function summarizeToolResult(step: ToolProgressStep): string {
  const disp = resolveDisplayTool(step.tool, step.args);
  const { result, status } = step;
  const tool = disp.tool;
  const args = disp.args;

  if (status === 'error') {
    const errMsg =
      (result as { error?: string } | undefined)?.error ??
      (unwrap(result).error as string | undefined);
    return errMsg ? `${tool} failed: ${trim(errMsg, 80)}` : `${tool} failed`;
  }

  const d = unwrap(result);
  const count = countOf(d);
  const query = (args.query as string | undefined)?.slice(0, 40);
  const url = (args.url as string | undefined) ?? (d.url as string | undefined) ?? (d.finalUrl as string | undefined);
  const title = typeof d.title === 'string' ? d.title : undefined;
  // Many handlers already return a rich outcome string (visualise.ts, node
  // builders, …). Honour it for tools that have no more specific case below.
  const serverSummary = typeof d.summary === 'string' && d.summary ? d.summary : undefined;

  switch (tool) {
    case 'workflow_create': {
      const id = (d.workflowId as string | undefined);
      return id ? `Created canvas ${id}` : 'Created canvas';
    }
    case 'workflow_build_from_spec': {
      const parts: string[] = [];
      if (typeof d.name === 'string') parts.push(`"${d.name}"`);
      else if (typeof d.workflowId === 'string') parts.push((d.workflowId).slice(0, 8));
      if (typeof d.nodeCount === 'number') parts.push(`${d.nodeCount} node${d.nodeCount === 1 ? '' : 's'}`);
      return `Built canvas${parts.length ? ` ${parts.join(' · ')}` : ''}`;
    }
    case 'workflow_modify':
      return 'Updated canvas';
    case 'workflow_delete':
      return 'Deleted canvas';
    case 'workflow_run':
      return 'Ran the canvas';
    case 'intel_search': {
      const n = count ?? 0;
      return query ? `Found ${n} intel result${n === 1 ? '' : 's'} for "${query}"` : `Found ${n} intel results`;
    }
    case 'intel_note_create':
      return 'Created intel note';
    case 'intel_note_delete':
      return 'Deleted intel note';
    case 'web_search': {
      const n = count ?? 0;
      const top = host(firstUrl(d));
      const tail = top ? `, top: ${top}` : '';
      return query
        ? `“${query}” — ${n} result${n === 1 ? '' : 's'}${tail}`
        : `${n} result${n === 1 ? '' : 's'}${tail}`;
    }
    case 'fetch_url':
    case 'webpage_fetch': {
      const h = host(url);
      if (title) return `Read “${trim(title, 50)}”${h ? ` (${h})` : ''}`;
      return h ? `Fetched ${h}` : 'Fetched webpage';
    }
    case 'gmail_search': {
      const n = count ?? 0;
      return query ? `Searched Gmail for "${query}" (${n} thread${n === 1 ? '' : 's'})` : `Searched Gmail (${n} threads)`;
    }
    case 'gmail_fetch': {
      const n = count;
      return n != null ? `Fetched ${n} message${n === 1 ? '' : 's'}` : 'Fetched messages';
    }
    case 'gmail_send':
      return 'Sent Gmail message';
    case 'gmail_reply':
      return 'Sent Gmail reply';
    case 'gmail_label':
      return 'Updated Gmail labels';
    case 'stealth_scrape': {
      const h = host(url);
      return h ? `Scraped ${h}` : 'Scraped page';
    }
    case 'stealth_scrape_llm': {
      const h = host(url);
      return h ? `Extracted fields from ${h}` : 'Extracted fields';
    }
    case 'ha_query_state': {
      const st = typeof d.state === 'string' ? d.state : undefined;
      const ent = (args.entity_id as string | undefined);
      if (ent && st) return `${ent} is ${st}`;
      return ent ? `Read ${ent}` : 'Queried device';
    }
    case 'ha_call_service': {
      const svc = args.service as string | undefined;
      return svc ? `Called ${svc}` : 'Controlled device';
    }
    case 'ha_get_history':
      return 'Fetched device history';
    case 'file_list': {
      const n = count;
      return n != null ? `Listed ${n} file${n === 1 ? '' : 's'}` : 'Listed files';
    }
    case 'file_read':
      return (args.name as string | undefined) ? `Read ${args.name}` : 'Read file';
    case 'file_search': {
      const n = count ?? 0;
      return query ? `Found ${n} file${n === 1 ? '' : 's'} for "${query}"` : `Found ${n} files`;
    }
    case 'recall_memories': {
      const n = count ?? 0;
      return `Recalled ${n} memor${n === 1 ? 'y' : 'ies'}`;
    }
    case 'save_memory':
      return 'Saved a memory';
    case 'render_chart':
    case 'render_map':
    case 'render_table':
      // The visualise handlers return a rich `data.summary` (e.g. "Map: 2 tracks
      // — 340 points"). Prefer it; fall back to the caption arg.
      return serverSummary
        ? trim(serverSummary, 80)
        : ((args.caption as string | undefined) ? `Rendered “${trim(args.caption as string, 40)}”` : 'Rendered a view');
    case 'activate_toolset': {
      const toolset = args.toolset as string | undefined;
      return toolset ? `Loaded ${toolset} toolset` : 'Loaded toolset';
    }
    case 'jkai_help':
      return 'Checked available tools';
    default: {
      // Worded outcome, not "`tool` completed": prefer the handler's own summary,
      // then a short label out of the result, else a friendly "Done".
      if (serverSummary) return trim(serverSummary, 90);
      const label =
        (typeof d.name === 'string' && d.name) ||
        (typeof d.title === 'string' && d.title) ||
        (typeof d.message === 'string' && d.message) ||
        '';
      const pretty = tool.replace(/_/g, ' ');
      return label ? `${pretty}: ${trim(label, 50)}` : `Done — ${pretty}`;
    }
  }
}
